import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { redeemInvite } from '@/server/auth/invite';

/**
 * Invite-only sign-up.
 *
 * These import the REAL redeemInvite rather than reimplementing its query. The
 * first version of this file reimplemented it correctly while the production
 * code was racy — so every test passed and the bug shipped. A test that does
 * not exercise the shipped code is worse than no test, because it buys
 * confidence it has not earned.
 */
const URL = process.env.DATABASE_URL;
const run = URL ? describe : describe.skip;
let sql: ReturnType<typeof postgres>;

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

  it('a valid unredeemed invite is accepted', async () => {
    await sql`INSERT INTO usr.invite (code, expires_at)
              VALUES ('GATE-OK', now() + interval '7 days')`;
    expect(await redeemInvite(sql, 'GATE-OK', 'a@test.local')).toBe(true);
  });

  it('an unknown code is refused', async () => {
    expect(await redeemInvite(sql, 'GATE-NOPE', 'a@test.local')).toBe(false);
  });

  it('an expired invite is refused', async () => {
    await sql`INSERT INTO usr.invite (code, expires_at)
              VALUES ('GATE-OLD', now() - interval '1 day')`;
    expect(await redeemInvite(sql, 'GATE-OLD', 'a@test.local')).toBe(false);
  });

  it('an invite works exactly once', async () => {
    await sql`INSERT INTO usr.invite (code, expires_at)
              VALUES ('GATE-ONCE', now() + interval '7 days')`;
    expect(await redeemInvite(sql, 'GATE-ONCE', 'first@test.local')).toBe(true);
    expect(await redeemInvite(sql, 'GATE-ONCE', 'second@test.local')).toBe(false);
  });

  it('two simultaneous redemptions admit exactly one person', async () => {
    // The check-then-update shape is a classic race: both sessions see an
    // unredeemed invite and both proceed. FOR UPDATE SKIP LOCKED inside the
    // UPDATE makes the read and the write one atomic step.
    await sql`INSERT INTO usr.invite (code, expires_at)
              VALUES ('GATE-RACE', now() + interval '7 days')`;
    const [a, b] = await Promise.all([
      redeemInvite(sql, 'GATE-RACE', 'a@test.local'),
      redeemInvite(sql, 'GATE-RACE', 'b@test.local'),
    ]);
    expect([a, b].filter(Boolean), 'exactly one redemption may succeed').toHaveLength(1);

    const [row] = await sql<{ email: string }[]>`
      SELECT email FROM usr.invite WHERE code = 'GATE-RACE'`;
    expect(['a@test.local', 'b@test.local']).toContain(row!.email);
  });

  it('records who redeemed it', async () => {
    await sql`INSERT INTO usr.invite (code, expires_at)
              VALUES ('GATE-WHO', now() + interval '7 days')`;
    await redeemInvite(sql, 'GATE-WHO', 'someone@test.local');
    const [row] = await sql<{ email: string; redeemed_at: string }[]>`
      SELECT email, redeemed_at::text FROM usr.invite WHERE code = 'GATE-WHO'`;
    expect(row!.email).toBe('someone@test.local');
    expect(row!.redeemed_at).toBeTruthy();
  });
});
