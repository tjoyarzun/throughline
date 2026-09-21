import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

/**
 * The authentication bootstrap, tested as production actually runs it.
 *
 * Sign-in must find a user by email BEFORE any session exists, so there is no
 * app.account_id to filter by — and usr.account has FORCE ROW LEVEL SECURITY,
 * which binds the table owner too. Without a role-targeted policy, Better Auth
 * simply cannot work in production.
 *
 * The tempting shortcut is a policy like `USING (current_account_id() IS NULL)`,
 * which would let ANY query that forgot withUser() read every account. These
 * tests exist to prove we took the other road: a narrow app_auth role that can
 * manage identities and nothing else.
 */
const ADMIN_URL = process.env.DATABASE_URL;
const APP_URL = process.env.TEST_DATABASE_URL;
const AUTH_URL = process.env.TEST_AUTH_DATABASE_URL;
const run = ADMIN_URL && APP_URL && AUTH_URL ? describe : describe.skip;

let admin: ReturnType<typeof postgres>;
let app: ReturnType<typeof postgres>;
let authDb: ReturnType<typeof postgres>;
let alice: string;
let titleId: string;

run('authentication bootstrap (app_auth role)', () => {
  beforeAll(async () => {
    admin = postgres(ADMIN_URL!, { max: 2, prepare: false });
    app = postgres(APP_URL!, { max: 2, prepare: false });
    authDb = postgres(AUTH_URL!, { max: 2, prepare: false });

    // Clean up FRONT as well as back: a run that fails midway leaves rows
    // behind, and the next run then fails on a unique constraint instead of on
    // whatever actually broke.
    await admin`DELETE FROM usr.account WHERE email LIKE 'bootstrap-%@test.local'`;
    await admin`DELETE FROM usr.invite WHERE code LIKE 'bootstrap-%'`;
    const [t] = await admin<{ id: string }[]>`
      INSERT INTO core.title (slug, kind, title, sort_title)
      VALUES ('bootstrap-fixture', 'movie', 'Bootstrap Fixture', 'bootstrapfixture')
      ON CONFLICT (slug) DO UPDATE SET title = excluded.title RETURNING id`;
    titleId = t!.id;
    const [a] = await admin<{ id: string }[]>`
      INSERT INTO usr.account (email, display_name)
      VALUES ('bootstrap-alice@test.local', 'Alice') RETURNING id`;
    alice = a!.id;
    await admin`INSERT INTO usr.title_state (account_id, title_id, status)
                VALUES (${alice}, ${titleId}, 'watched')`;
    await admin`INSERT INTO usr.rating (account_id, title_id, value)
                VALUES (${alice}, ${titleId}, 8)`;
  });

  afterAll(async () => {
    await admin`DELETE FROM usr.account WHERE email LIKE 'bootstrap-%@test.local'`;
    await admin`DELETE FROM usr.invite WHERE code LIKE 'bootstrap-%'`;
    await admin`DELETE FROM core.title WHERE slug = 'bootstrap-fixture'`;
    await app.end();
    await authDb.end();
    await admin.end();
  });

  it('neither test role can bypass RLS', async () => {
    for (const [name, conn] of [
      ['app', app],
      ['auth', authDb],
    ] as const) {
      const [caps] = await conn<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
      expect(caps?.rolsuper, `${name} superuser`).toBe(false);
      expect(caps?.rolbypassrls, `${name} bypassrls`).toBe(false);
    }
  });

  it('app_auth can find a user by email with NO session — sign-in works', async () => {
    const rows = await authDb`
      SELECT id, email FROM usr.account WHERE email = 'bootstrap-alice@test.local'`;
    expect(rows, 'without this, Better Auth cannot sign anyone in').toHaveLength(1);
    expect(rows[0]!.id).toBe(alice);
  });

  it('app_auth can create a user with no session — sign-up works', async () => {
    const rows = await authDb<{ id: string }[]>`
      INSERT INTO usr.account (email, display_name)
      VALUES ('bootstrap-new@test.local', 'New') RETURNING id`;
    expect(rows).toHaveLength(1);
    await admin`DELETE FROM usr.account WHERE email = 'bootstrap-new@test.local'`;
  });

  it('app_web CANNOT read another account, session or not', async () => {
    // The privilege granted to app_auth must not leak to the application role.
    const noSession = await app`SELECT * FROM usr.account`;
    expect(noSession).toHaveLength(0);

    const asNobody = await app.begin(async (tx) => {
      await tx`select set_config('app.account_id', ${'00000000-0000-0000-0000-000000000000'}, true)`;
      return tx`SELECT * FROM usr.account WHERE email = 'bootstrap-alice@test.local'`;
    });
    expect(asNobody).toHaveLength(0);
  });

  it('app_auth CANNOT read viewing history, ratings or notes', async () => {
    // The whole justification for a separate role is that it is NARROW.
    // Identity management must not carry access to what someone watched.
    for (const table of ['title_state', 'rating', 'viewing', 'note', 'share']) {
      await expect(
        authDb.unsafe(`SELECT * FROM usr.${table}`),
        `app_auth must not reach usr.${table}`,
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it('app_auth cannot write the global model either', async () => {
    await expect(
      authDb`INSERT INTO core.title (slug, kind, title, sort_title)
             VALUES ('auth-should-not-write', 'movie', 'Nope', 'nope')`,
    ).rejects.toThrow(/permission denied/i);
  });

  it('app_web still sees only its own rows once a session exists', async () => {
    const rows = await app.begin(async (tx) => {
      await tx`select set_config('app.account_id', ${alice}, true)`;
      return tx`SELECT title_id FROM usr.title_state`;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title_id).toBe(titleId);
  });

  it('app_auth can redeem an invite but not read viewing data through it', async () => {
    const [inv] = await admin<{ id: string; code: string }[]>`
      INSERT INTO usr.invite (code, expires_at)
      VALUES ('bootstrap-code', now() + interval '7 days') RETURNING id, code`;
    const found = await authDb`
      SELECT id FROM usr.invite WHERE code = ${inv!.code} AND redeemed_at IS NULL`;
    expect(found).toHaveLength(1);
    await authDb`UPDATE usr.invite SET redeemed_at = now() WHERE id = ${inv!.id}`;
    await admin`DELETE FROM usr.invite WHERE id = ${inv!.id}`;
  });
});
