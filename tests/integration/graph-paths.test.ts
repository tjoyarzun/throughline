import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { graphEngine, diversify, narrate } from '@/lib/graph/postgres-engine';
import type { GraphNode, GraphPath } from '@/lib/graph/types';

/**
 * Path RANKING, not path finding.
 *
 * Finding a path between two films is trivial and almost always useless: the
 * shortest one runs through a hub, and "both are Drama" is true and worthless.
 * These tests are about whether the ranking earns its keep.
 */
const URL = process.env.DATABASE_URL;
const run = URL ? describe : describe.skip;
let sql: ReturnType<typeof postgres>;
let filmA: string;
let filmB: string;
let director: string;
let prolific: string;
let genre: string;

function node(id: string, label: string, type = 'title'): GraphNode {
  return { type, id, slug: id, label, sublabel: null, imagePath: null, degree: 1 };
}

run('path ranking', () => {
  /**
   * A SYNTHETIC graph, not the seeded corpus.
   *
   * The first version of these tests looked up real titles by slug and
   * returned early when the test database did not have them -- so they passed
   * without asserting anything at all. A fixture also lets the ranking rule be
   * stated exactly: one cheap, rare director and one expensive, enormous genre
   * connecting the same two films.
   */
  beforeAll(async () => {
    sql = postgres(URL!, { max: 2, prepare: false, onnotice: () => {} });
    await cleanup();

    const t = await sql<{ id: string; slug: string }[]>`
      INSERT INTO core.title (slug, kind, title, sort_title) VALUES
        ('gp-film-a','movie','Film A', core.normalize_title('Film A')),
        ('gp-film-b','movie','Film B', core.normalize_title('Film B'))
      RETURNING id, slug`;
    filmA = t.find((r) => r.slug === 'gp-film-a')!.id;
    filmB = t.find((r) => r.slug === 'gp-film-b')!.id;

    const [d] = await sql<{ id: string }[]>`
      INSERT INTO core.person (slug, name, sort_name)
      VALUES ('gp-director','Grace Park','park grace') RETURNING id`;
    director = d!.id;

    const [g] = await sql<{ id: string }[]>`
      INSERT INTO core.concept (scheme, slug, label, is_curated)
      VALUES ('genre','gp-genre','Everything', false) RETURNING id`;
    genre = g!.id;

    // A PROLIFIC director, who also connects both films. The hub penalty must
    // make this route cost more than the rare director, even though both are
    // two hops. Degrees are earned from real edges and then materialized,
    // because core.node_degree is a matview and cannot be written directly.
    const [h] = await sql<{ id: string }[]>`
      INSERT INTO core.person (slug, name, sort_name)
      VALUES ('gp-prolific','Sam Hub','hub sam') RETURNING id`;
    prolific = h!.id;

    const filler = await sql<{ id: string }[]>`
      INSERT INTO core.title (slug, kind, title, sort_title)
      SELECT 'gp-filler-' || i, 'movie', 'Filler ' || i,
             core.normalize_title('Filler ' || i)
      FROM generate_series(1, 40) AS i
      RETURNING id`;

    await sql`INSERT INTO core.credit (person_id, title_id, predicate, department, job)
              VALUES (${director}, ${filmA}, 'directed', 'Directing', 'Director'),
                     (${director}, ${filmB}, 'directed', 'Directing', 'Director'),
                     (${prolific}, ${filmA}, 'directed', 'Directing', 'Director'),
                     (${prolific}, ${filmB}, 'directed', 'Directing', 'Director')`;
    for (const f of filler) {
      await sql`INSERT INTO core.credit (person_id, title_id, predicate, department, job)
                VALUES (${prolific}, ${f.id}, 'directed', 'Directing', 'Director')`;
    }

    await sql`INSERT INTO core.edge
                (subject_type, subject_id, predicate, object_type, object_id, provenance)
              VALUES ('title', ${filmA}, 'belongs_to_genre', 'concept', ${genre}, 'asserted'),
                     ('title', ${filmB}, 'belongs_to_genre', 'concept', ${genre}, 'asserted')`;

    await sql`REFRESH MATERIALIZED VIEW core.node_degree`;
  });

  async function cleanup(): Promise<void> {
    await sql`DELETE FROM core.title WHERE slug LIKE 'gp-film-%' OR slug LIKE 'gp-filler-%'`;
    await sql`DELETE FROM core.person WHERE slug IN ('gp-director','gp-prolific')`;
    await sql`DELETE FROM core.concept WHERE slug = 'gp-genre'`;
  }

  afterAll(async () => {
    await cleanup();
    await sql.end();
  });

  it('narrates from the ontology templates, in the right direction', () => {
    const from = node('a', 'Arrival');
    const s = narrate(from, [
      {
        predicate: 'directed_by',
        canonical: 'directed',
        isInverse: true,
        predicateLabel: 'directed by',
        node: node('v', 'Denis Villeneuve', 'person'),
      },
      {
        predicate: 'directed',
        canonical: 'directed',
        isInverse: false,
        predicateLabel: 'directed',
        node: node('b', 'Blade Runner 2049'),
      },
    ]);
    // Reading the edge backwards must use the inverse template. Falling back
    // to the bare label produced fragments like "which similar to Get Out".
    //
    // "who", not "which": the pronoun stands in for Denis Villeneuve. This
    // assertion previously encoded the wrong word, which is exactly why the
    // grammar was wrong on the app's flagship surface and nothing complained.
    expect(s).toBe('Arrival was directed by Denis Villeneuve, who directed Blade Runner 2049.');
  });

  it('keeps "which" when the previous hop was not a person', () => {
    const s = narrate(node('a', 'Arrival'), [
      {
        predicate: 'similar_to',
        canonical: 'similar_to',
        isInverse: false,
        predicateLabel: 'similar to',
        node: node('p', 'Prisoners'),
      },
      {
        predicate: 'similar_to',
        canonical: 'similar_to',
        isInverse: false,
        predicateLabel: 'similar to',
        node: node('s', 'Sicario'),
      },
    ]);
    expect(s).toContain('which');
    expect(s).not.toContain('who');
  });

  it('rejects a path that repeats an earlier one', () => {
    const mk = (mid: string, cost: number): GraphPath => ({
      from: node('a', 'A'),
      steps: [
        {
          predicate: 'p',
          canonical: 'directed',
          isInverse: false,
          predicateLabel: 'p',
          node: node(mid, mid, 'person'),
        },
        {
          predicate: 'p',
          canonical: 'directed',
          isInverse: false,
          predicateLabel: 'p',
          node: node('b', 'B'),
        },
      ],
      cost,
      interestingness: 0.5,
      narration: '',
    });
    // Three paths through the same person is one insight printed three times.
    const kept = diversify([mk('villeneuve', 1), mk('villeneuve', 2), mk('deakins', 3)], 3);
    expect(kept.map((p) => p.steps[0]!.node.id)).toEqual(['villeneuve', 'deakins']);
  });

  it('ranks the director path above the hub path, and never routes through a genre', async () => {
    // AC-17. Both films share a director AND a genre. The genre is the
    // shorter, more obvious answer and it is the one that must lose --
    // "both are Drama" is true and worthless.
    const paths = await graphEngine.findPaths(
      { type: 'title', id: filmA },
      { type: 'title', id: filmB },
    );
    expect(paths.length, 'the pair is connected and must return a path').toBeGreaterThan(0);
    expect(paths[0]!.narration).toContain('Grace Park');
    expect(paths[0]!.narration.endsWith('.'), 'reads as a sentence').toBe(true);

    for (const p of paths) {
      for (const step of p.steps) {
        expect(step.canonical, 'no genre edge may appear anywhere in a path').not.toBe(
          'belongs_to_genre',
        );
      }
    }
  });

  it('penalizes the prolific waypoint even at equal path length', async () => {
    // Both routes are two hops through a director. The difference is entirely
    // how many other films that director connects: passing through someone
    // with 42 credits explains far less than passing through someone with 2.
    // Without the hub penalty these would tie and the order would be arbitrary.
    const paths = await graphEngine.findPaths(
      { type: 'title', id: filmA },
      { type: 'title', id: filmB },
      { limit: 5 },
    );
    const names = paths.map((p) => p.steps[0]!.node.label);
    expect(names).toContain('Grace Park');
    expect(names).toContain('Sam Hub');
    expect(
      names.indexOf('Grace Park'),
      'the rare director must outrank the prolific one',
    ).toBeLessThan(names.indexOf('Sam Hub'));
  });
});
