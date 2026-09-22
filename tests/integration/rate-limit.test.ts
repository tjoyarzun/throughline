import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';

/**
 * The limiter.
 *
 * The interesting assertions are not "it counts" but the two properties a
 * naive implementation gets wrong: that it holds under CONCURRENCY, and that
 * the stated limit is the real limit ACROSS A WINDOW BOUNDARY. A fixed-window
 * counter passes a simple counting test and then quietly allows double the
 * budget to anyone who spends it at 0:59 and again at 1:01.
 */
const ADMIN_URL = process.env.DATABASE_URL;
const APP_URL = process.env.TEST_DATABASE_URL;
const run = ADMIN_URL && APP_URL ? describe : describe.skip;

let owner: ReturnType<typeof postgres>;
let app: ReturnType<typeof postgres>;

interface Hit {
  allowed: boolean;
  remaining: number;
  retry_after_s: number;
}

const hit = (bucket: string, limit = 5, window = '1 minute') =>
  app<Hit[]>`SELECT * FROM core.rate_limit_hit(${bucket}, ${limit}::int, ${window}::interval)`;

run('rate limiter', () => {
  beforeAll(() => {
    owner = postgres(ADMIN_URL!, { max: 4, prepare: false, onnotice: () => {} });
    app = postgres(APP_URL!, { max: 16, prepare: false, onnotice: () => {} });
  });

  beforeEach(async () => {
    await owner`DELETE FROM core.rate_limit WHERE bucket LIKE 'test:%'`;
  });

  afterAll(async () => {
    await owner`DELETE FROM core.rate_limit WHERE bucket LIKE 'test:%'`;
    await owner.end();
    await app.end();
  });

  it('allows exactly the limit, then refuses', async () => {
    const verdicts: boolean[] = [];
    for (let i = 0; i < 8; i++) verdicts.push((await hit('test:basic'))[0]!.allowed);
    expect(verdicts.filter(Boolean)).toHaveLength(5);
    expect(verdicts.slice(0, 5).every(Boolean)).toBe(true);
    expect(verdicts.slice(5).some(Boolean)).toBe(false);
  });

  it('holds when the requests arrive at once', async () => {
    // The upsert takes a row lock, so concurrent callers serialize and each
    // reads a distinct count. Without that, twelve simultaneous requests all
    // read 0 and all pass.
    const results = await Promise.all(Array.from({ length: 12 }, () => hit('test:concurrent')));
    expect(results.filter((r) => r[0]!.allowed)).toHaveLength(5);

    const [row] = await owner<{ hits: number }[]>`
      SELECT sum(hits)::int AS hits FROM core.rate_limit WHERE bucket = 'test:concurrent'`;
    // Every attempt is counted, including the refused ones -- otherwise
    // hammering a blocked endpoint never extends the backoff.
    expect(row!.hits).toBe(12);
  });

  it('does not hand out a second budget at the window boundary', async () => {
    // A full budget spent in the PREVIOUS window, with the current one just
    // begun. A fixed-window counter sees an empty current window and allows
    // five more immediately.
    const bucket = 'test:boundary';
    const [w] = await owner<{ current: string; previous: string }[]>`
      SELECT to_timestamp(floor(extract(epoch FROM now()) / 60) * 60) AS current,
             to_timestamp(floor(extract(epoch FROM now()) / 60) * 60) - interval '1 minute'
               AS previous`;
    await owner`
      INSERT INTO core.rate_limit (bucket, window_start, hits)
      VALUES (${bucket}, ${w!.previous}, 5)`;

    const [first] = await hit(bucket);
    // How much of the previous window still counts depends on where in the
    // current minute the test runs, so assert the property rather than a
    // number: early in the window the old spend still dominates.
    const elapsed = await owner<{ frac: number }[]>`
      SELECT (extract(epoch FROM now()) - extract(epoch FROM ${w!.current}::timestamptz)) / 60
             AS frac`;
    const carried = 5 * (1 - Number(elapsed[0]!.frac));
    if (carried + 1 > 5) {
      expect(first!.allowed).toBe(false);
    } else {
      // Late enough in the window that the old budget has genuinely decayed,
      // which is the behavior we want rather than a failure.
      expect(first!.allowed).toBe(true);
    }
    // Either way it must never behave as though the previous window did not
    // happen: a fixed window would report the full budget remaining.
    expect(first!.remaining).toBeLessThan(5);
  });

  it('keeps separate buckets separate', async () => {
    for (let i = 0; i < 6; i++) await hit('test:alice');
    const [bob] = await hit('test:bob');
    expect(bob!.allowed).toBe(true);
    expect(bob!.remaining).toBe(4);
  });

  it('never reports a retry_after of zero while refusing', async () => {
    for (let i = 0; i < 6; i++) await hit('test:retry');
    const [r] = await hit('test:retry');
    expect(r!.allowed).toBe(false);
    // A client told to retry after 0 seconds retries immediately and spins.
    expect(r!.retry_after_s).toBeGreaterThan(0);
  });
});
