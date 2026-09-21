import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { normalizeTitle } from '@/server/ingest/normalize';

/**
 * Title normalization exists in two places: TypeScript (ingest computes the
 * blocking key) and SQL (core.normalize_title, used by queries and backfills).
 *
 * If they drift, the key computed at write time stops matching the key computed
 * at read time, and entity resolution quietly starts creating duplicate titles —
 * a failure with no error message and no obvious symptom until the corpus is
 * full of two-of-everything. This test is the only thing standing between us and
 * that, so the fixture list should grow whenever normalization changes.
 */
const URL = process.env.DATABASE_URL;
const run = URL ? describe : describe.skip;
let sql: ReturnType<typeof postgres>;

const FIXTURES = [
  'The Matrix (1999)',
  'L’Étranger',
  "L'Étranger",
  'WALL·E',
  'Amélie',
  'A Clockwork Orange',
  'An American Werewolf in London',
  'Das Boot',
  'Le Fabuleux Destin d’Amélie Poulain',
  'Blade Runner 2049',
  'Spider-Man: Into the Spider-Verse',
  'Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb',
  'Se7en',
  '2001: A Space Odyssey',
  'The Good, the Bad and the Ugly',
  'Amélie',
  'Arrival',
  '  Arrival  ',
  'Léon: The Professional',
  'Zack Snyder’s Justice League',
  'M*A*S*H',
  '¡Three Amigos!',
  'Crouching Tiger, Hidden Dragon',
  'The Office',
  'The Officer',
];

run('normalizeTitle parity: TypeScript vs core.normalize_title', () => {
  beforeAll(() => {
    sql = postgres(URL!, { max: 1, prepare: false, onnotice: () => {} });
  });
  afterAll(async () => {
    await sql.end();
  });

  it.each(FIXTURES)('agrees on %j', async (input) => {
    const [row] = await sql<{ n: string }[]>`SELECT core.normalize_title(${input}) AS n`;
    expect(row!.n).toBe(normalizeTitle(input));
  });

  it('agrees on a randomized sweep of punctuation and accents', async () => {
    const alphabet = "abcXYZ019 .,:'’-·!?&éÉüñ()[]";
    const cases: string[] = [];
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 120; i++) {
      const len = 3 + Math.floor(rnd() * 18);
      let s = '';
      for (let j = 0; j < len; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      cases.push(s);
    }
    const rows = await sql<{ input: string; n: string }[]>`
      SELECT x AS input, core.normalize_title(x) AS n
      FROM unnest(${cases}::text[]) AS x`;
    const mismatches = rows
      .filter((r) => r.n !== normalizeTitle(r.input))
      .map((r) => ({ input: r.input, sql: r.n, ts: normalizeTitle(r.input) }));
    expect(mismatches, JSON.stringify(mismatches.slice(0, 5), null, 2)).toHaveLength(0);
  });
});
