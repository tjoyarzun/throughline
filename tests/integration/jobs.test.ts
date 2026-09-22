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

  it('lets a running job enqueue its own successor', async () => {
    // Self-chaining is how the long walks work -- Wikidata enrichment, the
    // TMDB refresh, the people backfill. Deduping against 'running' as well as
    // 'queued' made a chaining job match ITSELF and skip the insert, so every
    // one of them stopped after a single batch while reporting success.
    const payload = { batch: 25 };
    await a`SELECT core.enqueue_job('test_chain', ${a.json(payload as never)})`;
    const [claimed] = await a<{ id: string }[]>`SELECT id FROM core.claim_jobs(1, 'w')`;
    expect(claimed).toBeDefined();

    // The job is now running. Its successor must still be able to join the queue.
    await a`SELECT core.enqueue_job('test_chain', ${a.json(payload as never)})`;
    const [queued] = await a<{ n: number }[]>`
      SELECT count(*)::int AS n FROM core.job WHERE kind = 'test_chain' AND status = 'queued'`;
    expect(queued!.n, 'the successor exists').toBe(1);
  });

  it('reclaims a job whose worker died mid-run', async () => {
    // A worker killed mid-job -- function timeout, deploy, instance recycled --
    // leaves the row in 'running' with nothing to finish it. Before leases,
    // that work was stranded forever AND silently: not queued so depth looked
    // healthy, not failed so nothing alerted. Production lost a Wikidata job
    // to exactly this.
    await a`SELECT core.enqueue_job('test_lease', ${a.json({ n: 1 } as never)})`;
    const claimed = await a<{ id: string }[]>`SELECT id FROM core.claim_jobs(1, 'doomed-worker')`;
    expect(claimed).toHaveLength(1);

    // Still leased: nobody else may take it.
    const tooSoon = await b<{ id: string }[]>`SELECT id FROM core.claim_jobs(1, 'worker-b')`;
    expect(tooSoon, 'a live lease must not be stealable').toHaveLength(0);

    // Age the lease past its expiry rather than waiting five minutes.
    await a`UPDATE core.job SET locked_at = now() - interval '10 minutes'
            WHERE id = ${claimed[0]!.id}`;

    const reclaimed = await b<{ id: string; attempts: number }[]>`
      SELECT id, attempts FROM core.claim_jobs(1, 'worker-b')`;
    expect(
      reclaimed.map((r) => r.id),
      'expired lease must be reclaimable',
    ).toEqual([claimed[0]!.id]);
    // attempts still climbs, so fail_job's cap stops a genuinely poisonous job
    // rather than letting it cycle forever.
    expect(reclaimed[0]!.attempts).toBe(2);
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
