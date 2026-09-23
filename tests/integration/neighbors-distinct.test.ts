import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { graphEngine } from '@/lib/graph/postgres-engine';

/**
 * One neighbor, one row.
 *
 * sem.edge unions core.credit, where the same person legitimately holds
 * several rows under one predicate: a TV writer credited on four episodes, a
 * screenwriter listed as both Writer and Screenplay. Ungrouped, that person
 * took four of the twelve slots in their group, rendered with a duplicate
 * React key, and inflated the "N more" count by the same amount -- a group
 * that claimed twelve writers while showing four.
 *
 * It surfaced as a console warning on a page that otherwise looked correct,
 * which is why it needs a test rather than a memory.
 */
const URL = process.env.DATABASE_URL;
const run = URL ? describe : describe.skip;

let sql: ReturnType<typeof postgres>;
let titleId: string;

run('neighbors() returns distinct nodes per group', () => {
  beforeAll(async () => {
    sql = postgres(URL!, { max: 2, prepare: false, onnotice: () => {} });

    const [t] = await sql<{ id: string }[]>`
      INSERT INTO core.title (slug, kind, title, sort_title, release_date)
      VALUES ('dup-neighbors-show','show','Dup Neighbors', core.normalize_title('Dup Neighbors'),'2020-01-01')
      ON CONFLICT (slug) DO UPDATE SET title = excluded.title RETURNING id`;
    titleId = t!.id;

    const [p] = await sql<{ id: string }[]>`
      INSERT INTO core.person (slug, name, sort_name)
      VALUES ('dup-neighbors-writer','Dup Writer','writer dup')
      ON CONFLICT (slug) DO UPDATE SET name = excluded.name RETURNING id`;

    // The real shape of the bug: one person, one predicate, several credits.
    await sql`
      INSERT INTO core.credit (person_id, title_id, predicate, department, job, source)
      VALUES (${p!.id}, ${titleId}, 'wrote', 'Writing', 'Writer', 'test'),
             (${p!.id}, ${titleId}, 'wrote', 'Writing', 'Screenplay', 'test'),
             (${p!.id}, ${titleId}, 'wrote', 'Writing', 'Story', 'test')`;
  });

  afterAll(async () => {
    await sql`DELETE FROM core.credit WHERE source = 'test' AND title_id = ${titleId}`;
    await sql`DELETE FROM core.title WHERE slug = 'dup-neighbors-show'`;
    await sql`DELETE FROM core.person WHERE slug = 'dup-neighbors-writer'`;
    await sql.end();
  });

  it('collapses three credits for one person into one neighbor', async () => {
    const groups = await graphEngine.neighbors({ type: 'title', id: titleId }, { perGroup: 12 });
    const written = groups.find((g) => g.predicate === 'written_by');
    expect(written, 'the fixture must actually produce a written_by group').toBeDefined();
    expect(written!.nodes).toHaveLength(1);
    expect(written!.more, 'and must not claim two more hiding behind it').toBe(0);
  });

  it('returns no duplicate node keys in any group', async () => {
    const groups = await graphEngine.neighbors({ type: 'title', id: titleId }, { perGroup: 12 });
    for (const g of groups) {
      const keys = g.nodes.map((n) => `${n.type}:${n.id}`);
      expect(new Set(keys).size, `duplicates in ${g.predicate}`).toBe(keys.length);
    }
  });
});
