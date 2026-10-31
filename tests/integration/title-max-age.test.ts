import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

/**
 * core.title_max_age decides both what refresh_stale works on and what
 * /api/health calls stale, so a wrong tier is wrong in two places at once.
 */
const URL = process.env.DATABASE_URL;
const run = URL ? describe : describe.skip;
let sql: ReturnType<typeof postgres>;

run('core.title_max_age', () => {
  beforeAll(() => {
    sql = postgres(URL!, { max: 1, prepare: false, onnotice: () => {} });
  });
  afterAll(async () => {
    await sql.end();
  });

  const age = async (kind: string, status: string | null, release: string | null) => {
    const [r] = await sql<{ days: number }[]>`
      SELECT extract(day FROM core.title_max_age(${kind}, ${status}, ${release}::date))::int AS days`;
    return r!.days;
  };

  it.each([
    ['an old released film', 'movie', 'Released', '2006-12-15', 90],
    ['an ended show', 'show', 'Ended', '2010-10-31', 90],
    ['a canceled show', 'show', 'Canceled', '2015-01-01', 90],
    ['a film with no release date', 'movie', 'Rumored', null, 7],
    ['a show still airing, however old', 'show', 'Returning Series', '2005-03-24', 7],
    ['a show in production', 'show', 'In Production', '2024-01-01', 7],
  ] as const)('%s → %i days', async (_label, kind, status, release, days) => {
    expect(await age(kind, status, release)).toBe(days);
  });

  it('a film released within 180 days is weekly; one just past it is not', async () => {
    const [d] = await sql<{ recent: string; older: string }[]>`
      SELECT (current_date - 30)::text AS recent, (current_date - 200)::text AS older`;
    expect(await age('movie', 'Released', d!.recent)).toBe(7);
    expect(await age('movie', 'Released', d!.older)).toBe(90);
  });
});
