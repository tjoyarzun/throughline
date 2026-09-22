import { sql } from 'drizzle-orm';
import { withUser, type Tx } from '../db/client';

/**
 * The owner-only admin surface.
 *
 * Every function here is a thin wrapper over a SECURITY DEFINER function in
 * usr. That indirection is the whole point: the privilege check lives in the
 * database, inside the function, as a plpgsql statement —
 *
 *     PERFORM usr.assert_admin();
 *
 * — not in this file and not in the page that renders it. A first attempt put
 * the check in a WHERE clause of each SQL function; the planner elided it
 * entirely, and both a non-admin and a caller with no session at all received
 * every row. A guard that the optimizer is free to skip is not a guard. As a
 * statement it cannot be skipped, because its result is never consumed.
 *
 * So `app_web` holding EXECUTE on these is safe, and a missing UI check can
 * only produce an exception — never a leak.
 */

async function rows<T>(tx: Tx, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await tx.execute(query)) as unknown as T[];
}

export interface AdminUser {
  account_id: string;
  email: string;
  display_name: string | null;
  is_admin: boolean;
  created_at: string;
  watched: number;
  rated: number;
  episodes: number;
  last_login: string | null;
  streak: number;
  active_sessions: number;
}

export interface AdminSession {
  session_id: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  expires_at: string;
}

export interface AdminInvite {
  code: string;
  email: string | null;
  expires_at: string;
  redeemed_at: string | null;
  redeemed_by_email: string | null;
  created_at: string;
}

/**
 * Whether the signed-in account is an admin.
 *
 * Used only to decide whether to RENDER the admin section. It is not the
 * access control — that is assert_admin(), in the database. If this ever
 * returns a wrong `true`, the panel renders and then every query inside it
 * raises. The failure mode is an error, not a disclosure.
 */
export async function isAdmin(accountId: string): Promise<boolean> {
  return withUser(accountId, async (tx) => {
    const r = await rows<{ is_admin: boolean }>(
      tx,
      sql`SELECT is_admin FROM usr.account WHERE id = ${accountId}::uuid AND deleted_at IS NULL`,
    );
    return r[0]?.is_admin === true;
  });
}

export async function adminUsers(accountId: string): Promise<AdminUser[]> {
  return withUser(accountId, (tx) => rows<AdminUser>(tx, sql`SELECT * FROM usr.admin_users()`));
}

export async function adminSessions(accountId: string, target: string): Promise<AdminSession[]> {
  return withUser(accountId, (tx) =>
    rows<AdminSession>(tx, sql`SELECT * FROM usr.admin_sessions(${target}::uuid)`),
  );
}

export async function adminRevokeSession(accountId: string, sessionId: string): Promise<void> {
  await withUser(accountId, (tx) => rows(tx, sql`SELECT usr.admin_revoke_session(${sessionId})`));
}

export async function adminInvites(accountId: string): Promise<AdminInvite[]> {
  return withUser(accountId, (tx) => rows<AdminInvite>(tx, sql`SELECT * FROM usr.admin_invites()`));
}

export async function adminRevokeInvite(accountId: string, code: string): Promise<void> {
  await withUser(accountId, (tx) => rows(tx, sql`SELECT usr.admin_revoke_invite(${code})`));
}

/**
 * Codes are read aloud and typed on a phone, so the alphabet drops the four
 * glyphs that collide in most typefaces: O/0 and I/1.
 *
 * 32 symbols over 8 positions is ~40 bits. Well short of a share slug's 126,
 * and deliberately so — these are short-lived, single-use, and rate-limited by
 * the email round trip that still has to follow. Guessing one buys an attacker
 * the right to prove they control an inbox.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function inviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) out += '-';
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

export async function adminCreateInvite(
  accountId: string,
  email: string,
  days: number,
): Promise<{ code: string; expires_at: string }> {
  const code = inviteCode();
  return withUser(accountId, async (tx) => {
    const r = await rows<{ code: string; expires_at: string }>(
      tx,
      sql`SELECT * FROM usr.admin_create_invite(${code}, ${email}, ${days}::int)`,
    );
    return r[0]!;
  });
}
