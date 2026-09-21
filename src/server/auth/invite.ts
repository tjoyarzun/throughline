import type postgres from 'postgres';

/**
 * Invite handling, split into RESERVE and REDEEM.
 *
 * The first version consumed the invite when the sign-in code was SENT, which
 * is wrong in a way that only shows up in use: the account is not created
 * until the code is verified, so anyone who mistyped the code, lost the email,
 * or simply abandoned the flow burned their invite and was locked out with no
 * account to show for it. It happened on the very first real sign-in attempt.
 *
 * So:
 *   reserveInvite  at send time — proves the person is invited and ties the
 *                  invite to their email, WITHOUT consuming it. Idempotent for
 *                  the same address, so retrying is free.
 *   redeemInvite   at account-creation time — the point of no return.
 *
 * The `email` column carries the reservation; `redeemed_at` carries the
 * consumption. An invite reserved for one address cannot be taken by another.
 */

/** May this email sign up? Ties the invite to them without consuming it. */
export async function reserveInvite(
  sql: ReturnType<typeof postgres>,
  code: string,
  email: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE usr.invite
    SET email = ${email}
    WHERE id = (
      SELECT id FROM usr.invite
      WHERE code = ${code}
        AND redeemed_at IS NULL
        AND expires_at > now()
        -- Unclaimed, or already reserved by this same person retrying.
        AND (email IS NULL OR email = ${email})
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id`;
  return rows.length === 1;
}

/**
 * Consume the invite reserved for this email. Called when the account is
 * actually created, so a failed verification costs nothing.
 *
 * One statement with RETURNING, not select-then-update: the obvious version
 * races, and even with `redeemed_at IS NULL` in the WHERE the second caller's
 * update simply affects zero rows — which still reports success unless the
 * caller checks. One invite would admit two people.
 */
export async function redeemInvite(
  sql: ReturnType<typeof postgres>,
  email: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE usr.invite
    SET redeemed_at = now()
    WHERE id = (
      SELECT id FROM usr.invite
      WHERE email = ${email}
        AND redeemed_at IS NULL
        AND expires_at > now()
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id`;
  return rows.length === 1;
}
