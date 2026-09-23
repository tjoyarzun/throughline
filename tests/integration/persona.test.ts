import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { persona } from '@/server/repos/persona';

/**
 * The persona describes somebody, so its claims have to be earned.
 *
 * "Completist" is the one that can embarrass: half a filmography of three
 * films is not the same statement as half of thirty, and a card that says it
 * on thin evidence is exactly the kind of thing somebody posts and then gets
 * corrected about.
 */
const URL = process.env.DATABASE_URL;
const run = URL ? describe : describe.skip;

let sql: ReturnType<typeof postgres>;
let account: string;
let director: string;
const titles: Record<string, string> = {};

async function watch(slugs: string[]) {
  await sql`DELETE FROM usr.title_state WHERE account_id = ${account}::uuid`;
  for (const slug of slugs) {
    await sql`
      INSERT INTO usr.title_state (account_id, title_id, status)
      VALUES (${account}::uuid, ${titles[slug]!}, 'watched')
      ON CONFLICT (account_id, title_id) DO UPDATE SET status = 'watched'`;
  }
}

run('persona', () => {
  beforeAll(async () => {
    sql = postgres(URL!, { max: 2, prepare: false, onnotice: () => {} });
    const [a] = await sql<{ id: string }[]>`
      INSERT INTO usr.account (email, display_name) VALUES ('persona@test.local', 'P')
      ON CONFLICT (email) DO UPDATE SET display_name = excluded.display_name RETURNING id`;
    account = a!.id;

    const [d] = await sql<{ id: string }[]>`
      INSERT INTO core.person (slug, name, sort_name)
      VALUES ('persona-dir', 'Persona Director', 'director persona')
      ON CONFLICT (slug) DO UPDATE SET name = excluded.name RETURNING id`;
    director = d!.id;

    /* Twelve films by one director. Twelve rather than six so BOTH branches
       are reachable above the five-watched readiness floor: five of twelve is
       42% and must read as "follows", seven of twelve is 58% and must read as
       "completist". With six the floor and the threshold collided and only
       one branch could ever be tested. */
    for (let i = 1; i <= 12; i++) {
      const slug = `persona-t${i}`;
      const [t] = await sql<{ id: string }[]>`
        INSERT INTO core.title (slug, kind, title, sort_title, release_date, runtime_minutes)
        VALUES (${slug}, 'movie', ${slug}, ${slug}, '2018-01-01', 100)
        ON CONFLICT (slug) DO UPDATE SET title = excluded.title RETURNING id`;
      titles[slug] = t!.id;
      await sql`
        INSERT INTO core.credit (person_id, title_id, predicate, source)
        VALUES (${director}, ${t!.id}, 'directed', 'persona') ON CONFLICT DO NOTHING`;
    }

    /* A director with a THREE-film filmography, plus two titles with no
       director at all. Watching all three of the first and both of the second
       clears the readiness floor while making the top director's coverage
       100% of a tiny body of work -- the case where "completist" would be
       technically true and embarrassing to post. */
    const [small] = await sql<{ id: string }[]>`
      INSERT INTO core.person (slug, name, sort_name)
      VALUES ('persona-small', 'Persona Small', 'small persona')
      ON CONFLICT (slug) DO UPDATE SET name = excluded.name RETURNING id`;
    for (let i = 1; i <= 3; i++) {
      const slug = `persona-s${i}`;
      const [t] = await sql<{ id: string }[]>`
        INSERT INTO core.title (slug, kind, title, sort_title, release_date, runtime_minutes)
        VALUES (${slug}, 'movie', ${slug}, ${slug}, '2019-01-01', 100)
        ON CONFLICT (slug) DO UPDATE SET title = excluded.title RETURNING id`;
      titles[slug] = t!.id;
      await sql`
        INSERT INTO core.credit (person_id, title_id, predicate, source)
        VALUES (${small!.id}, ${t!.id}, 'directed', 'persona') ON CONFLICT DO NOTHING`;
    }
    for (let i = 1; i <= 2; i++) {
      const slug = `persona-f${i}`;
      const [t] = await sql<{ id: string }[]>`
        INSERT INTO core.title (slug, kind, title, sort_title, release_date, runtime_minutes)
        VALUES (${slug}, 'movie', ${slug}, ${slug}, '2020-01-01', 100)
        ON CONFLICT (slug) DO UPDATE SET title = excluded.title RETURNING id`;
      titles[slug] = t!.id;
    }
  });

  afterAll(async () => {
    await sql`DELETE FROM usr.title_state WHERE account_id = ${account}::uuid`;
    await sql`DELETE FROM core.credit WHERE source = 'persona'`;
    await sql`DELETE FROM core.title WHERE slug LIKE 'persona-%'`;
    await sql`DELETE FROM core.person WHERE slug LIKE 'persona-%'`;
    await sql`DELETE FROM usr.account WHERE email = 'persona@test.local'`;
    await sql.end();
  });

  it('says nothing about somebody with almost no history', async () => {
    await watch(['persona-t1', 'persona-t2']);
    const p = await persona(account);
    expect(p.ready, 'two films is not a personality').toBe(false);
    expect(p.headline).toBe('A watcher in progress');
  });

  it('claims completist only when most of a real filmography is watched', async () => {
    await watch([1, 2, 3, 4, 5, 6, 7].map((i) => `persona-t${i}`));
    const p = await persona(account);
    expect(p.ready).toBe(true);
    expect(p.headline).toBe('Persona Director completist');
    expect(p.subhead).toBe('7 of 12');
  });

  it('says only "follows" when the share is low', async () => {
    // Five of twelve is real interest and not completion. The distinction is
    // the whole reason coverage is on the card.
    await watch(['persona-t1', 'persona-t2', 'persona-t3', 'persona-t4', 'persona-t5']);
    const p = await persona(account);
    expect(p.headline).toBe('Follows Persona Director');
  });

  it('will not call somebody a completist of a three-film filmography', async () => {
    // 100% coverage, and still not a claim worth printing: "completist" has
    // to mean something, and three films is not a body of work. Without the
    // corpus-size condition this says "Persona Small completist" on evidence
    // that would get you corrected in the replies.
    await watch(['persona-s1', 'persona-s2', 'persona-s3', 'persona-f1', 'persona-f2']);
    const p = await persona(account);
    expect(p.ready).toBe(true);
    expect(p.headline).toBe('Follows Persona Small');
  });

  it('never repeats the headline as a stat line', async () => {
    // "Drawn to Obsession" over "THREAD: Obsession" reads as a bug.
    await watch(['persona-t1', 'persona-t2', 'persona-t3', 'persona-t4', 'persona-t5']);
    const p = await persona(account);
    for (const l of p.lines) {
      expect(p.headline.includes(l.value), `${l.label} repeats the headline`).toBe(false);
    }
  });

  it('gives every line a value, so the card has no blanks', async () => {
    await watch(['persona-t1', 'persona-t2', 'persona-t3', 'persona-t4', 'persona-t5']);
    const p = await persona(account);
    expect(p.lines.length).toBeGreaterThanOrEqual(3);
    for (const l of p.lines) {
      expect(l.value.trim().length, l.label).toBeGreaterThan(0);
    }
  });
});
