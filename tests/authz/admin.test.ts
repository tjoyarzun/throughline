import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

/**
 * The admin surface reads ACROSS account boundaries, which is the one thing
 * RLS exists to stop. So every function is SECURITY DEFINER and checks the
 * caller itself.
 *
 * The first version put that check in a WHERE clause. The planner elided it,
 * and a non-admin -- and a caller with no session at all -- got every row. It
 * looked exactly like a working guard. These tests exist because reading the
 * code was not enough to tell.
 */
const ADMIN_URL = process.env.DATABASE_URL;
const APP_URL = process.env.TEST_DATABASE_URL;
const run = ADMIN_URL && APP_URL ? describe : describe.skip;

let owner: ReturnType<typeof postgres>;
let app: ReturnType<typeof postgres>;
let adminId: string;
let plainId: string;

/** Runs a statement as the app role with app.account_id set, as withUser does. */
async function asUser<T>(accountId: string | null, query: string): Promise<T[]> {
  return app.begin(async (tx) => {
    await tx`SELECT set_config('app.account_id', ${accountId}, true)`;
    return tx.unsafe(query);
  }) as unknown as Promise<T[]>;
}

run('admin surface', () => {
  beforeAll(async () => {
    owner = postgres(ADMIN_URL!, { max: 2, prepare: false, onnotice: () => {} });
    app = postgres(APP_URL!, { max: 2, prepare: false, onnotice: () => {} });
    // Invites first: they carry a created_by FK to the accounts below, so
    // deleting accounts first fails and takes beforeAll down with it.
    await owner`DELETE FROM usr.invite WHERE code LIKE 'ADMTEST-%' OR code = 'SHOULD-NOT-EXIST'`;
    await owner`DELETE FROM usr.account WHERE email LIKE 'adm-%@test.local'`;

    const [a] = await owner<{ id: string }[]>`
      INSERT INTO usr.account (email, display_name, is_admin)
      VALUES ('adm-boss@test.local', 'Boss', true) RETURNING id`;
    adminId = a!.id;
    const [p] = await owner<{ id: string }[]>`
      INSERT INTO usr.account (email, display_name, is_admin)
      VALUES ('adm-plain@test.local', 'Plain', false) RETURNING id`;
    plainId = p!.id;
  });

  afterAll(async () => {
    await owner`DELETE FROM usr.invite WHERE code LIKE 'ADMTEST-%' OR code = 'SHOULD-NOT-EXIST'`;
    await owner`DELETE FROM usr.account WHERE email LIKE 'adm-%@test.local'`;
    await owner.end();
    await app.end();
  });

  const FUNCTIONS = [
    'SELECT * FROM usr.admin_users()',
    'SELECT * FROM usr.admin_invites()',
    `SELECT * FROM usr.admin_sessions('00000000-0000-0000-0000-000000000000')`,
    `SELECT usr.admin_revoke_session('nope')`,
    `SELECT usr.admin_revoke_invite('nope')`,
    `SELECT * FROM usr.admin_create_invite('SHOULD-NOT-EXIST', '', 7)`,
  ];

  it.each(FUNCTIONS)('refuses a non-admin: %s', async (query) => {
    await expect(asUser(plainId, query)).rejects.toThrow(/not an admin/);
  });

  it.each(FUNCTIONS)('refuses a caller with no session: %s', async (query) => {
    // current_account_id() is null, so the EXISTS is false and it must raise
    // rather than fall through to "no rows".
    await expect(asUser(null, query)).rejects.toThrow(/not an admin/);
  });

  it('a refused invite creation writes nothing', async () => {
    // A guard that raises AFTER the insert would be worse than none.
    const [row] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM usr.invite WHERE code = 'SHOULD-NOT-EXIST'`;
    expect(row!.n).toBe(0);
  });

  it('lets an admin through, with the numbers', async () => {
    const rows = await asUser<{ email: string; watched: number; streak: number }>(
      adminId,
      'SELECT * FROM usr.admin_users()',
    );
    expect(rows.length).toBeGreaterThan(0);
    const boss = rows.find((r) => r.email === 'adm-boss@test.local');
    expect(boss, 'the admin sees every account, including their own').toBeDefined();
    expect(Number(boss!.watched)).toBe(0);
    expect(Number(boss!.streak), 'no logins yet is a streak of zero').toBe(0);
  });

  /**
   * usr.invite has no RLS -- there is no account_id to scope it by -- so it
   * was covered only by the absence of a grant. The blanket
   * "GRANT ... ON ALL TABLES IN SCHEMA usr TO app_web" in 40-roles.sql had
   * handed it one, and the app role read live invite codes with no session
   * set at all. Every new usr table inherits that grant, so this asserts the
   * revoke rather than trusting it stayed.
   */
  it('does not let the app role read invite codes directly', async () => {
    await owner`
      INSERT INTO usr.invite (code, expires_at)
      VALUES ('ADMTEST-LEAK', now() + interval '1 day')
      ON CONFLICT (code) DO NOTHING`;

    await expect(asUser(adminId, `SELECT code FROM usr.invite`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(asUser(null, `SELECT code FROM usr.invite`)).rejects.toThrow(/permission denied/);

    // Being an admin is not a way around it either: the only path is the
    // SECURITY DEFINER function.
    const viaFunction = await asUser<{ code: string }>(
      adminId,
      `SELECT * FROM usr.admin_invites()`,
    );
    expect(viaFunction.map((r) => r.code)).toContain('ADMTEST-LEAK');
  });

  it('creates an invite an admin can then see', async () => {
    const created = await asUser<{ code: string }>(
      adminId,
      `SELECT * FROM usr.admin_create_invite('ADMTEST-1', '', 7)`,
    );
    expect(created[0]!.code).toBe('ADMTEST-1');

    const list = await asUser<{ code: string }>(adminId, 'SELECT * FROM usr.admin_invites()');
    expect(list.map((r) => r.code)).toContain('ADMTEST-1');

    // And revoking it removes it.
    await asUser(adminId, `SELECT usr.admin_revoke_invite('ADMTEST-1')`);
    const after = await asUser<{ code: string }>(adminId, 'SELECT * FROM usr.admin_invites()');
    expect(after.map((r) => r.code)).not.toContain('ADMTEST-1');
  });
});
