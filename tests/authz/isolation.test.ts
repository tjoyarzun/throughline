import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

/**
 * The tests whose absence would be embarrassing.
 *
 * These run against a real Postgres because RLS cannot be unit-tested — the
 * whole point is that the DATABASE refuses, not that the application remembers
 * to filter.
 *
 * A note on the role used here: the migration owner BYPASSES RLS unless the
 * table has FORCE ROW LEVEL SECURITY, which 30-rls.sql sets for exactly this
 * reason. Without FORCE, every test below would pass vacuously.
 */
const ADMIN_URL = process.env.DATABASE_URL;
const APP_URL = process.env.TEST_DATABASE_URL;
const run = ADMIN_URL && APP_URL ? describe : describe.skip;

/** Privileged: seeds core.* fixtures and accounts. Never used for an assertion. */
let admin: ReturnType<typeof postgres>;
/** Restricted, exactly app_web's grants. Every assertion runs through this. */
let client: ReturnType<typeof postgres>;
let alice: string;
let bob: string;
let titleId: string;

run('user data isolation (RLS)', () => {
  beforeAll(async () => {
    admin = postgres(ADMIN_URL!, { max: 2, prepare: false });
    client = postgres(APP_URL!, { max: 4, prepare: false });

    // THE GUARD. Superusers and BYPASSRLS roles ignore row-level security even
    // with FORCE set, so the entire suite would pass while proving nothing.
    // Fail loudly rather than quietly.
    const [caps] = await client<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    if (caps?.rolsuper || caps?.rolbypassrls) {
      throw new Error(
        'TEST_DATABASE_URL connects as a role that bypasses RLS. ' +
          'Every assertion in this file would pass vacuously. Run `pnpm db:test-role`.',
      );
    }

    await admin`DELETE FROM usr.account WHERE email LIKE 'authz-%@test.local'`;
    const [t] = await admin<{ id: string }[]>`
      INSERT INTO core.title (slug, kind, title, sort_title)
      VALUES ('authz-fixture', 'movie', 'Authz Fixture', 'authzfixture')
      ON CONFLICT (slug) DO UPDATE SET title = excluded.title
      RETURNING id`;
    titleId = t!.id;

    const [a] = await admin<{ id: string }[]>`
      INSERT INTO usr.account (email, display_name)
      VALUES ('authz-alice@test.local', 'Alice') RETURNING id`;
    const [b] = await admin<{ id: string }[]>`
      INSERT INTO usr.account (email, display_name)
      VALUES ('authz-bob@test.local', 'Bob') RETURNING id`;
    alice = a!.id;
    bob = b!.id;

    // Alice tracks and rates the fixture, inside her own scope, as app_web.
    await client.begin(async (tx) => {
      await tx`select set_config('app.account_id', ${alice}, true)`;
      await tx`INSERT INTO usr.title_state (account_id, title_id, status)
               VALUES (${alice}, ${titleId}, 'watched')`;
      await tx`INSERT INTO usr.rating (account_id, title_id, value)
               VALUES (${alice}, ${titleId}, 9)`;
      await tx`INSERT INTO usr.note (account_id, subject_type, subject_id, body)
               VALUES (${alice}, 'title', ${titleId}, 'Alice private note')`;
    });
  });

  afterAll(async () => {
    await admin`DELETE FROM usr.account WHERE email LIKE 'authz-%@test.local'`;
    await admin`DELETE FROM core.title WHERE slug = 'authz-fixture'`;
    await client.end();
    await admin.end();
  });

  it('the test role genuinely cannot bypass RLS', async () => {
    const [caps] = await client<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(caps?.rolsuper).toBe(false);
    expect(caps?.rolbypassrls).toBe(false);
  });

  it('the application role cannot write to the global model', async () => {
    // Product principle 4, enforced by grants rather than by convention.
    await expect(
      client`INSERT INTO core.title (slug, kind, title, sort_title)
             VALUES ('app-should-not-write', 'movie', 'Nope', 'nope')`,
    ).rejects.toThrow(/permission denied/i);
  });

  it('the application role has no access to raw at all', async () => {
    await expect(client`SELECT * FROM raw.tmdb_payload LIMIT 1`).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('a query outside withUser() returns zero rows', async () => {
    // Proves RLS is ON, not merely that the application is well-behaved. If this
    // ever returns rows, every other test in this file is meaningless.
    const rows = await client`SELECT * FROM usr.title_state`;
    expect(rows).toHaveLength(0);
  });

  it('Alice sees her own row inside her scope', async () => {
    const rows = await client.begin(async (tx) => {
      await tx`select set_config('app.account_id', ${alice}, true)`;
      return tx`SELECT title_id, status FROM usr.title_state`;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('watched');
  });

  it('Bob cannot read Alice rows even holding her account id and title id', async () => {
    const rows = await client.begin(async (tx) => {
      await tx`select set_config('app.account_id', ${bob}, true)`;
      return tx`SELECT * FROM usr.title_state
                WHERE account_id = ${alice} AND title_id = ${titleId}`;
    });
    expect(rows).toHaveLength(0);
  });

  it.each(['rating', 'note', 'viewing', 'state_event', 'episode_progress', 'share'])(
    'Bob cannot read Alice usr.%s',
    async (table) => {
      const rows = await client.begin(async (tx) => {
        await tx`select set_config('app.account_id', ${bob}, true)`;
        return tx.unsafe(`SELECT * FROM usr.${table} WHERE account_id = '${alice}'`);
      });
      expect(rows).toHaveLength(0);
    },
  );

  it('Bob cannot read Alice account row', async () => {
    const rows = await client.begin(async (tx) => {
      await tx`select set_config('app.account_id', ${bob}, true)`;
      return tx`SELECT * FROM usr.account WHERE id = ${alice}`;
    });
    expect(rows).toHaveLength(0);
  });

  it('Bob cannot INSERT a row owned by Alice (WITH CHECK)', async () => {
    await expect(
      client.begin(async (tx) => {
        await tx`select set_config('app.account_id', ${bob}, true)`;
        return tx`INSERT INTO usr.title_state (account_id, title_id, status)
                  VALUES (${alice}, ${titleId}, 'watchlist')`;
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('Bob cannot UPDATE or DELETE Alice rows', async () => {
    const updated = await client.begin(async (tx) => {
      await tx`select set_config('app.account_id', ${bob}, true)`;
      return tx`UPDATE usr.title_state SET status = 'abandoned'
                WHERE account_id = ${alice} RETURNING 1`;
    });
    expect(updated).toHaveLength(0);

    const deleted = await client.begin(async (tx) => {
      await tx`select set_config('app.account_id', ${bob}, true)`;
      return tx`DELETE FROM usr.title_state WHERE account_id = ${alice} RETURNING 1`;
    });
    expect(deleted).toHaveLength(0);

    // Alice's row is intact.
    const still = await client.begin(async (tx) => {
      await tx`select set_config('app.account_id', ${alice}, true)`;
      return tx`SELECT status FROM usr.title_state WHERE title_id = ${titleId}`;
    });
    expect(still[0]!.status).toBe('watched');
  });

  it('sem.user_title is RLS-scoped through to the view', async () => {
    // A view can leak what its base tables protect if it is owned by a
    // bypassing role. This asserts the policy survives the abstraction.
    const asBob = await client.begin(async (tx) => {
      await tx`select set_config('app.account_id', ${bob}, true)`;
      return tx`SELECT * FROM sem.user_title`;
    });
    expect(asBob).toHaveLength(0);

    const asAlice = await client.begin(async (tx) => {
      await tx`select set_config('app.account_id', ${alice}, true)`;
      return tx`SELECT title_id, rating, status FROM sem.user_title`;
    });
    expect(asAlice).toHaveLength(1);
    expect(Number(asAlice[0]!.rating)).toBe(4.5); // 9 half-stars -> 4.5
  });

  it('an empty or malformed account id yields nothing, never everything', async () => {
    for (const bad of ['', '00000000-0000-0000-0000-000000000000']) {
      const rows = await client.begin(async (tx) => {
        await tx`select set_config('app.account_id', ${bad}, true)`;
        return tx`SELECT * FROM usr.title_state`;
      });
      expect(rows, `account id ${JSON.stringify(bad)}`).toHaveLength(0);
    }
  });
});
