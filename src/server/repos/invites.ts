import postgres from 'postgres';

/**
 * Invite administration.
 *
 * Reachable over HTTP because the alternative — opening the Neon console and
 * writing SQL by hand — is worse: production credentials are Sensitive in
 * Vercel and deliberately cannot be pulled, so there is no local path to the
 * production database. Bootstrapping the first account has to be possible
 * without one.
 *
 * Authorized with CRON_SECRET, which already exists and already guards the
 * scheduled endpoints. An invite is low-privilege on its own: holding one
 * still requires completing an email round trip to become an account.
 */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0 or I/1 — readable aloud
const group = () =>
  Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

export interface InviteRow {
  code: string;
  email: string | null;
  expires_at: string;
  redeemed_at: string | null;
}

export async function createInvite(
  databaseUrl: string,
  email: string | null,
  days = 30,
): Promise<InviteRow> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const [row] = await sql<InviteRow[]>`
      INSERT INTO usr.invite (code, email, expires_at)
      VALUES (${`${group()}-${group()}`}, ${email},
              now() + (${days}::int * interval '1 day'))
      RETURNING code, email, expires_at::text, redeemed_at::text`;
    return row!;
  } finally {
    await sql.end();
  }
}

export async function listInvites(databaseUrl: string): Promise<InviteRow[]> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    return await sql<InviteRow[]>`
      SELECT code, email, expires_at::text, redeemed_at::text
      FROM usr.invite ORDER BY created_at DESC LIMIT 50`;
  } finally {
    await sql.end();
  }
}

export interface AdminAccount {
  email: string;
  is_admin: boolean;
}

/**
 * Who currently holds admin.
 *
 * Here rather than in the route because scripts/check-layers.sh forbids usr.*
 * from src/app -- and rightly: a route reaching the user schema directly is
 * exactly how a query without an account scope gets written.
 */
export async function listAdmins(databaseUrl: string): Promise<AdminAccount[]> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    return await sql<AdminAccount[]>`
      SELECT email::text, is_admin FROM usr.account
      WHERE is_admin AND deleted_at IS NULL ORDER BY created_at`;
  } finally {
    await sql.end();
  }
}

/**
 * Grant or revoke admin by email.
 *
 * The only way to make the FIRST admin: every usr.admin_* function requires an
 * existing admin, and production credentials are Sensitive in Vercel, so there
 * is no psql to reach around it with.
 *
 * Returns null when no account matches, so the caller can say so. Reporting
 * success for an address that does not exist would leave the owner staring at
 * a page that never appears.
 */
export async function setAdmin(
  databaseUrl: string,
  email: string,
  admin: boolean,
): Promise<AdminAccount | null> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const rows = await sql<AdminAccount[]>`
      UPDATE usr.account SET is_admin = ${admin}
      WHERE email = ${email} AND deleted_at IS NULL
      RETURNING email::text, is_admin`;
    return rows[0] ?? null;
  } finally {
    await sql.end();
  }
}
