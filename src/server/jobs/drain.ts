import postgres from 'postgres';
import { HANDLERS, runJob, type Job } from './handlers';

/**
 * Drains the job queue. All SQL lives here rather than in the route handler —
 * routes stay thin, per docs/architecture.md.
 *
 * Bounded by wall clock rather than a job count: job durations vary by two
 * orders of magnitude and a serverless function killed mid-write is worse than
 * one that stops early.
 */
const BUDGET_MS = 45_000;
const BATCH = 10;

export interface DrainResult {
  worker: string;
  processed: number;
  failed: number;
  remaining: number;
  elapsed_ms: number;
}

export async function drainQueue(databaseUrl: string): Promise<DrainResult> {
  const sql = postgres(databaseUrl, { max: 2, prepare: false, onnotice: () => {} });
  const worker = `drain-${Math.random().toString(36).slice(2, 8)}`;
  const started = Date.now();
  let processed = 0;
  let failed = 0;

  try {
    while (Date.now() - started < BUDGET_MS) {
      const jobs = await sql<Job[]>`SELECT * FROM core.claim_jobs(${BATCH}, ${worker})`;
      if (jobs.length === 0) break;

      for (const job of jobs) {
        if (Date.now() - started >= BUDGET_MS) {
          // Out of budget. Release rather than hold a lock the next run would
          // have to wait out, and do not charge the job an attempt for it.
          await sql`UPDATE core.job SET status = 'queued', locked_at = NULL,
                    attempts = greatest(0, attempts - 1) WHERE id = ${job.id}`;
          continue;
        }
        try {
          await runJob(sql, job);
          await sql`SELECT core.finish_job(${job.id})`;
          processed++;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          await sql`SELECT core.fail_job(${job.id}, ${message.slice(0, 2000)})`;
          failed++;
        }
      }
    }

    const [depth] = await sql<{ queued: number }[]>`
      SELECT count(*)::int AS queued FROM core.job WHERE status = 'queued'`;
    return {
      worker,
      processed,
      failed,
      remaining: depth?.queued ?? 0,
      elapsed_ms: Date.now() - started,
    };
  } finally {
    await sql.end();
  }
}

/**
 * Runs a maintenance handler directly and records the outcome in core.job.
 *
 * The record is not bookkeeping for its own sake: /api/health asserts
 * FRESHNESS per cron kind, so a task that never records a run looks stale
 * whether or not it ran. A maintenance job that succeeds at doing nothing is
 * not healthy, and neither is one that succeeds invisibly.
 */
export async function runMaintenanceJob(
  databaseUrl: string,
  kind: string,
): Promise<{ job: string; ok: boolean; elapsed_ms: number; error?: string }> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
  const started = Date.now();
  try {
    await runJob(sql, { id: 'cron', kind, payload: {}, attempts: 0 });
    await sql`INSERT INTO core.job (kind, payload, status, finished_at)
              VALUES (${kind}, '{}'::jsonb, 'done', now())`;
    return { job: kind, ok: true, elapsed_ms: Date.now() - started };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await sql`INSERT INTO core.job (kind, payload, status, last_error, finished_at)
              VALUES (${kind}, '{}'::jsonb, 'failed', ${error.slice(0, 2000)}, now())`;
    return { job: kind, ok: false, elapsed_ms: Date.now() - started, error };
  } finally {
    await sql.end();
  }
}

/**
 * Enqueues hydrate_title jobs for a batch of TMDB ids.
 *
 * Production cannot be seeded from a developer machine — Vercel keeps the
 * connection string write-only, correctly — so seeding runs through the queue
 * instead. That is a better design regardless: resumable after any failure,
 * and it exercises the queue at real scale rather than on five test rows.
 *
 * enqueue_job dedupes on (kind, payload) while a job is still pending, so
 * resending a batch after a timeout costs nothing.
 */
/**
 * Enqueue a single maintenance job by kind.
 *
 * The kind must be a registered handler. That allowlist is the whole security
 * story for this path: an unrecognized kind can never be written, so a
 * compromised caller cannot park junk in the queue for a future handler name
 * to pick up.
 */
export async function enqueueJobKind(
  databaseUrl: string,
  kind: string,
  payload: Record<string, unknown> = {},
): Promise<{ kind: string; queue_depth: number }> {
  if (!Object.prototype.hasOwnProperty.call(HANDLERS, kind)) {
    throw new Error(`unknown job kind '${kind}'`);
  }
  const sql = postgres(databaseUrl, { max: 2, prepare: false, onnotice: () => {} });
  try {
    await sql`SELECT core.enqueue_job(${kind}, ${sql.json(payload as never)})`;
    const [depth] = await sql<{ queued: number }[]>`
      SELECT count(*)::int AS queued FROM core.job WHERE status = 'queued'`;
    return { kind, queue_depth: depth?.queued ?? 0 };
  } finally {
    await sql.end();
  }
}

export async function enqueueTitles(
  databaseUrl: string,
  titles: { tmdbId: number; kind: string }[],
): Promise<{ enqueued: number; queue_depth: number }> {
  const sql = postgres(databaseUrl, { max: 2, prepare: false, onnotice: () => {} });
  try {
    let enqueued = 0;
    for (const t of titles) {
      if (!Number.isFinite(t.tmdbId)) continue;
      await sql`SELECT core.enqueue_job('hydrate_title',
                  ${sql.json({
                    tmdbId: t.tmdbId,
                    kind: t.kind === 'show' ? 'show' : 'movie',
                  } as never)})`;
      enqueued++;
    }
    const [depth] = await sql<{ queued: number }[]>`
      SELECT count(*)::int AS queued FROM core.job WHERE status = 'queued'`;
    return { enqueued, queue_depth: depth?.queued ?? 0 };
  } finally {
    await sql.end();
  }
}
