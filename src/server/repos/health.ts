import postgres from 'postgres';

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

export interface HealthReport {
  status: 'ok' | 'degraded' | 'error';
  problems: string[];
  db: string;
  job_queue?: unknown;
  cron?: Record<string, unknown>;
  corpus?: unknown;
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

    // Theme coverage is measured against titles that HAVE keywords, not all
    // titles. Roughly 10% of the corpus has no TMDB keywords at all, so no
    // crosswalk can ever theme those — counting them made a data ceiling look
    // like a crosswalk failure. This must stay identical to the definition in
    // scripts/derive-themes.ts; two places computing one metric differently is
    // its own bug, and we already shipped it once.
    const [corpus] = await sql<
      {
        titles: number;
        pct_fresh: number | null;
        themed_pct: number | null;
        no_keyword_pct: number | null;
      }[]
    >`
      WITH t AS (
        SELECT ti.id,
               EXISTS (SELECT 1 FROM core.title_keyword k WHERE k.title_id = ti.id) AS has_kw,
               EXISTS (SELECT 1 FROM core.edge e
                       WHERE e.subject_id = ti.id AND e.predicate = 'explores_theme') AS themed
        FROM core.title ti
      )
      SELECT (SELECT count(*)::int FROM t) AS titles,
             (SELECT round(100.0 * count(*) FILTER (
                WHERE synced_at > now() - interval '48 hours') / nullif(count(*), 0))
              FROM core.title)::int AS pct_fresh,
             (SELECT round(100.0 * count(*) FILTER (WHERE has_kw AND themed)
                / nullif(count(*) FILTER (WHERE has_kw), 0)) FROM t)::int AS themed_pct,
             (SELECT round(100.0 * count(*) FILTER (WHERE NOT has_kw)
                / nullif(count(*), 0)) FROM t)::int AS no_keyword_pct`;

    if ((queue?.oldest ?? 0) > QUEUE_STALL_S)
      problems.push(`job queue stalled (${queue!.oldest}s)`);
    if ((queue?.failed_24h ?? 0) > 0) problems.push(`${queue!.failed_24h} jobs failed in 24h`);
    for (const c of cronRows) {
      const max = MAX_AGE_S[c.kind];
      if (max && c.age_s !== null && c.age_s > max) problems.push(`${c.kind} stale (${c.age_s}s)`);
      if (c.consecutive_failures >= 3)
        problems.push(`${c.kind} failing (${c.consecutive_failures})`);
    }
    if ((corpus?.themed_pct ?? 100) < MIN_THEME_COVERAGE_PCT) {
      problems.push(
        `theme coverage ${corpus!.themed_pct}% of keyworded titles ` +
          `(below ${MIN_THEME_COVERAGE_PCT}%) — run pnpm derive:themes or extend the crosswalk`,
      );
    }

    return {
      status: problems.length === 0 ? 'ok' : 'degraded',
      problems,
      db: 'ok',
      job_queue: queue,
      cron: Object.fromEntries(cronRows.map((c) => [c.kind, c])),
      corpus,
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
