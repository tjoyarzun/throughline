import postgres from 'postgres';
import { Ingestor } from '../src/server/ingest/ingest';
import { TmdbClient } from '../src/server/providers/tmdb/client';
import { mapPool } from '../src/lib/pool';

/**
 * Backfill person detail in one pass.
 *
 * The queue walk is correct and will finish on its own; what it cannot do is
 * finish QUICKLY, because Vercel Hobby gives it one 45-second window a day.
 * This is the same work without that ceiling: point it at a database, leave it
 * running, and it drains the whole backlog in roughly half an hour.
 *
 * Writes STRAIGHT to whichever database DATABASE_URL names -- there is no
 * local staging step and no export file, on purpose. Person ids are UUIDv7
 * generated at insert time in each database independently, so local and
 * production do not share them: local Scarlett Johansson is a different uuid
 * from production's. A dump of core.person from one and a restore into the
 * other would attach biographies to the wrong people, or to nobody. The only
 * key the two environments agree on is the TMDB id, which is exactly the key
 * this script already uses to fetch. Hydrating each database directly avoids
 * inventing a mapping that would have to be right the first time.
 *
 * Resumable by construction: it selects only rows where detail_synced_at IS
 * NULL, so an interrupted run loses nothing and re-running skips what landed.
 *
 *   pnpm tsx scripts/hydrate-people.ts              # DATABASE_URL from .env
 *   DATABASE_URL='<neon>' pnpm tsx scripts/hydrate-people.ts
 *   ... --limit 500      stop after N people (a dry-ish run)
 *   ... --concurrency 4  gentler on the provider
 */

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const CONCURRENCY = arg('concurrency', 8);
const CAP = arg('limit', Number.POSITIVE_INFINITY);
/* Pulled per round rather than all at once: 58,000 ids is a pointless amount
   to hold, and a fresh query each round means a run started while the cron
   walk is also working does not re-fetch what the walk just finished. */
const ROUND = 250;

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error('hydrate-people: DATABASE_URL is not set');

const sql = postgres(url, { max: 6, prepare: false, onnotice: () => {} });

function bar(done: number, total: number): string {
  const pct = total > 0 ? done / total : 1;
  const filled = Math.round(pct * 24);
  return `[${'#'.repeat(filled)}${'.'.repeat(24 - filled)}] ${(pct * 100).toFixed(1)}%`;
}

try {
  const [target] = await sql<{ host: string; people: number; done: number }[]>`
    SELECT current_setting('server_version') AS host,
           count(*)::int AS people,
           count(*) FILTER (WHERE detail_synced_at IS NOT NULL)::int AS done
    FROM core.person`;

  const host = new URL(url).host;
  console.log(`database : ${host}`);
  console.log(`people   : ${target!.people} total, ${target!.done} already detailed`);
  console.log(`remaining: ${target!.people - target!.done}`);
  console.log(`workers  : ${CONCURRENCY} (the client's 30/s token bucket still governs)\n`);

  const ing = new Ingestor(sql, new TmdbClient());
  const started = Date.now();
  let processed = 0;
  let failed = 0;

  for (;;) {
    if (processed >= CAP) break;
    const rows = await sql<{ tmdb_id: string }[]>`
      SELECT x.source_id AS tmdb_id
      FROM core.person p
      JOIN core.external_id x
        ON x.entity_type = 'person' AND x.entity_id = p.id AND x.source = 'tmdb'
      WHERE p.detail_synced_at IS NULL
      ORDER BY p.popularity DESC NULLS LAST
      LIMIT ${Math.min(ROUND, CAP - processed)}`;
    if (rows.length === 0) break;

    await mapPool(rows, CONCURRENCY, async (r) => {
      const id = Number(r.tmdb_id);
      if (!Number.isFinite(id)) return;
      try {
        await ing.hydratePerson(id);
      } catch (e) {
        failed++;
        // Keep going. A person TMDB has dropped should cost one row, not the run.
        if (failed <= 5) console.warn(`  person ${id}: ${e instanceof Error ? e.message : e}`);
      }
    });

    processed += rows.length;
    const elapsed = (Date.now() - started) / 1000;
    const rate = processed / elapsed;
    const left = target!.people - target!.done - processed;
    const eta = rate > 0 ? left / rate : 0;
    process.stdout.write(
      `\r${bar(target!.done + processed, target!.people)} ` +
        `${processed} this run · ${rate.toFixed(1)}/s · ` +
        `${left} left · eta ${(eta / 60).toFixed(0)}m   `,
    );
  }

  const [after] = await sql<{ done: number; people: number }[]>`
    SELECT count(*) FILTER (WHERE detail_synced_at IS NOT NULL)::int AS done,
           count(*)::int AS people FROM core.person`;
  console.log(
    `\n\ndone. ${after!.done} of ${after!.people} detailed` +
      `${failed > 0 ? ` · ${failed} failed and stay queued for the walk` : ''}`,
  );
} finally {
  await sql.end();
}
