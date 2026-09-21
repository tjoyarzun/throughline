/** Live ingest smoke test. Not part of CI — it hits the real TMDB API. */
import postgres from 'postgres';
import { TmdbClient } from '@/server/providers/tmdb/client';
import { Ingestor } from '@/server/ingest/ingest';

const sql = postgres(process.env.DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });

const captureRaw = async (
  resource: string,
  sourceId: string,
  variant: string,
  payload: unknown,
  status: number,
) => {
  await sql`INSERT INTO raw.tmdb_payload (resource, source_id, variant, payload, http_status)
            VALUES (${resource}, ${sourceId}, ${variant}, ${sql.json(payload as never)}, ${status})
            ON CONFLICT (resource, source_id, variant)
            DO UPDATE SET payload = excluded.payload, fetched_at = now()`;
};

const tmdb = new TmdbClient(undefined, captureRaw);
const ing = new Ingestor(sql, tmdb);

// Arrival, Blade Runner 2049, Dune (2021) — three Villeneuve films, so the
// path finder has something real to work with — plus one show.
for (const id of [329865, 335984, 438631]) await ing.ingestMovie(id);
await ing.ingestShow(1396); // Breaking Bad

console.log('stats:', ing.stats);
console.log('tmdb:', tmdb.getStats());

const report = await sql`
  SELECT
    (SELECT count(*) FROM core.title)         AS titles,
    (SELECT count(*) FROM core.person)        AS people,
    (SELECT count(*) FROM core.credit)        AS credits,
    (SELECT count(*) FROM core.edge)          AS edges,
    (SELECT count(*) FROM core.concept)       AS concepts,
    (SELECT count(*) FROM core.title_keyword) AS keywords,
    (SELECT count(*) FROM core.season)        AS seasons,
    (SELECT count(*) FROM core.er_review)     AS review_queue,
    (SELECT count(*) FROM raw.tmdb_payload)   AS raw_payloads`;
console.log('db:', report[0]);

console.log('\nVilleneuve filmography via sem.edge:');
const f = await sql`
  SELECT t.title, e.predicate FROM sem.edge e
  JOIN core.person p ON p.id = e.subject_id AND e.subject_type = 'person'
  JOIN core.title t ON t.id = e.object_id AND e.object_type = 'title'
  WHERE p.name = 'Denis Villeneuve' ORDER BY t.title, e.predicate`;
f.forEach((r) => console.log(`  ${r.predicate.padEnd(14)} ${r.title}`));

console.log('\nsem.title for Arrival:');
const [a] =
  await sql`SELECT title, release_year, genres, primary_director, franchise FROM sem.title WHERE title = 'Arrival'`;
console.log(' ', a);
await sql.end();
