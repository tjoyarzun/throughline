import type postgres from 'postgres';

/**
 * Invite redemption.
 *
 * Extracted so the tests exercise THIS function rather than a reimplementation
 * of it. The first version lived inline in auth.ts and the test reimplemented
 * the query — which meant the test passed while the real code was racy, the
 * worst possible outcome for a test.
 *
 * The race: a select-then-update sees an unredeemed invite in two sessions at
 * once and both proceed. Even with `redeemed_at IS NULL` in the UPDATE's WHERE,
 * the second update simply affects zero rows — and if the caller does not CHECK
 * that, it still reports success and a single invite admits two people.
 *
 * One statement, `RETURNING` to prove a row actually changed.
 */
export async function redeemInvite(
  sql: ReturnType<typeof postgres>,
  code: string,
  email: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE usr.invite
    SET redeemed_at = now(), email = ${email}
    WHERE id = (
      SELECT id FROM usr.invite
      WHERE code = ${code}
        AND redeemed_at IS NULL
        AND expires_at > now()
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id`;
  return rows.length === 1;
}
