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
  refresh_availability: 172_800,
  hydrate_people: 172_800,
};

/**
 * Jobs nothing schedules. Measured by their WORK, not by their last run.
 *
 * These five used to sit in the map above, and the map's own comment gave the
 * game away: "roughly 2x its interval" for jobs that have no interval. Traced
 * through the enqueue sites, what actually triggers them is:
 *
 *   hydrate_title      somebody opens a title we do not hold
 *   hydrate_episodes   somebody tracks a show
 *   derive_themes      a person, by hand
 *   enrich_wikidata    a person, by hand
 *   recompute_similar  a person, by hand
 *
 * So their last-run time only ever decays. Two had already tripped when this
 * was found (derive_themes and hydrate_title, both at 48.2 hours against a
 * 48-hour bound), enrich_wikidata was hours away, and recompute_similar was
 * days away. The endpoint was on its way to permanently red for a system
 * doing exactly what it should -- which is the same failure as an alert that
 * never fires, arrived at from the opposite direction. Nobody reads either.
 *
 * The honest question for work that happens on demand is not "did it run
 * lately" but "is there work of this kind sitting undone". Nothing queued is
 * healthy however long it has been. Something queued past a drain window is
 * broken however recently the kind last succeeded.
 */
export const ON_DEMAND_KINDS = [
  'hydrate_title',
  'hydrate_episodes',
  'derive_themes',
  'enrich_wikidata',
  'recompute_similar',
] as const;

/**
 * How long a job may sit before something is actually wrong.
 *
 * Fifteen minutes was written against the spec's per-minute drain, which the
 * Hobby plan does not allow -- cron there is DAILY. Measured against a cadence
 * that does not exist, the check reported "stalled" every morning for work
 * that was simply waiting its turn, which is noise, not a signal.
 *
 * Every path that enqueues also drains: tracking actions kick one through
 * after(), and the refresh cron drains what it enqueues.
 *
 * Six hours was still wrong, and naming the stalled job is what exposed it.
 * The self-chaining walks -- hydrate_people, refresh_stale, the rest -- put
 * their next link on the queue from INSIDE the drain, so the link created when
 * the 45-second budget runs out has nobody left to run it until the next daily
 * window. Waiting ~22 hours is that design working, not failing, and a
 * threshold of six hours reported "degraded" every single day for it. An
 * alert that is always on is an alert nobody reads.
 *
 * Twenty-six hours is the honest line: it is longer than the gap between
 * drains, so anything that trips it has survived a drain without being
 * claimed, which is genuinely broken. The "somebody forgot to drain" case it
 * used to catch now surfaces one day later instead of six hours later, which
 * is the price of not crying wolf nightly.
 */
const QUEUE_STALL_S = 26 * 60 * 60;
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

    /**
     * Queued work per kind, for the on-demand jobs.
     *
     * The global oldest/oldest_kind above answers "is the queue moving". This
     * answers "is THIS kind of work moving", which is what an on-demand job
     * can be held to: a hydrate_title enqueued when somebody opened a title
     * and still sitting there two drains later is broken, and the fact that
     * the kind last succeeded a week ago is not.
     */
    const queuedByKind = await sql<{ kind: string; oldest: number | null; n: number }[]>`
      SELECT kind,
             extract(epoch FROM now() - min(run_after))::int AS oldest,
             count(*)::int AS n
      FROM core.job
      WHERE status = 'queued'
      GROUP BY kind`;

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
      /* Failures are checked for EVERY kind, scheduled or not. A job that
         ran and threw is broken whatever triggered it. */
      if (c.consecutive_failures >= 3)
        problems.push(`${c.kind} failing (${c.consecutive_failures})`);
    }

    /* On-demand kinds: judged on undone work, not on elapsed time. Reuses the
       same 26-hour line as the global stall check, because it is the same
       claim -- this survived a drain without being claimed. */
    const onDemand = new Set<string>(ON_DEMAND_KINDS);
    for (const q of queuedByKind) {
      if (!onDemand.has(q.kind)) continue;
      if ((q.oldest ?? 0) > QUEUE_STALL_S) {
        problems.push(`${q.kind} not draining: ${q.n} queued, oldest ${q.oldest}s`);
      }
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
