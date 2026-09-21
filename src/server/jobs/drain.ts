import postgres from 'postgres';
import { runJob, type Job } from './handlers';

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
