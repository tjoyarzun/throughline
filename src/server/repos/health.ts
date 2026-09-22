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
/**
 * How stale each job kind may get before something is actually wrong.
 *
 * Keys MUST be real job kinds. The first version had four entries of which
 * two -- `drain` and `tmdb_changes` -- matched nothing: `drain` is the
 * endpoint that RUNS jobs, not a job, and `tmdb_changes` was never built. A
 * kind that never appears can never be stale, so those two rows monitored
 * nothing while making the map look like coverage. tests/unit/health-cron
 * now asserts every key against HANDLERS so a dead entry cannot be added back.
 *
 * The bounds are two days, not one, for everything the daily cron drives:
 * Vercel Hobby cron is DAILY, so a one-day bound fires on ordinary jitter.
 *
 * The self-chaining walks are included deliberately. They are the ones that
 * have broken before -- enqueue_job's dedupe once made a chaining job match
 * itself, so every walk did exactly one batch and stopped -- and the symptom
 * was a counter that quietly stopped climbing. A number nothing compares
 * against is not a check.
 */
export const MAX_AGE_S: Record<string, number> = {
  refresh_degree: 172_800,
  housekeeping: 172_800,
  refresh_stale: 172_800,
  hydrate_title: 172_800,
  hydrate_people: 172_800,
  hydrate_episodes: 172_800,
  derive_themes: 172_800,
  enrich_wikidata: 172_800,
  refresh_availability: 172_800,
  recompute_similar: 604_800, // weekly by design
};

/**
 * How long a job may sit before something is actually wrong.
 *
 * Fifteen minutes was written against the spec's per-minute drain, which the
 * Hobby plan does not allow -- cron there is DAILY. Measured against a cadence
 * that does not exist, the check reported "stalled" every morning for work
 * that was simply waiting its turn, which is noise, not a signal.
 *
 * Every path that enqueues now also drains: tracking actions kick one through
 * after(), and the refresh cron drains what it enqueues. So a job still
 * sitting hours later means some enqueue path forgot to, and that is worth
 * being told about.
 */
const QUEUE_STALL_S = 6 * 60 * 60;
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
  auth?: {
    secret: boolean;
    email_delivery: boolean;
    delivers_to_anyone: boolean;
    least_privilege: boolean;
  };
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
    /**
     * oldest_kind is not decoration. "job queue stalled (21600s)" says
     * something is wedged and not which thing, which is the difference
     * between a page you act on and a page you squint at. The self-chaining
     * walks are the likely culprits and they are the ones whose name you
     * need.
     */
    const [queue] = await sql<
      { depth: number; oldest: number | null; oldest_kind: string | null; failed_24h: number }[]
    >`
      SELECT count(*) FILTER (WHERE status = 'queued')::int AS depth,
             extract(epoch FROM now() - min(run_after) FILTER (WHERE status = 'queued'))::int AS oldest,
             (SELECT kind FROM core.job WHERE status = 'queued'
               ORDER BY run_after LIMIT 1) AS oldest_kind,
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
        people_detailed: number;
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
             (SELECT count(*)::int FROM core.person
               WHERE detail_synced_at IS NOT NULL)          AS people_detailed,
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
      problems.push(
        `job queue stalled: ${queue!.oldest_kind ?? 'unknown'} queued ${queue!.oldest}s`,
      );
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
    /**
     * Whether authentication is on the least-privilege role or has fallen back
     * to the application connection.
     *
     * Reported because the fallback is SILENT by nature: everything works
     * either way, and the only difference is that the owner connection can
     * read every rating, viewing record and note in the database. It went
     * unnoticed from Phase 1 until it was looked for.
     */
    const authLeastPrivilege = Boolean(
      process.env.AUTH_DATABASE_URL ?? process.env.AUTH_DB_PASSWORD,
    );
    if (!authLeastPrivilege && process.env.NODE_ENV === 'production') {
      problems.push(
        'authentication is using the application connection, not app_auth — set AUTH_DB_PASSWORD',
      );
    }

    const emailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
    const authConfigured = Boolean(process.env.BETTER_AUTH_SECRET);
    if (!authConfigured) problems.push('BETTER_AUTH_SECRET is not set — sign-in cannot work');
    if (!emailConfigured && process.env.NODE_ENV === 'production') {
      problems.push(
        'no email provider (RESEND_API_KEY, EMAIL_FROM) — sign-in codes cannot be delivered',
      );
    }

    /**
     * Configured is not the same as able to deliver.
     *
     * Resend's shared sender only delivers to the Resend account owner's own
     * address; every other recipient is refused with a 403 before a message
     * leaves. Confirmed against the live API, not inferred. So the app can
     * report email as working, pass every check, and still be unable to admit
     * a single invited person -- and the failure lands on THEIR screen, as a
     * code that never arrives, where the owner never sees it.
     *
     * It is a property of the from address, so it costs nothing to detect.
     */
    const sharedSender = (process.env.EMAIL_FROM ?? '').endsWith('@resend.dev');
    if (emailConfigured && sharedSender) {
      problems.push(
        'EMAIL_FROM is the shared resend.dev sender — sign-in codes reach only the ' +
          'Resend account owner. Verify a domain at resend.com/domains to invite anyone else.',
      );
    }

    return {
      status: problems.length === 0 ? 'ok' : 'degraded',
      problems,
      db: 'ok',
      auth: {
        secret: authConfigured,
        email_delivery: emailConfigured,
        // Whether anyone OTHER than the owner can actually receive a code.
        delivers_to_anyone: emailConfigured && !sharedSender,
        least_privilege: authLeastPrivilege,
      },
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
