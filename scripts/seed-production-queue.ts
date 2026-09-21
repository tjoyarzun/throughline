/**
 * Seeds production THROUGH the job queue.
 *
 * Vercel keeps the database connection string write-only, so there is no local
 * path to the production database — correctly. Instead this exports the TMDB
 * ids already in the local corpus, enqueues a hydrate_title job for each, and
 * drives /api/cron/drain until the queue empties.
 *
 * Two things this buys beyond "it works at all":
 *   - Production receives the SAME deliberately-balanced corpus as local
 *     (critical consensus, decade sampling, director filmographies, franchise
 *     completion) rather than re-running collection and drifting from it.
 *   - It is fully resumable. Interrupt it and re-run; enqueue_job dedupes
 *     pending work and hydrate_title is idempotent.
 *
 * Usage: CRON_SECRET=... SITE=https://... tsx scripts/seed-production-queue.ts [--enqueue-only]
 *
 * Drains run CONCURRENTLY (default 4). core.claim_jobs uses FOR UPDATE SKIP
 * LOCKED, so overlapping drains never claim the same job -- that is the whole
 * point of SKIP LOCKED, and a serial loop leaves it unused. Each drain
 * processes roughly one job per second, so even at 4x the TMDB call rate stays
 * far below the 30 req/s limiter. Raise with DRAIN_CONCURRENCY at your own
 * risk: the limiter is per Vercel instance, so N drains can mean N buckets.
 */
import postgres from 'postgres';
import { directDatabaseUrl } from '@/server/db/resolve-url';

const SITE = process.env.SITE ?? 'https://throughline-mu-seven.vercel.app';
const SECRET = process.env.CRON_SECRET;
if (!SECRET) {
  console.error('seed-production-queue: CRON_SECRET is required');
  process.exit(2);
}
const AUTH = { Authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' };
const ENQUEUE_ONLY = process.argv.includes('--enqueue-only');
const CONCURRENCY = Math.max(1, Number(process.env.DRAIN_CONCURRENCY ?? 4));

async function localTitles(): Promise<{ tmdbId: number; kind: string }[]> {
  const local = directDatabaseUrl();
  if (!local) throw new Error('no local DATABASE_URL to export from');
  const sql = postgres(local.url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const rows = await sql<{ source_id: string; kind: string }[]>`
      SELECT x.source_id, t.kind
      FROM core.external_id x
      JOIN core.title t ON t.id = x.entity_id
      WHERE x.source = 'tmdb' AND x.entity_type = 'title'
      ORDER BY t.popularity DESC NULLS LAST`;
    return rows.map((r) => ({ tmdbId: Number(r.source_id), kind: r.kind }));
  } finally {
    await sql.end();
  }
}

async function health(): Promise<{ titles: number; depth: number; failed: number }> {
  const res = await fetch(`${SITE}/api/health`);
  const body = (await res.json()) as {
    corpus?: { titles?: number };
    job_queue?: { depth?: number; failed_24h?: number };
  };
  return {
    titles: body.corpus?.titles ?? 0,
    depth: body.job_queue?.depth ?? 0,
    failed: body.job_queue?.failed_24h ?? 0,
  };
}

async function main(): Promise<void> {
  const titles = await localTitles();
  console.log(`exporting ${titles.length} titles from the local corpus`);

  for (let i = 0; i < titles.length; i += 500) {
    const batch = titles.slice(i, i + 500);
    const res = await fetch(`${SITE}/api/admin/enqueue-titles`, {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({ titles: batch }),
    });
    if (!res.ok) throw new Error(`enqueue failed ${res.status}: ${await res.text()}`);
    const r = (await res.json()) as { enqueued: number; queue_depth: number };
    console.log(`  enqueued ${i + batch.length}/${titles.length} · queue ${r.queue_depth}`);
  }
  if (ENQUEUE_ONLY) return;

  console.log(`\ndraining with ${CONCURRENCY} concurrent workers. each call works for up to 45s.`);
  const started = Date.now();

  /** One drain call. Returns null when the call itself failed. */
  async function drainOnce(): Promise<{
    processed: number;
    failed: number;
    remaining: number;
  } | null> {
    const res = await fetch(`${SITE}/api/cron/drain`, { headers: AUTH });
    if (!res.ok) {
      console.error(`  drain ${res.status}: ${(await res.text()).slice(0, 120)}`);
      return null;
    }
    return (await res.json()) as { processed: number; failed: number; remaining: number };
  }

  for (let pass = 1; ; pass++) {
    const results = await Promise.all(Array.from({ length: CONCURRENCY }, () => drainOnce()));
    const ok = results.filter((r): r is NonNullable<typeof r> => r !== null);

    if (ok.length === 0) {
      console.error('  every drain in this pass failed; retrying in 10s');
      await new Promise((r) => setTimeout(r, 10_000));
      continue;
    }

    const processed = ok.reduce((n, r) => n + r.processed, 0);
    const failed = ok.reduce((n, r) => n + r.failed, 0);
    // Each worker reports the depth it saw; the smallest is the most recent.
    const remaining = Math.min(...ok.map((r) => r.remaining));
    const h = await health();
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    console.log(
      `  pass ${String(pass).padStart(3)} · +${processed} done, ${failed} failed · ` +
        `remaining ${remaining} · corpus ${h.titles} titles · ${mins}m`,
    );
    if (remaining === 0) break;
    if (processed === 0 && failed === 0) {
      console.error('  no progress; stopping so this does not spin');
      break;
    }
  }

  const h = await health();
  console.log(`\ndone. production corpus: ${h.titles} titles, ${h.failed} failed jobs.`);
  console.log('Next: derive themes and enrich from Wikidata against production.');
}

main().catch((e) => {
  console.error('seed-production-queue FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});
