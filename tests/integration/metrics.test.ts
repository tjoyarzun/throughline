import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { METRICS } from '@/lib/ontology/metrics';
import type * as Resolver from '@/lib/metrics/resolve';

/**
 * AC-23: a metric is a definition, and every definition must compile.
 *
 * rating_distribution shipped without a `dimension`, so the resolver fell back
 * to `label` -- a column sem.user_title does not have -- and the metric threw
 * at request time while the other four worked. Nothing checked, because
 * nothing ran them all.
 *
 * Metrics whose source view does not exist yet (the Phase 2 set) are reported
 * as pending rather than skipped silently, so the gap stays visible.
 */
const URL = process.env.DATABASE_URL;
const run = URL ? describe : describe.skip;

let sql: ReturnType<typeof postgres>;
let account: string;
let resolveMetric: typeof Resolver.resolveMetric;

run('metric definitions', () => {
  beforeAll(async () => {
    sql = postgres(URL!, { max: 2, prepare: false, onnotice: () => {} });
    ({ resolveMetric } = await import('@/lib/metrics/resolve'));
    await sql`DELETE FROM usr.account WHERE email = 'metrics@test.local'`;
    const [a] = await sql<{ id: string }[]>`
      INSERT INTO usr.account (email, display_name) VALUES ('metrics@test.local', 'M')
      RETURNING id`;
    account = a!.id;
  });

  afterAll(async () => {
    await sql`DELETE FROM usr.account WHERE email = 'metrics@test.local'`;
    await sql.end();
  });

  const existing = async (source: string): Promise<boolean> => {
    const [r] = await sql<{ ok: boolean }[]>`
      SELECT to_regclass(${source}) IS NOT NULL AS ok`;
    return r!.ok;
  };

  for (const [name, def] of Object.entries(METRICS)) {
    it(`${name} compiles and runs`, async () => {
      const needed = [def.source, def.compareTo].filter(Boolean) as string[];
      const missing = (await Promise.all(needed.map(existing))).some((ok) => !ok);
      if (missing) {
        // A Phase 2 metric pointing at a view nobody has written yet. Assert
        // that is the ONLY reason it cannot run, rather than passing blindly.
        expect(def.phase, `${name} names a missing view but claims phase 1`).toBeGreaterThan(1);
        // Keep the gap visible rather than letting a skip hide it.
        console.warn(`  pending: ${name} needs ${needed.join(', ')}`);
        return;
      }
      // An empty account is the harder case: the SQL still has to be valid.
      const result = await resolveMetric(name as keyof typeof METRICS, account);
      expect(result.label).toBe(def.label);
      expect(Array.isArray(result.rows)).toBe(true);
    });
  }

  it('refuses a source outside the semantic layer', async () => {
    // The boundary is the whole point of the layer; a metric must not be the
    // way around it.
    const bad = { ...METRICS.genre_distribution!, source: 'usr.title_state' };
    const original = METRICS.genre_distribution;
    (METRICS as Record<string, unknown>).genre_distribution = bad;
    await expect(resolveMetric('genre_distribution', account)).rejects.toThrow(/sem\.\*/);
    (METRICS as Record<string, unknown>).genre_distribution = original;
  });

  it('scopes every metric to the account that asked', async () => {
    // Injected as a bound parameter, never interpolated.
    const other = await sql<{ id: string }[]>`
      INSERT INTO usr.account (email, display_name) VALUES ('metrics-b@test.local', 'B')
      RETURNING id`;
    const r = await resolveMetric('genre_distribution', other[0]!.id);
    expect(r.rows, 'a fresh account has no taste yet').toEqual([]);
    await sql`DELETE FROM usr.account WHERE email = 'metrics-b@test.local'`;
  });
});
