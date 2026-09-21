/**
 * Creates an invite code. Sign-up is invite-only and enforced server-side, so
 * this is the only way in.
 *
 * Usage:
 *   pnpm invite                        anyone with the code may use it
 *   pnpm invite someone@example.com    records who it was meant for
 *   pnpm invite --list                 show outstanding invites
 */
import postgres from 'postgres';
import { directDatabaseUrl, describeUrl } from '@/server/db/resolve-url';

const resolved = directDatabaseUrl();
if (!resolved) {
  console.error('invite: no database URL configured');
  process.exit(2);
}
const sql = postgres(resolved.url, { max: 1, prepare: false, onnotice: () => {} });

/** Unambiguous alphabet: no O/0, I/1, so a code can be read aloud. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const group = () =>
  Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  console.log(`invite: ${describeUrl(resolved!.url)}\n`);

  if (args.includes('--list')) {
    const rows = await sql<
      { code: string; email: string | null; expires_at: string; redeemed_at: string | null }[]
    >`SELECT code, email, expires_at::text, redeemed_at::text
      FROM usr.invite ORDER BY created_at DESC LIMIT 25`;
    if (rows.length === 0) console.log('  no invites yet');
    for (const r of rows) {
      const state = r.redeemed_at
        ? `redeemed ${r.redeemed_at.slice(0, 10)}`
        : new Date(r.expires_at) < new Date()
          ? 'EXPIRED'
          : 'open';
      console.log(`  ${r.code}  ${state.padEnd(22)} ${r.email ?? ''}`);
    }
    await sql.end();
    return;
  }

  const email = args.find((a) => a.includes('@')) ?? null;
  const code = `${group()}-${group()}`;
  await sql`
    INSERT INTO usr.invite (code, email, expires_at)
    VALUES (${code}, ${email}, now() + interval '30 days')`;

  console.log(`  code    ${code}`);
  console.log(`  for     ${email ?? 'anyone'}`);
  console.log(`  expires in 30 days\n`);
  console.log('  Enter it on the sign-in page along with an email address.');
  await sql.end();
}

main().catch(async (e) => {
  console.error('invite FAILED:', e instanceof Error ? e.message : e);
  await sql.end();
  process.exit(1);
});
