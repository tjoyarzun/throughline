import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { Ingestor } from '@/server/ingest/ingest';
import { TmdbClient } from '@/server/providers/tmdb/client';
import { tmdbMovie, tmdbShow } from '@/server/providers/tmdb/schemas';

/**
 * Re-running ingest must produce byte-identical core state apart from
 * synced_at. This is not a nicety — it is what makes the whole architecture
 * work. If ingest is not idempotent then the seed cannot be resumed, the
 * nightly TMDB /changes delta corrupts the corpus a little every night, and
 * the crosswalk cannot be replayed.
 *
 * Runs entirely from captured fixtures, so it never touches the network.
 */
const URL = process.env.DATABASE_URL;
const run = URL ? describe : describe.skip;
let sql: ReturnType<typeof postgres>;

const movieFixture = tmdbMovie.parse(
  JSON.parse(readFileSync('tests/fixtures/tmdb/movie-329865-arrival.json', 'utf8')),
);
const showFixture = tmdbShow.parse(
  JSON.parse(readFileSync('tests/fixtures/tmdb/tv-1396-breaking-bad.json', 'utf8')),
);

/** Everything that must be stable across runs. synced_at deliberately excluded. */
async function fingerprint(s: ReturnType<typeof postgres>) {
  const [counts] = await s<Record<string, number>[]>`
    SELECT (SELECT count(*)::int FROM core.title)         AS titles,
           (SELECT count(*)::int FROM core.person)        AS people,
           (SELECT count(*)::int FROM core.credit)        AS credits,
           (SELECT count(*)::int FROM core.edge)          AS edges,
           (SELECT count(*)::int FROM core.concept)       AS concepts,
           (SELECT count(*)::int FROM core.season)        AS seasons,
           (SELECT count(*)::int FROM core.organization)  AS organizations,
           (SELECT count(*)::int FROM core.collection)    AS collections,
           (SELECT count(*)::int FROM core.external_id)   AS external_ids,
           (SELECT count(*)::int FROM core.title_keyword) AS keywords,
           (SELECT count(*)::int FROM core.er_review)     AS review_queue`;
  const edges = await s<{ sig: string }[]>`
    SELECT subject_type || '|' || subject_id || '|' || predicate || '|' ||
           object_type || '|' || object_id AS sig
    FROM core.edge ORDER BY 1`;
  const credits = await s<{ sig: string }[]>`
    SELECT person_id || '|' || title_id || '|' || predicate || '|' || coalesce(job, '') AS sig
    FROM core.credit ORDER BY 1`;
  return { counts, edges: edges.map((e) => e.sig), credits: credits.map((c) => c.sig) };
}

run('ingest idempotency', () => {
  beforeAll(() => {
    sql = postgres(URL!, { max: 4, prepare: false, onnotice: () => {} });
  });
  afterAll(async () => {
    await sql.end();
  });
  beforeEach(async () => {
    await sql`TRUNCATE core.title, core.person, core.concept, core.collection,
                       core.organization, core.edge, core.credit, core.external_id,
                       core.entity_alias, core.title_keyword, core.er_review CASCADE`;
  });

  it('a second identical movie ingest changes nothing but synced_at', async () => {
    const ing = new Ingestor(sql, new TmdbClient('fixture-token'));
    await ing.persistMovie(movieFixture);
    const first = await fingerprint(sql);
    const [t1] = await sql<{ synced_at: string }[]>`SELECT synced_at FROM core.title LIMIT 1`;

    // A fresh Ingestor, so the in-process caches cannot mask a non-idempotent write.
    const ing2 = new Ingestor(sql, new TmdbClient('fixture-token'));
    await ing2.persistMovie(movieFixture);
    const second = await fingerprint(sql);

    expect(second.counts).toEqual(first.counts);
    expect(second.edges).toEqual(first.edges);
    expect(second.credits).toEqual(first.credits);

    const [t2] = await sql<{ synced_at: string }[]>`SELECT synced_at FROM core.title LIMIT 1`;
    expect(new Date(t2!.synced_at).getTime()).toBeGreaterThanOrEqual(
      new Date(t1!.synced_at).getTime(),
    );
  });

  it('a second identical show ingest changes nothing', async () => {
    const ing = new Ingestor(sql, new TmdbClient('fixture-token'));
    await ing.persistShow(showFixture);
    const first = await fingerprint(sql);

    const ing2 = new Ingestor(sql, new TmdbClient('fixture-token'));
    await ing2.persistShow(showFixture);
    const second = await fingerprint(sql);

    expect(second.counts).toEqual(first.counts);
    expect(second.edges).toEqual(first.edges);
    expect(second.credits).toEqual(first.credits);
  });

  it('re-ingesting resolves to the same entity rather than creating a second', async () => {
    const ing = new Ingestor(sql, new TmdbClient('fixture-token'));
    const id1 = await ing.persistMovie(movieFixture);
    const ing2 = new Ingestor(sql, new TmdbClient('fixture-token'));
    const id2 = await ing2.persistMovie(movieFixture);
    expect(id2).toBe(id1);
    const [count] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM core.title`;
    expect(count!.n).toBe(1);
  });

  it('produces no ontology violations and no review-queue entries', async () => {
    // Every edge written by ingest passes the domain/range trigger, or the
    // insert would have thrown. This asserts the clean-corpus expectation.
    const ing = new Ingestor(sql, new TmdbClient('fixture-token'));
    await ing.persistMovie(movieFixture);
    await ing.persistShow(showFixture);
    const review = await sql`SELECT * FROM core.er_review`;
    expect(review).toHaveLength(0);

    const undeclared = await sql`
      SELECT DISTINCT e.predicate FROM core.edge e
      LEFT JOIN core.predicate_meta m ON m.predicate = e.predicate
      WHERE m.predicate IS NULL`;
    expect(undeclared).toHaveLength(0);
  });

  it('keeps raw keywords out of core.concept and core.edge', async () => {
    // A folksonomy of 8k terms must not pollute the curated vocabulary, and
    // the ontology trigger rejects it as an edge. They belong in title_keyword.
    const ing = new Ingestor(sql, new TmdbClient('fixture-token'));
    await ing.persistMovie(movieFixture);

    const kw = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM core.title_keyword`;
    expect(kw[0]!.n).toBeGreaterThan(10);

    const schemes = await sql<{ scheme: string }[]>`SELECT DISTINCT scheme FROM core.concept`;
    expect(schemes.map((s) => s.scheme).sort()).toEqual(['genre']);
  });

  it('records external ids for both TMDB and IMDb', async () => {
    const ing = new Ingestor(sql, new TmdbClient('fixture-token'));
    await ing.persistMovie(movieFixture);
    const ids = await sql<{ source: string; is_primary: boolean }[]>`
      SELECT source, is_primary FROM core.external_id WHERE entity_type = 'title' ORDER BY source`;
    expect(ids.map((i) => i.source)).toEqual(['imdb', 'tmdb']);
    expect(ids.find((i) => i.source === 'tmdb')!.is_primary, 'TMDB is the spine').toBe(true);
  });
});
