/**
 * Seeds the canonical corpus.
 *
 * CORPUS COMPOSITION IS A DELIBERATE CHOICE, not just "grab popular titles".
 * A keyword census (docs/ontology.md) found TMDB's `popular` endpoints are
 * heavily anime- and recent-TV-weighted — `anime` was the single most common
 * keyword at 63 occurrences across 448 titles. Seeding from popularity alone
 * produces a Universe that looks like a MyAnimeList clone and a graph with no
 * historical depth.
 *
 * So the corpus is assembled from four sources with different biases:
 *   1. Top-rated movies and TV      — critical consensus, all eras
 *   2. Decade sampling via discover — forces historical spread
 *   3. Director filmographies       — dense, connected subgraphs; this is what
 *                                     makes path finding produce good answers
 *   4. Franchise completion         — part_of_franchise edges with real coverage
 *
 * Idempotent: re-running changes nothing but synced_at. Resumable: already
 * ingested titles are skipped cheaply via core.external_id.
 *
 * Usage: pnpm seed [--limit N] [--skip-directors] [--skip-franchises]
 */
import postgres from 'postgres';
import { TmdbClient } from '@/server/providers/tmdb/client';
import { Ingestor } from '@/server/ingest/ingest';
import { tmdbPaged, tmdbListItem } from '@/server/providers/tmdb/schemas';

const args = process.argv.slice(2);
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;
const SKIP_DIRECTORS = args.includes('--skip-directors');
const SKIP_FRANCHISES = args.includes('--skip-franchises');

/**
 * Directors chosen for breadth across era, country and register — not a
 * "greatest" list. Dense filmographies are what give the path finder
 * interesting intermediate nodes to route through.
 */
/* cspell:disable -- a block of proper nouns; spell checking them is noise. */
const DIRECTORS = [
  'Denis Villeneuve',
  'Christopher Nolan',
  'Greta Gerwig',
  'Bong Joon-ho',
  'Alfonso Cuarón',
  'Akira Kurosawa',
  'Agnès Varda',
  'Stanley Kubrick',
  'Hayao Miyazaki',
  'Martin Scorsese',
  'Wong Kar-wai',
  'Céline Sciamma',
  'Paul Thomas Anderson',
  'Chloé Zhao',
  'Spike Lee',
  'Kathryn Bigelow',
  'Guillermo del Toro',
  'Jordan Peele',
  'Ari Aster',
  'Lynne Ramsay',
  'Coen Brothers',
  'Wes Anderson',
  'Sofia Coppola',
  'David Fincher',
  'Ridley Scott',
  'Steven Spielberg',
  'Quentin Tarantino',
  'Hirokazu Kore-eda',
  'Asghar Farhadi',
  'Pedro Almodóvar',
  'Andrei Tarkovsky',
  'Ingmar Bergman',
  'Federico Fellini',
  'Yasujirō Ozu',
  'Satyajit Ray',
  'Barry Jenkins',
  'Ryan Coogler',
  'Taika Waititi',
  'Lulu Wang',
  'Alice Rohrwacher',
  'Michael Mann',
  'Alejandro González Iñárritu',
  'Darren Aronofsky',
  'Park Chan-wook',
  'Lars von Trier',
  'Terrence Malick',
  'Francis Ford Coppola',
  'Sidney Lumet',
  'Billy Wilder',
  'Alfred Hitchcock',
  'John Carpenter',
  'David Cronenberg',
  'David Lynch',
  'Mike Leigh',
  'Ken Loach',
  'Claire Denis',
  'Jane Campion',
  'Kelly Reichardt',
  'Debra Granik',
  'Ava DuVernay',
];

const sql = postgres(process.env.DATABASE_URL!, { max: 6, prepare: false, onnotice: () => {} });

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

const movieIds = new Set<number>();
const showIds = new Set<number>();
const t0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`);

async function collect(path: string, pages: number, into: Set<number>): Promise<void> {
  for (let p = 1; p <= pages; p++) {
    const raw = await tmdb.list(path, p);
    const parsed = tmdbPaged(tmdbListItem).safeParse(raw);
    if (!parsed.success) break;
    for (const r of parsed.data.results) into.add(r.id);
    if (p >= parsed.data.total_pages) break;
  }
}

async function collectDiscover(params: Record<string, string>, pages: number): Promise<void> {
  for (let p = 1; p <= pages; p++) {
    const raw = await tmdb.discover({ ...params, page: String(p) });
    const parsed = tmdbPaged(tmdbListItem).safeParse(raw);
    if (!parsed.success) break;
    for (const r of parsed.data.results) movieIds.add(r.id);
    if (p >= parsed.data.total_pages) break;
  }
}

async function main(): Promise<void> {
  log('1/4 critical consensus');
  await collect('/movie/top_rated', 60, movieIds);
  await collect('/tv/top_rated', 15, showIds);
  log(`  movies ${movieIds.size}, shows ${showIds.size}`);

  log('2/4 decade sampling (forces historical spread popularity will not give us)');
  for (let decade = 1930; decade <= 2020; decade += 10) {
    await collectDiscover(
      {
        'primary_release_date.gte': `${decade}-01-01`,
        'primary_release_date.lte': `${decade + 9}-12-31`,
        sort_by: 'vote_count.desc',
        'vote_count.gte': '200',
      },
      decade >= 1980 ? 12 : 6,
    );
  }
  log(`  movies ${movieIds.size}`);

  const directorIds: number[] = [];
  if (!SKIP_DIRECTORS) {
    log('3/4 director filmographies (dense subgraphs for path finding)');
    for (const name of DIRECTORS) {
      const found = (await tmdb.list(`/search/person?query=${encodeURIComponent(name)}`, 1)) as {
        results?: { id: number; name: string }[];
      } | null;
      const match = found?.results?.[0];
      if (!match) continue;
      directorIds.push(match.id);
      const credits = (await tmdb.personCredits(match.id, 'movie')) as {
        crew?: { id: number; job: string }[];
      } | null;
      for (const c of credits?.crew ?? []) {
        if (c.job === 'Director') movieIds.add(c.id);
      }
    }
    log(`  ${directorIds.length} directors resolved, movies ${movieIds.size}`);
  }

  const ordered = [...movieIds].slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);
  const orderedShows = [...showIds].slice(
    0,
    Number.isFinite(LIMIT) ? Math.ceil(LIMIT / 10) : undefined,
  );

  log(`4/4 ingesting ${ordered.length} movies and ${orderedShows.length} shows`);
  let done = 0;
  for (const id of ordered) {
    try {
      await ing.ingestMovie(id);
    } catch (e) {
      console.error(`  movie ${id} failed: ${e instanceof Error ? e.message : e}`);
    }
    if (++done % 250 === 0) log(`  ${done}/${ordered.length} · ${JSON.stringify(ing.stats)}`);
  }
  for (const id of orderedShows) {
    try {
      await ing.ingestShow(id);
    } catch (e) {
      console.error(`  show ${id} failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (!SKIP_FRANCHISES) {
    log('completing franchises already referenced by the corpus');
    const collections = await sql<{ source_id: string }[]>`
      SELECT source_id FROM core.external_id WHERE entity_type = 'collection' AND source = 'tmdb'`;
    for (const c of collections) {
      const col = (await tmdb.collection(Number(c.source_id))) as {
        parts?: { id: number }[];
      } | null;
      for (const part of col?.parts ?? []) {
        if (movieIds.has(part.id)) continue;
        try {
          await ing.ingestMovie(part.id);
          movieIds.add(part.id);
        } catch {
          /* a missing franchise entry is not worth failing the seed over */
        }
      }
    }
  }

  const [report] = await sql`
    SELECT (SELECT count(*) FROM core.title)         AS titles,
           (SELECT count(*) FROM core.title WHERE kind='show') AS shows,
           (SELECT count(*) FROM core.person)        AS people,
           (SELECT count(*) FROM core.credit)        AS credits,
           (SELECT count(*) FROM core.edge)          AS edges,
           (SELECT count(*) FROM core.concept)       AS concepts,
           (SELECT count(*) FROM core.collection)    AS collections,
           (SELECT count(*) FROM core.organization)  AS organizations,
           (SELECT count(*) FROM core.title_keyword) AS keyword_links,
           (SELECT count(DISTINCT keyword_source_id) FROM core.title_keyword) AS distinct_keywords,
           (SELECT count(*) FROM core.er_review)     AS review_queue,
           (SELECT count(*) FROM raw.tmdb_payload)   AS raw_payloads`;
  log('done');
  console.log('corpus:', report);
  console.log('ingest:', ing.stats);
  console.log('tmdb:', tmdb.getStats());
  await sql`REFRESH MATERIALIZED VIEW core.node_degree`;
  await sql.end();
}

main().catch(async (e) => {
  console.error('seed FAILED:', e);
  await sql.end();
  process.exit(1);
});
