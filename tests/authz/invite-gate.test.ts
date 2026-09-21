import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { reserveInvite, redeemInvite } from '@/server/auth/invite';

/**
 * Invite-only sign-up, against the REAL functions rather than a
 * reimplementation of their queries. An earlier version of this file
 * reimplemented them correctly while the shipped code was racy, so every test
 * passed and the bug went out.
 *
 * The split between reserve and redeem exists because consuming the invite
 * when the code is SENT stranded the first real user: the account is not
 * created until the code is verified, so an unverified send burned the invite
 * and left no account behind.
 */
const URL = process.env.DATABASE_URL;
const run = URL ? describe : describe.skip;
let sql: ReturnType<typeof postgres>;

const open = (code: string) =>
  sql`INSERT INTO usr.invite (code, expires_at) VALUES (${code}, now() + interval '7 days')`;

run('invite gate', () => {
  beforeAll(() => {
    sql = postgres(URL!, { max: 4, prepare: false, onnotice: () => {} });
  });
  afterAll(async () => {
    await sql`DELETE FROM usr.invite WHERE code LIKE 'GATE-%'`;
    await sql.end();
  });
  beforeEach(async () => {
    await sql`DELETE FROM usr.invite WHERE code LIKE 'GATE-%'`;
  });

  it('reserving a valid invite succeeds', async () => {
    await open('GATE-OK');
    expect(await reserveInvite(sql, 'GATE-OK', 'a@test.local')).toBe(true);
  });

  it('an unknown or expired code is refused', async () => {
    expect(await reserveInvite(sql, 'GATE-NOPE', 'a@test.local')).toBe(false);
    await sql`INSERT INTO usr.invite (code, expires_at)
              VALUES ('GATE-OLD', now() - interval '1 day')`;
    expect(await reserveInvite(sql, 'GATE-OLD', 'a@test.local')).toBe(false);
  });

  it('RESERVING DOES NOT CONSUME — the same person may retry', async () => {
    // The defect that stranded the first real sign-in: a code that was sent
    // but never verified burned the invite and left no account.
    await open('GATE-RETRY');
    expect(await reserveInvite(sql, 'GATE-RETRY', 'a@test.local')).toBe(true);
    expect(await reserveInvite(sql, 'GATE-RETRY', 'a@test.local')).toBe(true);
    expect(await reserveInvite(sql, 'GATE-RETRY', 'a@test.local')).toBe(true);
    const [row] = await sql<{ redeemed_at: string | null }[]>`
      SELECT redeemed_at::text FROM usr.invite WHERE code = 'GATE-RETRY'`;
    expect(row!.redeemed_at, 'still unspent until an account exists').toBeNull();
  });

  it('a reserved invite cannot be taken by someone else', async () => {
    await open('GATE-MINE');
    expect(await reserveInvite(sql, 'GATE-MINE', 'first@test.local')).toBe(true);
    expect(await reserveInvite(sql, 'GATE-MINE', 'second@test.local')).toBe(false);
  });

  it('redeeming consumes it exactly once', async () => {
    await open('GATE-ONCE');
    await reserveInvite(sql, 'GATE-ONCE', 'a@test.local');
    expect(await redeemInvite(sql, 'a@test.local')).toBe(true);
    expect(await redeemInvite(sql, 'a@test.local')).toBe(false);
  });

  it('a redeemed invite cannot be reserved again', async () => {
    await open('GATE-SPENT');
    await reserveInvite(sql, 'GATE-SPENT', 'a@test.local');
    await redeemInvite(sql, 'a@test.local');
    expect(await reserveInvite(sql, 'GATE-SPENT', 'a@test.local')).toBe(false);
  });

  it('two simultaneous reservations admit exactly one person', async () => {
    // Check-then-update races: both sessions see an unclaimed invite and both
    // proceed. FOR UPDATE SKIP LOCKED inside the UPDATE makes it atomic.
    await open('GATE-RACE');
    const [a, b] = await Promise.all([
      reserveInvite(sql, 'GATE-RACE', 'a@test.local'),
      reserveInvite(sql, 'GATE-RACE', 'b@test.local'),
    ]);
    expect([a, b].filter(Boolean), 'exactly one may reserve it').toHaveLength(1);
  });

  it('two simultaneous redemptions consume it once', async () => {
    await open('GATE-RACE2');
    await reserveInvite(sql, 'GATE-RACE2', 'a@test.local');
    const [a, b] = await Promise.all([
      redeemInvite(sql, 'a@test.local'),
      redeemInvite(sql, 'a@test.local'),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it('records who it went to', async () => {
    await open('GATE-WHO');
    await reserveInvite(sql, 'GATE-WHO', 'someone@test.local');
    await redeemInvite(sql, 'someone@test.local');
    const [row] = await sql<{ email: string; redeemed_at: string }[]>`
      SELECT email, redeemed_at::text FROM usr.invite WHERE code = 'GATE-WHO'`;
    expect(row!.email).toBe('someone@test.local');
    expect(row!.redeemed_at).toBeTruthy();
  });
});
