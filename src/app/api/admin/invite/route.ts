import { NextResponse } from 'next/server';
import { cronAuthorized, databaseUrl } from '@/server/jobs/cron-auth';
import { createInvite, listInvites } from '@/server/repos/invites';

export const dynamic = 'force-dynamic';

/** GET lists invites. POST creates one. Both require the CRON_SECRET bearer. */
export async function GET(request: Request): Promise<NextResponse> {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = databaseUrl();
  if (!url) return NextResponse.json({ error: 'database not configured' }, { status: 500 });
  return NextResponse.json({ invites: await listInvites(url) });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = databaseUrl();
  if (!url) return NextResponse.json({ error: 'database not configured' }, { status: 500 });

  let email: string | null = null;
  try {
    const body = (await request.json()) as { email?: string };
    email = body.email?.trim().toLowerCase() ?? null;
  } catch {
    // A body is optional: an invite with no email may be used by anyone holding it.
  }
  return NextResponse.json(await createInvite(url, email));
}
