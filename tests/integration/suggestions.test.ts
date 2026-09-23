import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { suggestions } from '@/server/repos/suggestions';

/**
 * What to watch, and why.
 *
 * Every assertion here corresponds to a defect the first working version
 * actually had. They are not hypothetical:
 *
 *   Ranked by raw affinity, the top result was Superman IV: The Quest for
 *   Peace, because it shares two genres with things watched. True and
 *   worthless -- the "both are Drama" failure the spec warns about for path
 *   finding, reached by a different route.
 *
 *   Expanding a seed without constraining the predicate recommended seven
 *   films Michael Imperioli ACTED in, each labeled "wrote". In a feature
 *   whose product is the reason, a false reason is worse than no result.
 *
 *   Without a diversity cap the answer was six Spider-Man films, because one
 *   strong seed expands to its whole filmography.
 */
const URL = process.env.DATABASE_URL;
const run = URL ? describe : describe.skip;

let sql: ReturnType<typeof postgres>;
let account: string;
const ids: Record<string, string> = {};

run('suggestions', () => {
  beforeAll(async () => {
    sql = postgres(URL!, { max: 2, prepare: false, onnotice: () => {} });

    const [a] = await sql<{ id: string }[]>`
      INSERT INTO usr.account (email, display_name) VALUES ('sug@test.local', 'Sug')
      ON CONFLICT (email) DO UPDATE SET display_name = excluded.display_name RETURNING id`;
    account = a!.id;
    await sql`DELETE FROM usr.title_state WHERE account_id = ${account}::uuid`;

    /* A deliberately shaped corpus:
         - one director with three films, two of them watched
         - one genre shared by everything, so a genre-driven ranker would
           surface the decoy
         - one actor with four unwatched films, to force the diversity cap */
    const titles = [
      'sug-w1',
      'sug-w2',
      'sug-target',
      'sug-decoy',
      'sug-a1',
      'sug-a2',
      'sug-a3',
      'sug-dualfilm',
    ];
    for (const slug of titles) {
      const [t] = await sql<{ id: string }[]>`
        INSERT INTO core.title (slug, kind, title, sort_title, release_date, poster_path)
        VALUES (${slug}, 'movie', ${slug}, ${slug}, '2015-01-01', '/p.jpg')
        ON CONFLICT (slug) DO UPDATE SET title = excluded.title RETURNING id`;
      ids[slug] = t!.id;
    }

    const [genre] = await sql<{ id: string }[]>`
      INSERT INTO core.concept (scheme, slug, label, is_curated)
      VALUES ('genre', 'sug-genre', 'Sug Genre', false)
      ON CONFLICT (scheme, slug) DO UPDATE SET label = excluded.label RETURNING id`;
    for (const slug of titles) {
      await sql`
        INSERT INTO core.edge (subject_type, subject_id, predicate, object_type, object_id,
                               provenance, source)
        VALUES ('title', ${ids[slug]!}, 'belongs_to_genre', 'concept', ${genre!.id},
                'asserted', 'sug')
        ON CONFLICT DO NOTHING`;
    }

    const [dir] = await sql<{ id: string }[]>`
      INSERT INTO core.person (slug, name, sort_name) VALUES ('sug-dir', 'Sug Director', 'director sug')
      ON CONFLICT (slug) DO UPDATE SET name = excluded.name RETURNING id`;
    const [actor] = await sql<{ id: string }[]>`
      INSERT INTO core.person (slug, name, sort_name) VALUES ('sug-actor', 'Sug Actor', 'actor sug')
      ON CONFLICT (slug) DO UPDATE SET name = excluded.name RETURNING id`;

    for (const slug of ['sug-w1', 'sug-w2', 'sug-target']) {
      await sql`
        INSERT INTO core.credit (person_id, title_id, predicate, source)
        VALUES (${dir!.id}, ${ids[slug]!}, 'directed', 'sug') ON CONFLICT DO NOTHING`;
    }
    /* The actor is on both watched films and on four unwatched ones. */
    for (const slug of ['sug-w1', 'sug-w2', 'sug-a1', 'sug-a2', 'sug-a3', 'sug-decoy']) {
      await sql`
        INSERT INTO core.credit (person_id, title_id, predicate, billing_order, source)
        VALUES (${actor!.id}, ${ids[slug]!}, 'acted_in', 1, 'sug') ON CONFLICT DO NOTHING`;
    }

    /**
     * The Imperioli shape, and the fixture's most important row.
     *
     * One person who WROTE both watched films and ACTED IN a third, unwatched
     * one. Without the predicate constraint in the query, that third film is
     * recommended with the reason "wrote" -- a relationship that does not
     * exist. A fixture without someone who works in two roles cannot detect
     * that: the first version of this suite had none, and the mutation passed
     * all six tests.
     */
    const [dual] = await sql<{ id: string }[]>`
      INSERT INTO core.person (slug, name, sort_name) VALUES ('sug-dual', 'Sug Dual', 'dual sug')
      ON CONFLICT (slug) DO UPDATE SET name = excluded.name RETURNING id`;
    for (const slug of ['sug-w1', 'sug-w2']) {
      await sql`
        INSERT INTO core.credit (person_id, title_id, predicate, source)
        VALUES (${dual!.id}, ${ids[slug]!}, 'wrote', 'sug') ON CONFLICT DO NOTHING`;
    }
    await sql`
      INSERT INTO core.credit (person_id, title_id, predicate, billing_order, source)
      VALUES (${dual!.id}, ${ids['sug-dualfilm']!}, 'acted_in', 2, 'sug') ON CONFLICT DO NOTHING`;

    await sql`REFRESH MATERIALIZED VIEW core.node_degree`;

    for (const slug of ['sug-w1', 'sug-w2']) {
      await sql`
        INSERT INTO usr.title_state (account_id, title_id, status)
        VALUES (${account}::uuid, ${ids[slug]!}, 'watched')
        ON CONFLICT (account_id, title_id) DO UPDATE SET status = 'watched'`;
    }
  });

  afterAll(async () => {
    await sql`DELETE FROM usr.title_state WHERE account_id = ${account}::uuid`;
    await sql`DELETE FROM core.credit WHERE source = 'sug'`;
    await sql`DELETE FROM core.edge WHERE source = 'sug'`;
    await sql`DELETE FROM core.title WHERE slug LIKE 'sug-%'`;
    await sql`DELETE FROM core.person WHERE slug LIKE 'sug-%'`;
    await sql`DELETE FROM core.concept WHERE slug = 'sug-genre'`;
    await sql`DELETE FROM usr.account WHERE email = 'sug@test.local'`;
    await sql.end();
  });

  it('finds the film that shares a director with what you watched', async () => {
    const out = await suggestions(account, { limit: 20 });
    expect(
      out.map((s) => s.slug),
      'the fixture must actually produce results',
    ).toContain('sug-target');
  });

  it('never suggests something already in your library', async () => {
    const out = await suggestions(account, { limit: 20 });
    const slugs = out.map((s) => s.slug);
    expect(slugs).not.toContain('sug-w1');
    expect(slugs).not.toContain('sug-w2');
  });

  it('never gives a genre as the reason', async () => {
    // The ontology bars belongs_to_genre from path intermediates because
    // "both are Science Fiction" explains nothing. The same applies here, and
    // the query reads that flag rather than hardcoding the predicate.
    const out = await suggestions(account, { limit: 20 });
    for (const s of out) {
      for (const r of s.reasons ?? []) {
        expect(r.predicate, `${s.slug} cites a genre`).not.toBe('belongs_to_genre');
      }
    }
  });

  it('cites only relationships that actually exist between them', async () => {
    // The Imperioli bug: a seed built from one predicate expanded along every
    // predicate, then labeled the result with the seed's. Every reason must
    // be checkable against the graph.
    const out = await suggestions(account, { limit: 20 });
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) {
      for (const r of s.reasons ?? []) {
        const [hit] = await sql`
          SELECT 1 FROM sem.edge_bidirectional e
          JOIN sem.node n ON n.node_type = e.subject_type AND n.id = e.subject_id
          WHERE e.object_type = 'title' AND e.object_id = ${s.title_id}
            AND e.canonical_predicate = ${r.predicate}
            AND n.label = ${r.label}`;
        expect(hit, `${s.slug}: "${r.label} ${r.predicate}" is not an edge`).toBeDefined();
      }
    }
  });

  it('ranks a shared director above a shared actor', async () => {
    // directed is weight 1.0 and acted_in is 1.4 in ontology.yaml. The
    // ordering is the ontology's, not this query's.
    const out = await suggestions(account, { limit: 20 });
    const target = out.findIndex((s) => s.slug === 'sug-target');
    const acted = out.findIndex((s) => s.slug.startsWith('sug-a'));
    expect(target).toBeGreaterThanOrEqual(0);
    if (acted >= 0) expect(target).toBeLessThan(acted);
  });

  it('lets no single seed own the list', async () => {
    // Four unwatched films share one actor. Without the cap the answer is all
    // four; with it, at most two.
    const out = await suggestions(account, { limit: 20 });
    const fromActor = out.filter((s) => s.slug.startsWith('sug-a'));
    expect(fromActor.length).toBeLessThanOrEqual(2);
  });
});
