import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
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

  it('treats an injection attempt in the code as data, not SQL', async () => {
    // The invite code is the one free-text field a stranger can send the login
    // endpoint. Every query is a tagged template, so the driver ships it as a
    // parameter and these match no row -- even with an open invite sitting
    // there for a tautology to grab.
    await open('GATE-BAIT');
    for (const code of ["' OR '1'='1", "x' OR 1=1 --", "'; DELETE FROM usr.invite; --"]) {
      expect(await reserveInvite(sql, code, 'attacker@test.local')).toBe(false);
    }
    const [row] = await sql<{ email: string | null }[]>`
      SELECT email FROM usr.invite WHERE code = 'GATE-BAIT'`;
    expect(row, 'the bait invite survived').toBeDefined();
    expect(row!.email, 'and nobody reserved it').toBeNull();
  });
});

/**
 * Better Auth limits code requests per IP. Nothing limited them per ADDRESS,
 * so one machine could send a real person 4,000+ codes a day -- each a Resend
 * send from the quota every sign-in depends on. Driven through auth.api, which
 * runs our hook but not Better Auth's IP limiter, so only the new limit is
 * under test.
 */
run('per-address code limit', () => {
  const EMAIL = 'gate-flood@test.local';
  const BUCKET = `otp-email:${createHash('sha256').update(EMAIL).digest('hex').slice(0, 32)}`;
  const reset = async () => {
    await sql`DELETE FROM core.rate_limit WHERE bucket = ${BUCKET}`;
    await sql`DELETE FROM usr.auth_verification WHERE identifier LIKE ${'%' + EMAIL + '%'}`;
  };

  beforeAll(async () => {
    sql = postgres(URL!, { max: 2, prepare: false, onnotice: () => {} });
    await sql`DELETE FROM usr.account WHERE email = ${EMAIL}`;
    await sql`INSERT INTO usr.account (email, display_name) VALUES (${EMAIL}, 'Flood')`;
    await reset();
  });
  afterAll(async () => {
    await reset();
    await sql`DELETE FROM usr.account WHERE email = ${EMAIL}`;
    await sql.end();
  });

  it('sends five codes an hour to one address, then refuses', async () => {
    const { auth } = await import('@/server/auth/auth');
    const send = () => auth.api.sendVerificationOTP({ body: { email: EMAIL, type: 'sign-in' } });

    for (let i = 1; i <= 5; i++) await expect(send(), `request ${i}`).resolves.toBeTruthy();
    await expect(send()).rejects.toMatchObject({ statusCode: 429 });
  });
});
