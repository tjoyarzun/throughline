import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { targetDatabase } from '../../scripts/lib/target-db';
import { bar } from '../../scripts/lib/progress';

/**
 * A hand-run script must not choose its database from ambient shell state.
 *
 * This is the test for a real, expensive failure: a hydrate run launched with
 * DATABASE_URL set inline to a Neon connection string wrote 59,809 rows to
 * localhost, because a DATABASE_URL_UNPOOLED left exported in that shell took
 * precedence. Forty minutes of work landed in the wrong database while a
 * correct-looking progress bar ran.
 */
const VARS = ['DATABASE_URL', 'DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING'];
const NEON_POOLED = 'postgresql://u:p@ep-orange-waterfall-a1-pooler.c-2.aws.neon.tech/neondb';
const NEON_DIRECT = 'postgresql://u:p@ep-orange-waterfall-a1.c-2.aws.neon.tech/neondb';
const LOCAL = 'postgresql://u:p@localhost:5432/throughline_dev';

let saved: Record<string, string | undefined>;
let argv: string[];

beforeEach(() => {
  saved = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
  for (const v of VARS) delete process.env[v];
  argv = process.argv;
  process.argv = ['node', 'script'];
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  process.argv = argv;
});

describe('targetDatabase', () => {
  it('refuses when two variables name different databases', () => {
    process.env.DATABASE_URL = NEON_POOLED;
    process.env.DATABASE_URL_UNPOOLED = LOCAL;
    expect(() => targetDatabase('t')).toThrow(/will not guess/);
  });

  it('names both candidates so the operator can see which is stale', () => {
    process.env.DATABASE_URL = NEON_POOLED;
    process.env.DATABASE_URL_UNPOOLED = LOCAL;
    expect(() => targetDatabase('t')).toThrow(/localhost:5432/);
    expect(() => targetDatabase('t')).toThrow(/neon\.tech/);
  });

  it('accepts a correct Neon pair, whose two hostnames differ by design', () => {
    // The pooled and direct endpoints of ONE database. Flagging this would
    // make the guard fire on every properly configured deployment, which is
    // how a safety check gets disabled.
    process.env.DATABASE_URL = NEON_POOLED;
    process.env.DATABASE_URL_UNPOOLED = NEON_DIRECT;
    const t = targetDatabase('t');
    expect(t.source).toBe('DATABASE_URL_UNPOOLED');
    expect(t.url).toBe(NEON_DIRECT);
  });

  it('lets an explicit --url win over anything exported', () => {
    process.env.DATABASE_URL_UNPOOLED = LOCAL;
    process.argv = ['node', 'script', '--url', NEON_POOLED];
    const t = targetDatabase('t');
    expect(t.url).toBe(NEON_POOLED);
    expect(t.source).toBe('--url');
  });

  it('never puts credentials in the label it prints', () => {
    process.env.DATABASE_URL = NEON_POOLED;
    const t = targetDatabase('t');
    expect(t.label).not.toContain('p@');
    expect(t.label).not.toContain('u:');
    expect(t.label).toContain('neon.tech');
  });

  it('says so plainly when nothing is set', () => {
    expect(() => targetDatabase('t')).toThrow(/no database to write to/);
  });

  it('rejects a --url with nothing after it', () => {
    process.argv = ['node', 'script', '--url'];
    expect(() => targetDatabase('t')).toThrow(/needs a connection string/);
  });
});

describe('progress bar', () => {
  it('never exceeds the frame when the queue moved under it', () => {
    // The exact numbers from the run that crashed: 59,809 processed against a
    // remaining count of 58,588 read forty minutes earlier.
    expect(() => bar(59809, 58588)).not.toThrow();
    expect(bar(59809, 58588)).toContain('100.0%');
    // Full, with no unfilled cells left in the frame.
    expect(bar(59809, 58588).split(']')[0]).not.toContain('.');
  });

  it('survives zero, negative and non-finite inputs', () => {
    for (const [d, t] of [
      [0, 0],
      [-5, 100],
      [10, 0],
      [Number.NaN, 100],
      [1, Number.NaN],
    ] as [number, number][]) {
      expect(() => bar(d, t), `bar(${d}, ${t})`).not.toThrow();
    }
  });

  it('still reports partial progress accurately', () => {
    expect(bar(50, 100)).toContain('50.0%');
    expect(bar(50, 100, 10)).toBe('[#####.....] 50.0%');
  });
});
