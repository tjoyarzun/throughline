import { NextResponse } from 'next/server';
import { cronAuthorized, databaseUrl } from '@/server/jobs/cron-auth';
import { listAdmins, setAdmin } from '@/server/repos/invites';

export const dynamic = 'force-dynamic';

/**
 * Bootstrapping the first admin.
 *
 * Every admin function in the database requires an existing admin to call it,
 * which leaves the first one unreachable -- and production credentials are
 * Sensitive in Vercel, so there is no local psql to reach around it with. This
 * is the way in, guarded by CRON_SECRET exactly like /api/admin/invite.
 *
 * That is not as weak as it sounds: CRON_SECRET already mints invites, so its
 * holder can already create accounts. Granting one of them admin adds no
 * privilege that holder did not already have.
 *
 * GET lists the admins. POST { "email": "...", "admin": true|false } changes one.
 */

export async function GET(request: Request): Promise<NextResponse> {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = databaseUrl();
  if (!url) return NextResponse.json({ error: 'database not configured' }, { status: 500 });
  return NextResponse.json({ admins: await listAdmins(url) });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = databaseUrl();
  if (!url) return NextResponse.json({ error: 'database not configured' }, { status: 500 });

  let email: string;
  let admin = true;
  try {
    const body = (await request.json()) as { email?: string; admin?: boolean };
    if (!body.email?.trim()) throw new Error('email is required');
    email = body.email.trim().toLowerCase();
    if (typeof body.admin === 'boolean') admin = body.admin;
  } catch {
    return NextResponse.json({ error: 'email is required' }, { status: 400 });
  }

  const updated = await setAdmin(url, email, admin);
  if (!updated) {
    // A silent no-op would look like success and leave the owner waiting for a
    // panel that never appears.
    return NextResponse.json({ error: `no account for ${email}` }, { status: 404 });
  }
  return NextResponse.json({ updated });
}
