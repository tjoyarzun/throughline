import postgres from 'postgres';
import { themeCoverage } from '@/server/ingest/derive-themes';

/**
 * Health reporting. Lives in the repository layer, not the route handler:
 * routes hold no SQL. The layer-boundary check flagged the first version,
 * correctly — infrastructure endpoints are still application code.
 *
 * HEALTH, NOT LIVENESS. Every cron kind is checked for FRESHNESS as well as
 * absence of error, because the failure this guards against is a scheduled
 * task reporting success every run while silently doing nothing.
 */

/** Seconds after which a cron kind is stale. Roughly 2x its interval. */
const MAX_AGE_S: Record<string, number> = {
  drain: 300,
  tmdb_changes: 172_800,
  refresh_degree: 172_800,
  housekeeping: 172_800,
};

const QUEUE_STALL_S = 900;
/**
 * Alert threshold, NOT the target.
 *
 * Coverage is 76% of keyworded titles today and 80% is the goal, but an alert
 * that fires permanently because a backlog item is unfinished is an alert
 * people learn to ignore — which is how a real regression gets missed. 70%
 * means "coverage has actually degraded", which is actionable. The 80% target
 * lives in docs/ontology.md where a goal belongs.
 */
const MIN_THEME_COVERAGE_PCT = 70;
/**
 * Share of the corpus re-synced within a week. Seven days, not the 48 hours
 * the spec first named: a weekly refresh cadence cannot satisfy a 48-hour
 * window, and a threshold that can never be met is noise, not a signal.
 */
const MIN_FRESH_PCT = 80;

export interface HealthReport {
  status: 'ok' | 'degraded' | 'error';
  problems: string[];
  db: string;
  auth?: { secret: boolean; email_delivery: boolean };
  job_queue?: unknown;
  cron?: Record<string, unknown>;
  corpus?: unknown;
  graph?: unknown;
  reason?: string;
}

export async function getHealth(databaseUrl: string): Promise<HealthReport> {
  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 5,
    onnotice: () => {},
  });
  const problems: string[] = [];
  try {
    const [queue] = await sql<{ depth: number; oldest: number | null; failed_24h: number }[]>`
      SELECT count(*) FILTER (WHERE status = 'queued')::int AS depth,
             extract(epoch FROM now() - min(run_after) FILTER (WHERE status = 'queued'))::int AS oldest,
             count(*) FILTER (WHERE status = 'failed'
                              AND created_at > now() - interval '24 hours')::int AS failed_24h
      FROM core.job`;

    const cronRows = await sql<
      {
        kind: string;
        last_success: string | null;
        age_s: number | null;
        consecutive_failures: number;
      }[]
    >`
      SELECT kind,
             max(finished_at) FILTER (WHERE status = 'done')::text AS last_success,
             extract(epoch FROM now() - max(finished_at) FILTER (WHERE status = 'done'))::int AS age_s,
             count(*) FILTER (WHERE status = 'failed')::int AS consecutive_failures
      FROM core.job GROUP BY kind`;

    // Theme coverage comes from themeCoverage(), the SAME function the
    // derivation itself reports with. It used to be a second copy of the query
    // here, with a comment begging the two to stay identical -- they had
    // already diverged once. One definition, two callers.
    const cov = await themeCoverage(sql);
    const pctInt = (a: number, b: number) => (b === 0 ? null : Math.round((100 * a) / b));
    const [fresh] = await sql<{ pct_fresh: number | null }[]>`
      SELECT round(100.0 * count(*) FILTER (
               WHERE synced_at > now() - interval '7 days') / nullif(count(*), 0))::int
             AS pct_fresh
      FROM core.title`;

    // Entity counts, so "which tables are still empty?" is answerable from
    // production, where there is no psql. Also what the Universe hub renders.
    const [graph] = await sql<
      {
        people: number;
        credits: number;
        edges: number;
        derived_edges: number;
        concepts: number;
        collections: number;
        organizations: number;
        works: number;
        characters: number;
        seasons: number;
        episodes: number;
      }[]
    >`
      SELECT (SELECT count(*)::int FROM core.person)       AS people,
             (SELECT count(*)::int FROM core.credit)       AS credits,
             (SELECT count(*)::int FROM core.edge)         AS edges,
             (SELECT count(*)::int FROM core.edge_derived) AS derived_edges,
             (SELECT count(*)::int FROM core.concept)      AS concepts,
             (SELECT count(*)::int FROM core.collection)   AS collections,
             (SELECT count(*)::int FROM core.organization) AS organizations,
             (SELECT count(*)::int FROM core.work)         AS works,
             (SELECT count(*)::int FROM core.character)    AS characters,
             (SELECT count(*)::int FROM core.season)       AS seasons,
             (SELECT count(*)::int FROM core.episode)      AS episodes`;

    const corpus = {
      titles: cov.titles,
      pct_fresh: fresh?.pct_fresh ?? null,
      themed_pct: pctInt(cov.themed, cov.with_keywords),
      no_keyword_pct: pctInt(cov.no_keywords, cov.titles),
    };

    if ((queue?.oldest ?? 0) > QUEUE_STALL_S)
      problems.push(`job queue stalled (${queue!.oldest}s)`);
    if ((queue?.failed_24h ?? 0) > 0) problems.push(`${queue!.failed_24h} jobs failed in 24h`);
    for (const c of cronRows) {
      const max = MAX_AGE_S[c.kind];
      if (max && c.age_s !== null && c.age_s > max) problems.push(`${c.kind} stale (${c.age_s}s)`);
      if (c.consecutive_failures >= 3)
        problems.push(`${c.kind} failing (${c.consecutive_failures})`);
    }
    // Reported since the beginning and never checked. The spec calls for it
    // (docs/deployment.md), and without it "we have not talked to TMDB in a
    // month" looks exactly like a healthy system.
    if ((corpus.pct_fresh ?? 100) < MIN_FRESH_PCT) {
      problems.push(
        `only ${corpus.pct_fresh}% of titles synced in the last 7 days ` +
          `(below ${MIN_FRESH_PCT}%) — enqueue refresh_stale`,
      );
    }
    if ((corpus?.themed_pct ?? 100) < MIN_THEME_COVERAGE_PCT) {
      problems.push(
        `theme coverage ${corpus!.themed_pct}% of keyworded titles ` +
          `(below ${MIN_THEME_COVERAGE_PCT}%) — run pnpm derive:themes or extend the crosswalk`,
      );
    }

    /**
     * Sign-in generates a code and then has to deliver it. Without an email
     * provider the flow returns a 500 at the last step, which looks like a bug
     * in the app rather than missing configuration — so it is reported here.
     */
    const emailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
    const authConfigured = Boolean(process.env.BETTER_AUTH_SECRET);
    if (!authConfigured) problems.push('BETTER_AUTH_SECRET is not set — sign-in cannot work');
    if (!emailConfigured && process.env.NODE_ENV === 'production') {
      problems.push(
        'no email provider (RESEND_API_KEY, EMAIL_FROM) — sign-in codes cannot be delivered',
      );
    }

    return {
      status: problems.length === 0 ? 'ok' : 'degraded',
      problems,
      db: 'ok',
      auth: { secret: authConfigured, email_delivery: emailConfigured },
      job_queue: queue,
      cron: Object.fromEntries(cronRows.map((c) => [c.kind, c])),
      corpus,
      graph,
    };
  } catch (e) {
    return {
      status: 'error',
      problems: ['database unreachable'],
      db: 'unreachable',
      reason: e instanceof Error ? e.message : String(e),
    };
  } finally {
    await sql.end();
  }
}

export interface JobFailure {
  kind: string;
  status: string;
  attempts: number;
  last_error: string | null;
  count: number;
}

/**
 * Job queue diagnostics.
 *
 * /api/health reports THAT jobs are failing; this reports WHY. In production
 * the only other way to read a handler's error message is a database console,
 * and the connection string is deliberately unreachable — so a failure that is
 * trivially visible locally is invisible exactly where it matters.
 */
export async function getJobDiagnostics(databaseUrl: string): Promise<{
  by_status: { status: string; count: number }[];
  failures: JobFailure[];
}> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const by_status = await sql<{ status: string; count: number }[]>`
      SELECT status, count(*)::int AS count FROM core.job GROUP BY status ORDER BY count DESC`;
    const failures = await sql<JobFailure[]>`
      SELECT kind, status, max(attempts)::int AS attempts,
             left(last_error, 500) AS last_error, count(*)::int AS count
      FROM core.job
      WHERE last_error IS NOT NULL
      GROUP BY kind, status, left(last_error, 500)
      ORDER BY count DESC
      LIMIT 10`;
    return { by_status, failures };
  } finally {
    await sql.end();
  }
}

/**
 * Clear the exponential backoff so a drain retries immediately. The necessary
 * other half of diagnostics: after fixing a handler there has to be a way to
 * retry without waiting the backoff out.
 */
export async function requeueJobs(databaseUrl: string, kind?: string): Promise<number> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const rows = kind
      ? await sql`UPDATE core.job SET status = 'queued', attempts = 0, run_after = now(),
                  last_error = NULL WHERE kind = ${kind} AND status <> 'done' RETURNING 1`
      : await sql`UPDATE core.job SET status = 'queued', attempts = 0, run_after = now(),
                  last_error = NULL WHERE status <> 'done' RETURNING 1`;
    return rows.length;
  } finally {
    await sql.end();
  }
}
