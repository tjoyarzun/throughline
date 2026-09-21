import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { resolveTitle, resolvePerson, mergeEntities, revertMerge } from '@/server/ingest/resolve';
import { normalizeTitle, personSortName, slugify } from '@/server/ingest/normalize';

/**
 * Entity resolution against the cases that actually break naive matchers.
 *
 * The assertions that matter most are the NEGATIVE ones. Anyone can write a
 * resolver that merges two records of the same film; the hard part is refusing
 * to merge The Office (2001, UK) into The Office (2005, US) when the titles are
 * a perfect string match and the years are four apart.
 */
const URL = process.env.DATABASE_URL;
const run = URL ? describe : describe.skip;
let sql: ReturnType<typeof postgres>;

const PREFIX = 'ertest-';

async function makeTitle(
  s: ReturnType<typeof postgres>,
  opts: {
    slug: string;
    kind: 'movie' | 'show';
    title: string;
    year: number | null;
    runtime?: number | null;
    tmdbId: number;
    imdbId?: string;
  },
): Promise<string> {
  const [row] = await s<{ id: string }[]>`
    INSERT INTO core.title (slug, kind, title, sort_title, release_date, runtime_minutes)
    VALUES (${PREFIX + opts.slug}, ${opts.kind}, ${opts.title}, ${normalizeTitle(opts.title)},
            ${opts.year ? `${opts.year}-01-01` : null}, ${opts.runtime ?? null})
    RETURNING id`;
  await s`INSERT INTO core.external_id (source, source_id, entity_type, entity_id, is_primary)
          VALUES ('tmdb', ${String(opts.tmdbId)}, 'title', ${row!.id}, true)`;
  if (opts.imdbId) {
    await s`INSERT INTO core.external_id (source, source_id, entity_type, entity_id, is_primary)
            VALUES ('imdb', ${opts.imdbId}, 'title', ${row!.id}, false)`;
  }
  return row!.id;
}

async function makePerson(
  s: ReturnType<typeof postgres>,
  opts: { name: string; tmdbId: number; birthday?: string | null },
): Promise<string> {
  const [row] = await s<{ id: string }[]>`
    INSERT INTO core.person (slug, name, sort_name, birthday)
    VALUES (${PREFIX + slugify(opts.name, opts.tmdbId)}, ${opts.name},
            ${personSortName(opts.name)}, ${opts.birthday ?? null})
    RETURNING id`;
  await s`INSERT INTO core.external_id (source, source_id, entity_type, entity_id, is_primary)
          VALUES ('tmdb', ${String(opts.tmdbId)}, 'person', ${row!.id}, true)`;
  return row!.id;
}

/**
 * core.external_id.entity_id is polymorphic, so Postgres cannot enforce a
 * foreign key on it and deleting an entity does NOT cascade to its external
 * ids. Cleanup has to be explicit — and the same gap exists in production,
 * which is why data-quality checks include an orphan sweep.
 */
async function cleanup(s: ReturnType<typeof postgres>): Promise<void> {
  await s`DELETE FROM core.er_review WHERE incoming_source_id LIKE '9%'`;
  await s`DELETE FROM core.external_id WHERE source_id LIKE '9%' AND source = 'tmdb'`;
  await s`DELETE FROM core.external_id WHERE source = 'imdb' AND source_id = 'tt1856101'
            AND entity_id IN (SELECT id FROM core.title WHERE slug LIKE ${PREFIX + '%'})`;
  await s`DELETE FROM core.entity_alias
          WHERE entity_id IN (SELECT id FROM core.person WHERE slug LIKE ${PREFIX + '%'})
             OR entity_id IN (SELECT id FROM core.title WHERE slug LIKE ${PREFIX + '%'})`;
  await s`DELETE FROM core.title WHERE slug LIKE ${PREFIX + '%'}`;
  await s`DELETE FROM core.person WHERE slug LIKE ${PREFIX + '%'}`;
}

async function cast(s: ReturnType<typeof postgres>, personId: string, titleId: string, order = 0) {
  await s`INSERT INTO core.credit (person_id, title_id, predicate, billing_order, job)
          VALUES (${personId}, ${titleId}, 'acted_in', ${order}, 'Actor')
          ON CONFLICT DO NOTHING`;
}

run('entity resolution', () => {
  beforeAll(() => {
    sql = postgres(URL!, { max: 3, prepare: false, onnotice: () => {} });
  });
  afterAll(async () => {
    await cleanup(sql);
    await sql.end();
  });
  beforeEach(async () => {
    await cleanup(sql);
  });

  it('resolves by exact primary-source id — the 97% case', async () => {
    const id = await makeTitle(sql, {
      slug: 'arrival',
      kind: 'movie',
      title: 'Arrival',
      year: 2016,
      runtime: 116,
      tmdbId: 900001,
    });
    const r = await resolveTitle(sql, {
      tmdbId: 900001,
      imdbId: null,
      kind: 'movie',
      title: 'Arrival',
      releaseYear: 2016,
      runtimeMinutes: 116,
      topCastTmdbIds: [],
    });
    expect(r.method).toBe('external_id');
    expect(r.entityId).toBe(id);
    expect(r.created).toBe(false);
  });

  it('crosswalks through a shared IMDb id when the TMDB id is unknown', async () => {
    // This is how Wikidata and OMDb attach to a TMDB-seeded entity without
    // creating a second copy of the film.
    const id = await makeTitle(sql, {
      slug: 'br2049',
      kind: 'movie',
      title: 'Blade Runner 2049',
      year: 2017,
      runtime: 164,
      tmdbId: 900002,
      imdbId: 'tt1856101',
    });
    const r = await resolveTitle(sql, {
      tmdbId: 900099,
      imdbId: 'tt1856101',
      kind: 'movie',
      title: 'Blade Runner 2049',
      releaseYear: 2017,
      runtimeMinutes: 164,
      topCastTmdbIds: [],
    });
    expect(r.method).toBe('crosswalk');
    expect(r.entityId).toBe(id);
    const links = await sql`SELECT source FROM core.external_id
                            WHERE entity_type='title' AND entity_id=${id} ORDER BY source`;
    expect(links.map((l) => l.source)).toEqual(['imdb', 'tmdb', 'tmdb']);
  });

  it('REFUSES to merge The Office UK into The Office US', async () => {
    // Identical normalized title, entirely different casts. A title-similarity
    // matcher merges these. Ours must not.
    //
    // It does not even reach the review queue, and that is correct rather than
    // a gap: 2001 and 2005 are four years apart, so the blocking key excludes
    // the UK show from the candidate set before similarity is ever computed.
    // This is not an ambiguous pair; it is plainly two different shows. The
    // genuinely ambiguous case — same title, same year, no shared cast — is
    // the test below.
    const uk = await makeTitle(sql, {
      slug: 'office-uk',
      kind: 'show',
      title: 'The Office',
      year: 2001,
      runtime: 30,
      tmdbId: 900010,
    });
    const gervais = await makePerson(sql, { name: 'Ricky Gervais', tmdbId: 900011 });
    await cast(sql, gervais, uk);

    const r = await resolveTitle(sql, {
      tmdbId: 900012,
      imdbId: null,
      kind: 'show',
      title: 'The Office',
      releaseYear: 2005,
      runtimeMinutes: 22,
      topCastTmdbIds: [900013], // Steve Carell, unknown here
    });
    expect(r.created, 'the US Office must become its own entity').toBe(true);

    const stillSeparate = await sql`SELECT count(*)::int AS n FROM core.title
                                    WHERE sort_title = 'office' AND slug LIKE ${PREFIX + '%'}`;
    expect(Number(stillSeparate[0]!.n)).toBe(1); // only the UK one we inserted
  });

  it('queues a genuinely ambiguous pair: same title, same year, no shared cast', async () => {
    // Inside the blocking window and a perfect title match, but nothing
    // corroborates it. This is the band where guessing is unacceptable and a
    // human has to look.
    const a = await makeTitle(sql, {
      slug: 'crash-2004',
      kind: 'movie',
      title: 'Crash',
      year: 2004,
      runtime: 112,
      tmdbId: 900014,
    });
    const someone = await makePerson(sql, { name: 'Unshared Actor', tmdbId: 900015 });
    await cast(sql, someone, a);

    const r = await resolveTitle(sql, {
      tmdbId: 900016,
      imdbId: null,
      kind: 'movie',
      title: 'Crash',
      releaseYear: 2004,
      runtimeMinutes: 110,
      topCastTmdbIds: [900017],
    });
    expect(r.created, 'never guess in the ambiguous band').toBe(true);

    const review = await sql`SELECT * FROM core.er_review WHERE incoming_source_id = '900016'`;
    expect(review, 'the near-miss must reach a human').toHaveLength(1);
    expect(review[0]!.evidence.reason).toMatch(/no shared cast/i);
    expect(review[0]!.candidate_entity_id).toBe(a);
  });

  it('REFUSES to merge two unrelated Pinocchio films', async () => {
    await makeTitle(sql, {
      slug: 'pinocchio-1940',
      kind: 'movie',
      title: 'Pinocchio',
      year: 1940,
      runtime: 88,
      tmdbId: 900020,
    });
    const r = await resolveTitle(sql, {
      tmdbId: 900021,
      imdbId: null,
      kind: 'movie',
      title: 'Pinocchio',
      releaseYear: 2022,
      runtimeMinutes: 117,
      topCastTmdbIds: [],
    });
    // 1940 and 2022 are not even in the same block, so this is not close.
    expect(r.created).toBe(true);
    const review = await sql`SELECT * FROM core.er_review WHERE incoming_source_id = '900021'`;
    expect(review, 'far-apart years should not even reach the review queue').toHaveLength(0);
  });

  it('REFUSES to merge Dune 1984 into Dune 2021', async () => {
    await makeTitle(sql, {
      slug: 'dune-1984',
      kind: 'movie',
      title: 'Dune',
      year: 1984,
      runtime: 137,
      tmdbId: 900030,
    });
    const r = await resolveTitle(sql, {
      tmdbId: 900031,
      imdbId: null,
      kind: 'movie',
      title: 'Dune',
      releaseYear: 2021,
      runtimeMinutes: 155,
      topCastTmdbIds: [],
    });
    expect(r.created).toBe(true);
  });

  it('DOES merge a same-year re-ingest corroborated by shared cast', async () => {
    const id = await makeTitle(sql, {
      slug: 'arrival2',
      kind: 'movie',
      title: 'Arrival',
      year: 2016,
      runtime: 116,
      tmdbId: 900040,
    });
    const amy = await makePerson(sql, { name: 'Amy Adams', tmdbId: 900041 });
    await cast(sql, amy, id, 0);

    const r = await resolveTitle(sql, {
      tmdbId: 900042,
      imdbId: null,
      kind: 'movie',
      title: 'Arrival',
      releaseYear: 2016,
      runtimeMinutes: 116,
      topCastTmdbIds: [900041],
    });
    expect(r.method).toBe('blocking_exact');
    expect(r.entityId).toBe(id);
  });

  it('refuses a fuzzy title match when the runtime is incompatible', async () => {
    const id = await makeTitle(sql, {
      slug: 'longcut',
      kind: 'movie',
      title: 'Nostalgia',
      year: 2018,
      runtime: 90,
      tmdbId: 900050,
    });
    const p = await makePerson(sql, { name: 'Shared Actor', tmdbId: 900051 });
    await cast(sql, p, id);
    const r = await resolveTitle(sql, {
      tmdbId: 900052,
      imdbId: null,
      kind: 'movie',
      title: 'Nostalgia',
      releaseYear: 2018,
      runtimeMinutes: 220,
      topCastTmdbIds: [900051],
    });
    expect(r.created).toBe(true);
  });

  it('never fuzzy-matches a person on name alone', async () => {
    // TMDB itself carries duplicate person records and names collide heavily.
    // Filmography overlap is the strong signal; the name is the weak one.
    const t1 = await makeTitle(sql, {
      slug: 'p1',
      kind: 'movie',
      title: 'Some Film',
      year: 2010,
      tmdbId: 900060,
    });
    const existing = await makePerson(sql, {
      name: 'Chris Evans',
      tmdbId: 900061,
      birthday: '1981-06-13',
    });
    await cast(sql, existing, t1);

    const r = await resolvePerson(sql, {
      tmdbId: 900062,
      imdbId: null,
      name: 'Chris Evans',
      birthday: '1966-04-29',
      knownTitleIds: [t1],
    });
    expect(r.created, 'different birthday means a different human').toBe(true);
  });

  it('merges a person on filmography overlap', async () => {
    const t1 = await makeTitle(sql, {
      slug: 'p2a',
      kind: 'movie',
      title: 'Film A',
      year: 2010,
      tmdbId: 900070,
    });
    const t2 = await makeTitle(sql, {
      slug: 'p2b',
      kind: 'movie',
      title: 'Film B',
      year: 2012,
      tmdbId: 900071,
    });
    const existing = await makePerson(sql, { name: 'Jane Overlap', tmdbId: 900072 });
    await cast(sql, existing, t1);
    await cast(sql, existing, t2);

    const r = await resolvePerson(sql, {
      tmdbId: 900073,
      imdbId: null,
      name: 'Jane Overlap',
      birthday: null,
      knownTitleIds: [t1, t2],
    });
    expect(r.method).toBe('fuzzy_corroborated');
    expect(r.entityId).toBe(existing);
  });

  it('does NOT queue an identical name with zero shared filmography', async () => {
    // Zero overlap is evidence of two different people, not ambiguity. Steve
    // McQueen the actor and Steve McQueen the director share a name and nothing
    // else. Queueing these filled the review queue with 206 correct refusals
    // and buried the cases that actually need a decision — a queue nobody reads
    // is worse than no queue.
    const t1 = await makeTitle(sql, {
      slug: 'p4a',
      kind: 'movie',
      title: 'Film D',
      year: 2010,
      tmdbId: 900090,
    });
    const t2 = await makeTitle(sql, {
      slug: 'p4b',
      kind: 'movie',
      title: 'Film E',
      year: 2015,
      tmdbId: 900091,
    });
    const existing = await makePerson(sql, { name: 'Steve Namesake', tmdbId: 900092 });
    await cast(sql, existing, t1);

    const r = await resolvePerson(sql, {
      tmdbId: 900093,
      imdbId: null,
      name: 'Steve Namesake',
      birthday: null,
      knownTitleIds: [t2], // no overlap with the existing person at all
    });
    expect(r.created).toBe(true);
    const review = await sql`SELECT * FROM core.er_review WHERE incoming_source_id = '900093'`;
    expect(review, 'zero overlap must not reach the queue').toHaveLength(0);
  });

  it('queues, rather than guesses, on an identical name with one shared title', async () => {
    const t1 = await makeTitle(sql, {
      slug: 'p3a',
      kind: 'movie',
      title: 'Film C',
      year: 2010,
      tmdbId: 900080,
    });
    const existing = await makePerson(sql, { name: 'Sam Ambiguous', tmdbId: 900081 });
    await cast(sql, existing, t1);
    const r = await resolvePerson(sql, {
      tmdbId: 900082,
      imdbId: null,
      name: 'Sam Ambiguous',
      birthday: null,
      knownTitleIds: [t1],
    });
    expect(r.created).toBe(true);
    const review = await sql`SELECT * FROM core.er_review WHERE incoming_source_id = '900082'`;
    expect(review).toHaveLength(1);
    expect(review[0]!.evidence.filmography_overlap).toBe(1);
  });
});

run('merge and revert', () => {
  beforeAll(() => {
    sql = postgres(URL!, { max: 3, prepare: false, onnotice: () => {} });
  });
  afterAll(async () => {
    await sql.end();
  });
  beforeEach(async () => {
    await cleanup(sql);
  });

  it('round-trips a person merge exactly', async () => {
    const t1 = await makeTitle(sql, {
      slug: 'm1',
      kind: 'movie',
      title: 'Merge One',
      year: 2000,
      tmdbId: 910001,
    });
    const t2 = await makeTitle(sql, {
      slug: 'm2',
      kind: 'movie',
      title: 'Merge Two',
      year: 2001,
      tmdbId: 910002,
    });
    const keep = await makePerson(sql, { name: 'Keeper Person', tmdbId: 910010 });
    const dupe = await makePerson(sql, { name: 'Keeper Person', tmdbId: 910011 });
    await cast(sql, keep, t1);
    await cast(sql, dupe, t2);

    const { mergeId, repointed } = await mergeEntities(sql, 'person', keep, dupe, 'test duplicate');
    expect(repointed).toBe(1);

    expect(await sql`SELECT 1 FROM core.person WHERE id = ${dupe}`).toHaveLength(0);
    const credits = await sql`SELECT title_id FROM core.credit WHERE person_id = ${keep}`;
    expect(credits).toHaveLength(2);
    // The merged external id now points at the survivor.
    const [x] = await sql`SELECT entity_id FROM core.external_id
                          WHERE source='tmdb' AND source_id='910011' AND entity_type='person'`;
    expect(x!.entity_id).toBe(keep);
    // And the merged name stays searchable.
    const alias = await sql`SELECT alias FROM core.entity_alias
                            WHERE entity_id = ${keep} AND alias_type = 'merged_from'`;
    expect(alias).toHaveLength(1);

    await revertMerge(sql, mergeId);

    expect(await sql`SELECT 1 FROM core.person WHERE id = ${dupe}`).toHaveLength(1);
    expect(await sql`SELECT 1 FROM core.credit WHERE person_id = ${keep}`).toHaveLength(1);
    expect(await sql`SELECT 1 FROM core.credit WHERE person_id = ${dupe}`).toHaveLength(1);
    const [back] = await sql`SELECT entity_id FROM core.external_id
                             WHERE source='tmdb' AND source_id='910011' AND entity_type='person'`;
    expect(back!.entity_id).toBe(dupe);
    expect(
      await sql`SELECT alias FROM core.entity_alias
                     WHERE entity_id = ${keep} AND alias_type='merged_from'`,
    ).toHaveLength(0);
  });

  it('collapses duplicate edges rather than aborting on the unique constraint', async () => {
    const keep = await makeTitle(sql, {
      slug: 'e1',
      kind: 'movie',
      title: 'Edge Keep',
      year: 2000,
      tmdbId: 910020,
    });
    const dupe = await makeTitle(sql, {
      slug: 'e2',
      kind: 'movie',
      title: 'Edge Dupe',
      year: 2000,
      tmdbId: 910021,
    });
    const [g] = await sql<{ id: string }[]>`
      INSERT INTO core.concept (scheme, slug, label) VALUES ('genre', 'ertest-drama', 'ErTest Drama')
      ON CONFLICT (scheme, slug) DO UPDATE SET label = excluded.label RETURNING id`;
    // Both titles carry the same genre edge, so one must collapse.
    for (const t of [keep, dupe]) {
      await sql`INSERT INTO core.edge (subject_type, subject_id, predicate, object_type, object_id, provenance)
                VALUES ('title', ${t}, 'belongs_to_genre', 'concept', ${g!.id}, 'asserted')`;
    }

    const { collapsed } = await mergeEntities(sql, 'title', keep, dupe, 'duplicate edge test');
    expect(collapsed).toBe(1);
    const edges =
      await sql`SELECT 1 FROM core.edge WHERE subject_id = ${keep} AND predicate = 'belongs_to_genre'`;
    expect(edges).toHaveLength(1);
    await sql`DELETE FROM core.concept WHERE slug = 'ertest-drama'`;
  });

  it('refuses to merge an entity into itself, and refuses a double revert', async () => {
    const a = await makePerson(sql, { name: 'Self Merge', tmdbId: 910030 });
    await expect(mergeEntities(sql, 'person', a, a, 'nope')).rejects.toThrow(/into itself/i);

    const b = await makePerson(sql, { name: 'Self Merge', tmdbId: 910031 });
    const { mergeId } = await mergeEntities(sql, 'person', a, b, 'test');
    await revertMerge(sql, mergeId);
    await expect(revertMerge(sql, mergeId)).rejects.toThrow(/already reverted/i);
  });
});
