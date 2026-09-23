import postgres from 'postgres';
import { Ingestor } from '../src/server/ingest/ingest';
import { TmdbClient } from '../src/server/providers/tmdb/client';
import { mapPool } from '../src/lib/pool';
import { targetDatabase } from './lib/target-db';
import { bar } from './lib/progress';

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
 * Run it through the package script, which loads .env.local for the TMDB
 * token, and name the database explicitly:
 *
 *   pnpm hydrate:people                      # whatever .env.local names
 *   pnpm hydrate:people --url '<neon url>'   # somewhere else, unambiguously
 *   ... --limit 500      stop after N people (a dry-ish run)
 *   ... --concurrency 4  gentler on the provider
 *
 * --url beats every environment variable, including one left exported in the
 * shell from an earlier command. Prefix the whole line with a space to keep a
 * connection string out of your history.
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

/* Refuses to guess when the environment names two different databases -- see
   scripts/lib/target-db.ts for the run this cost. */
const target = targetDatabase('hydrate-people');

const sql = postgres(target.url, { max: 6, prepare: false, onnotice: () => {} });

try {
  const [counts] = await sql<{ host: string; people: number; done: number }[]>`
    SELECT current_setting('server_version') AS host,
           count(*)::int AS people,
           count(*) FILTER (WHERE detail_synced_at IS NOT NULL)::int AS done
    FROM core.person`;

  console.log(`database : ${target.label}   (from ${target.source})`);
  console.log(`people   : ${counts!.people} total, ${counts!.done} already detailed`);
  console.log(`remaining: ${counts!.people - counts!.done}`);
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
    const left = Math.max(0, counts!.people - counts!.done - processed);
    const eta = rate > 0 ? left / rate : 0;
    process.stdout.write(
      `\r${bar(counts!.done + processed, counts!.people)} ` +
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
