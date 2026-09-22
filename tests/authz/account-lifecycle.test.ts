import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

/**
 * Export and deletion.
 *
 * Deletion is the one operation in the app that destroys data, so the tests
 * that matter are the ones about its BLAST RADIUS: that it takes everything
 * belonging to the person, that it takes nothing belonging to anyone else,
 * and that the shared catalog is untouched afterwards. The last of those is
 * the whole four-schema thesis reduced to an assertion.
 */
const ADMIN_URL = process.env.DATABASE_URL;
const APP_URL = process.env.TEST_DATABASE_URL;
const run = ADMIN_URL && APP_URL ? describe : describe.skip;

let owner: ReturnType<typeof postgres>;
let app: ReturnType<typeof postgres>;
let mineId: string;
let theirsId: string;
let titleId: string;

/** Runs as the app role with app.account_id set, exactly as withUser does. */
async function asUser<T>(accountId: string | null, query: string): Promise<T[]> {
  return app.begin(async (tx) => {
    await tx`SELECT set_config('app.account_id', ${accountId}, true)`;
    return tx.unsafe(query);
  }) as unknown as Promise<T[]>;
}

run('account export and deletion', () => {
  beforeAll(async () => {
    owner = postgres(ADMIN_URL!, { max: 2, prepare: false, onnotice: () => {} });
    app = postgres(APP_URL!, { max: 2, prepare: false, onnotice: () => {} });

    await owner`DELETE FROM usr.invite WHERE code LIKE 'LIFE-%'`;
    await owner`DELETE FROM usr.account WHERE email LIKE 'life-%@test.local'`;

    const [a] = await owner<{ id: string }[]>`
      INSERT INTO usr.account (email, display_name)
      VALUES ('life-mine@test.local', 'Mine') RETURNING id`;
    mineId = a!.id;
    const [b] = await owner<{ id: string }[]>`
      INSERT INTO usr.account (email, display_name)
      VALUES ('life-theirs@test.local', 'Theirs') RETURNING id`;
    theirsId = b!.id;

    const [t] = await owner<{ id: string }[]>`SELECT id FROM core.title LIMIT 1`;
    titleId = t!.id;

    // The same rows for both accounts, so "deleted mine" and "deleted
    // everyone's" produce different results. Without the second account this
    // suite would pass against a delete_account that ignored its argument.
    for (const account of [mineId, theirsId]) {
      await owner`
        INSERT INTO usr.title_state (account_id, title_id, status)
        VALUES (${account}, ${titleId}, 'watched')`;
      await owner`
        INSERT INTO usr.rating (account_id, title_id, value)
        VALUES (${account}, ${titleId}, 8)`;
      await owner`
        INSERT INTO usr.state_event (account_id, title_id, to_status)
        VALUES (${account}, ${titleId}, 'watched')`;
      await owner`
        INSERT INTO usr.viewing (account_id, title_id, watched_on)
        VALUES (${account}, ${titleId}, current_date)`;
    }

    // An invite this account created: ON DELETE NO ACTION, so it blocks the
    // account delete until released. This is the case that failed first.
    await owner`
      INSERT INTO usr.invite (code, created_by, expires_at)
      VALUES ('LIFE-MADE', ${mineId}, now() + interval '30 days')`;
  });

  afterAll(async () => {
    await owner`UPDATE usr.invite SET created_by = NULL WHERE code LIKE 'LIFE-%'`;
    await owner`DELETE FROM usr.invite WHERE code LIKE 'LIFE-%'`;
    await owner`DELETE FROM usr.account WHERE email LIKE 'life-%@test.local'`;
    await owner.end();
    await app.end();
  });

  /**
   * The export hands back everything in one response, which makes it the
   * single place where a missing account scope would be most expensive. Both
   * accounts hold a row for the same title, so an unscoped query returns two.
   */
  it('exports only the rows belonging to the caller', async () => {
    const [mine] = await asUser<{ n: number }>(
      mineId,
      `SELECT count(*)::int AS n FROM sem.user_title`,
    );
    expect(mine!.n).toBe(1);

    const [none] = await asUser<{ n: number }>(
      null,
      `SELECT count(*)::int AS n FROM sem.user_title`,
    );
    expect(none!.n).toBe(0);
  });

  it('refuses to delete an account that is not the caller', async () => {
    await expect(
      asUser(mineId, `SELECT * FROM usr.delete_account('${theirsId}'::uuid)`),
    ).rejects.toThrow(/only delete your own account/);

    const [still] = await asUser<{ n: number }>(
      theirsId,
      `SELECT count(*)::int AS n FROM usr.title_state`,
    );
    expect(still!.n).toBe(1);
  });

  it('refuses to delete anything with no session', async () => {
    await expect(
      asUser(null, `SELECT * FROM usr.delete_account('${mineId}'::uuid)`),
    ).rejects.toThrow(/only delete your own account/);
  });

  it('deletes every row belonging to the account, and only those', async () => {
    const before = await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM core.title`;

    const receipt = await asUser<{ entity: string; rows_deleted: number }>(
      mineId,
      `SELECT * FROM usr.delete_account('${mineId}'::uuid)`,
    );
    const by = Object.fromEntries(receipt.map((r) => [r.entity, r.rows_deleted]));
    expect(by.title_state).toBe(1);
    expect(by.rating).toBe(1);
    expect(by.viewing).toBe(1);
    // app_web holds no DELETE grant on state_event at all; this row can only
    // have gone through the SECURITY DEFINER function.
    expect(by.state_event).toBe(1);
    expect(by.account).toBe(1);
    // The invite was released rather than deleted: a spent code must stay spent.
    expect(by.invite_created).toBe(1);

    const [gone] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM usr.account WHERE id = ${mineId}`;
    expect(gone!.n).toBe(0);
    const [invite] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM usr.invite WHERE code = 'LIFE-MADE'`;
    expect(invite!.n).toBe(1);

    // The other account is entirely intact.
    const [theirs] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM usr.title_state WHERE account_id = ${theirsId}`;
    expect(theirs!.n).toBe(1);

    // And the shared catalog never moved. This is the four-schema separation
    // stated as a number: deleting a person removes nothing from core.
    const after = await owner<{ n: number }[]>`SELECT count(*)::int AS n FROM core.title`;
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});
