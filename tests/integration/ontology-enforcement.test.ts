import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

/**
 * Proves the DATABASE enforces the ontology — not the application, not a
 * convention, not a code review. Every one of these inserts is rejected in
 * every code path, including ad hoc psql.
 */
const URL = process.env.DATABASE_URL;
const run = URL ? describe : describe.skip;

let sql: ReturnType<typeof postgres>;
let arrival: string;
let br2049: string;
let villeneuve: string;
let genreSciFi: string;
let themeMemory: string;

run('ontology enforcement (database level)', () => {
  beforeAll(async () => {
    sql = postgres(URL!, { max: 2, prepare: false, onnotice: () => {} });
    const t = await sql<{ id: string; slug: string }[]>`
      INSERT INTO core.title (slug, kind, title, sort_title, release_date) VALUES
        ('onto-arrival','movie','Arrival', core.normalize_title('Arrival'),'2016-11-11'),
        ('onto-br2049','movie','Blade Runner 2049', core.normalize_title('Blade Runner 2049'),'2017-10-06')
      ON CONFLICT (slug) DO UPDATE SET title = excluded.title RETURNING id, slug`;
    arrival = t.find((r) => r.slug === 'onto-arrival')!.id;
    br2049 = t.find((r) => r.slug === 'onto-br2049')!.id;

    const [p] = await sql<{ id: string }[]>`
      INSERT INTO core.person (slug, name, sort_name)
      VALUES ('onto-villeneuve','Denis Villeneuve','villeneuve denis')
      ON CONFLICT (slug) DO UPDATE SET name = excluded.name RETURNING id`;
    villeneuve = p!.id;

    const c = await sql<{ id: string; slug: string }[]>`
      INSERT INTO core.concept (scheme, slug, label, is_curated) VALUES
        ('genre','onto-scifi','Science Fiction', false),
        ('theme','onto-memory','Memory', true)
      ON CONFLICT (scheme, slug) DO UPDATE SET label = excluded.label RETURNING id, slug`;
    genreSciFi = c.find((r) => r.slug === 'onto-scifi')!.id;
    themeMemory = c.find((r) => r.slug === 'onto-memory')!.id;
  });

  afterAll(async () => {
    await sql`DELETE FROM core.title WHERE slug LIKE 'onto-%'`;
    await sql`DELETE FROM core.person WHERE slug LIKE 'onto-%'`;
    await sql`DELETE FROM core.concept WHERE slug LIKE 'onto-%'`;
    await sql.end();
  });

  it('accepts an edge that satisfies its declared domain and range', async () => {
    const rows = await sql`
      INSERT INTO core.edge (subject_type, subject_id, predicate, object_type, object_id, provenance)
      VALUES ('title', ${arrival}, 'belongs_to_genre', 'concept', ${genreSciFi}, 'asserted')
      ON CONFLICT DO NOTHING RETURNING id`;
    expect(rows.length).toBeGreaterThanOrEqual(0);
    const [check] = await sql`
      SELECT 1 FROM core.edge WHERE subject_id = ${arrival} AND predicate = 'belongs_to_genre'`;
    expect(check).toBeDefined();
  });

  it('rejects a predicate that is not declared in ontology.yaml', async () => {
    await expect(
      sql`INSERT INTO core.edge (subject_type, subject_id, predicate, object_type, object_id, provenance)
          VALUES ('title', ${arrival}, 'vibes_with', 'concept', ${themeMemory}, 'asserted')`,
    ).rejects.toThrow(/not declared in ontology|violates check constraint/i);
  });

  it('rejects a domain violation (a person cannot belong to a genre)', async () => {
    await expect(
      sql`INSERT INTO core.edge (subject_type, subject_id, predicate, object_type, object_id, provenance)
          VALUES ('person', ${villeneuve}, 'belongs_to_genre', 'concept', ${genreSciFi}, 'asserted')`,
    ).rejects.toThrow(/ontology violation/i);
  });

  it('rejects a range violation (a franchise is not a person)', async () => {
    await expect(
      sql`INSERT INTO core.edge (subject_type, subject_id, predicate, object_type, object_id, provenance)
          VALUES ('title', ${arrival}, 'part_of_franchise', 'person', ${villeneuve}, 'curated')`,
    ).rejects.toThrow(/ontology violation/i);
  });

  it('rejects a CONCEPT SUBTYPE violation — the hard case', async () => {
    // Predicate valid, types valid, but explores_theme must point at a concept
    // in the `theme` scheme and this one is a `genre`. Nothing but a real
    // subtype check catches this.
    await expect(
      sql`INSERT INTO core.edge (subject_type, subject_id, predicate, object_type, object_id, provenance)
          VALUES ('title', ${br2049}, 'explores_theme', 'concept', ${genreSciFi}, 'curated')`,
    ).rejects.toThrow(/requires a concept in scheme \{theme\}, got genre/i);
  });

  it('keeps derived predicates out of the asserted edge table', async () => {
    await expect(
      sql`INSERT INTO core.edge (subject_type, subject_id, predicate, object_type, object_id, provenance)
          VALUES ('title', ${arrival}, 'similar_to', 'title', ${br2049}, 'asserted')`,
    ).rejects.toThrow(/stored in core\.edge_derived, not core\.edge|violates check constraint/i);
  });

  it('keeps credit predicates out of the edge tables, with an accurate message', async () => {
    // `directed` IS declared — it just lives in core.credit. The error has to say
    // that, not "not declared", or it sends the next person down the wrong path
    // when this shows up in an ingest log.
    await expect(
      sql`INSERT INTO core.edge_derived
            (subject_type, subject_id, predicate, object_type, object_id, method)
          VALUES ('title', ${arrival}, 'directed', 'title', ${br2049}, 'test')`,
    ).rejects.toThrow(/stored in core\.credit, not core\.edge_derived/i);
  });

  it('registers every ontology.yaml predicate in core.predicate_meta', async () => {
    const onto = parse(readFileSync('ontology/ontology.yaml', 'utf8'));
    const declared = Object.keys(onto.predicates).sort();
    const rows = await sql<{ predicate: string }[]>`
      SELECT predicate FROM core.predicate_meta ORDER BY predicate`;
    expect(rows.map((r) => r.predicate)).toEqual(declared);
  });

  it('stores path weights that make credit edges beat classification edges', async () => {
    const rows = await sql<{ predicate: string; path_weight: string }[]>`
      SELECT predicate, path_weight FROM core.predicate_meta
      WHERE predicate IN ('directed','explores_theme','belongs_to_genre')`;
    const w = Object.fromEntries(rows.map((r) => [r.predicate, Number(r.path_weight)]));
    expect(w.directed!).toBeLessThan(w.explores_theme!);
    expect(w.explores_theme!).toBeLessThan(w.belongs_to_genre!);
  });

  it('exposes credits and edges through one sem.edge surface', async () => {
    await sql`INSERT INTO core.credit (person_id, title_id, predicate, billing_order)
              VALUES (${villeneuve}, ${arrival}, 'directed', NULL)
              ON CONFLICT DO NOTHING`;
    const rows = await sql<{ predicate: string; provenance: string }[]>`
      SELECT predicate, provenance FROM sem.edge
      WHERE subject_id = ${villeneuve} OR subject_id = ${arrival}
      ORDER BY predicate`;
    const preds = rows.map((r) => r.predicate);
    expect(preds).toContain('directed'); // from core.credit
    expect(preds).toContain('belongs_to_genre'); // from core.edge
  });

  it('generates inverse edges with the correct inverse label', async () => {
    const rows = await sql<{ predicate: string; predicate_label: string; is_inverse: boolean }[]>`
      SELECT predicate, predicate_label, is_inverse FROM sem.edge_bidirectional
      WHERE subject_type = 'title' AND subject_id = ${arrival} AND is_inverse`;
    const directedBy = rows.find((r) => r.predicate === 'directed_by');
    expect(directedBy, 'title -> directed_by -> person should exist as an inverse').toBeDefined();
    expect(directedBy!.predicate_label).toBe('directed by');
  });

  it('makes a symmetric edge traversable from BOTH ends', async () => {
    // similar_to is stored ONCE, in canonical order (subject_id < object_id).
    // sem.edge_bidirectional used to skip the inverse row for symmetric
    // predicates, on the assumption it would be a duplicate. It is not -- it
    // is the other direction, and without it every title that happened to
    // sort second had a silently empty "similar" list.
    // The fixture is created HERE rather than sampled from whatever the
    // database happens to hold. A version of this test that read an existing
    // row passed against a database with no derived edges at all -- it skipped
    // itself, and went on passing with the bug deliberately reintroduced.
    const [lo, hi] = [arrival, br2049].sort();
    await sql`
      INSERT INTO core.edge_derived
        (subject_type, subject_id, predicate, object_type, object_id, method, score)
      VALUES ('title', ${lo!}, 'similar_to', 'title', ${hi!}, 'test_symmetry', 0.5)
      ON CONFLICT (subject_type, subject_id, predicate, object_type, object_id, method)
      DO NOTHING`;

    const forward = await sql`
      SELECT 1 FROM sem.edge_bidirectional
      WHERE predicate = 'similar_to' AND subject_id = ${lo!} AND object_id = ${hi!}`;
    const backward = await sql`
      SELECT 1 FROM sem.edge_bidirectional
      WHERE predicate = 'similar_to' AND subject_id = ${hi!} AND object_id = ${lo!}`;

    await sql`DELETE FROM core.edge_derived WHERE method = 'test_symmetry'`;

    expect(forward.length, 'canonical direction').toBeGreaterThan(0);
    expect(backward.length, 'the other end must see it too').toBeGreaterThan(0);
  });

  it('excludes structural predicates from the traversal surface', async () => {
    // Composition is not a connection. season_of must never appear as an edge.
    const rows = await sql`
      SELECT 1 FROM sem.edge_bidirectional WHERE predicate IN ('season_of','episode_of')`;
    expect(rows).toHaveLength(0);
  });
});
