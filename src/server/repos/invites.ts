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
