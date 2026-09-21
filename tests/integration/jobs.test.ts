import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';

/**
 * The job queue is 120 lines of SQL instead of a queue vendor (docs/adr/0011),
 * which is only defensible if the concurrency semantics actually hold. These
 * tests are that justification.
 */
const URL = process.env.DATABASE_URL;
const run = URL ? describe : describe.skip;
let a: ReturnType<typeof postgres>;
let b: ReturnType<typeof postgres>;

run('core.job queue', () => {
  beforeAll(() => {
    a = postgres(URL!, { max: 2, prepare: false, onnotice: () => {} });
    b = postgres(URL!, { max: 2, prepare: false, onnotice: () => {} });
  });
  afterAll(async () => {
    await a`DELETE FROM core.job WHERE kind LIKE 'test_%'`;
    await a.end();
    await b.end();
  });
  beforeEach(async () => {
    await a`DELETE FROM core.job WHERE kind LIKE 'test_%'`;
  });

  it('never hands the same job to two workers', async () => {
    // FOR UPDATE SKIP LOCKED is the whole reason this design is safe. If it
    // regressed, two drains would ingest the same title twice.
    for (let i = 0; i < 40; i++) {
      await a`SELECT core.enqueue_job('test_claim', ${a.json({ i } as never)})`;
    }
    const [ca, cb] = await Promise.all([
      a<{ id: string }[]>`SELECT id FROM core.claim_jobs(20, 'worker-a')`,
      b<{ id: string }[]>`SELECT id FROM core.claim_jobs(20, 'worker-b')`,
    ]);
    const ids = [...ca.map((r) => r.id), ...cb.map((r) => r.id)];
    expect(ids).toHaveLength(40);
    expect(new Set(ids).size, 'no job claimed twice').toBe(40);
  });

  it('does not enqueue the same pending work twice', async () => {
    const [one] = await a<{ enqueue_job: string }[]>`
      SELECT core.enqueue_job('test_dedupe', ${a.json({ titleId: 42 } as never)})`;
    const [two] = await a<{ enqueue_job: string }[]>`
      SELECT core.enqueue_job('test_dedupe', ${a.json({ titleId: 42 } as never)})`;
    expect(two!.enqueue_job).toBe(one!.enqueue_job);
    const rows = await a`SELECT 1 FROM core.job WHERE kind = 'test_dedupe'`;
    expect(rows).toHaveLength(1);
  });

  it('backs off on failure and gives up at the attempt cap', async () => {
    const [j] = await a<{ enqueue_job: string }[]>`
      SELECT core.enqueue_job('test_fail', ${a.json({} as never)})`;
    const id = j!.enqueue_job;

    for (let i = 0; i < 4; i++) {
      await a`UPDATE core.job SET run_after = now() WHERE id = ${id}`;
      await a`SELECT core.claim_jobs(1, 'w')`;
      await a`SELECT core.fail_job(${id}, 'boom')`;
    }
    let [row] = await a<{ status: string; attempts: number }[]>`
      SELECT status, attempts FROM core.job WHERE id = ${id}`;
    expect(row!.status, 'still retrying below the cap').toBe('queued');

    await a`UPDATE core.job SET run_after = now() WHERE id = ${id}`;
    await a`SELECT core.claim_jobs(1, 'w')`;
    await a`SELECT core.fail_job(${id}, 'boom')`;
    [row] = await a<{ status: string; attempts: number }[]>`
      SELECT status, attempts FROM core.job WHERE id = ${id}`;
    expect(row!.status, 'failed jobs surface rather than retrying forever').toBe('failed');
    expect(row!.attempts).toBe(5);
  });

  it('does not claim work scheduled for the future', async () => {
    await a`INSERT INTO core.job (kind, payload, run_after)
            VALUES ('test_future', '{}'::jsonb, now() + interval '1 hour')`;
    const claimed = await a`SELECT id FROM core.claim_jobs(10, 'w')`;
    expect(claimed.filter((r) => r.id)).toHaveLength(0);
  });

  it('marks a finished job done and clears the error', async () => {
    const [j] = await a<{ enqueue_job: string }[]>`
      SELECT core.enqueue_job('test_done', ${a.json({} as never)})`;
    await a`SELECT core.claim_jobs(1, 'w')`;
    await a`SELECT core.fail_job(${j!.enqueue_job}, 'transient')`;
    await a`UPDATE core.job SET run_after = now() WHERE id = ${j!.enqueue_job}`;
    await a`SELECT core.claim_jobs(1, 'w')`;
    await a`SELECT core.finish_job(${j!.enqueue_job})`;
    const [row] = await a<{ status: string; last_error: string | null }[]>`
      SELECT status, last_error FROM core.job WHERE id = ${j!.enqueue_job}`;
    expect(row!.status).toBe('done');
    expect(row!.last_error).toBeNull();
  });
});
