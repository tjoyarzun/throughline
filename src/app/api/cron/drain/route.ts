import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { drainQueue } from '@/server/jobs/drain';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Constant-time: a timing oracle on a cron secret is cheap to avoid. */
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const a = Buffer.from(request.headers.get('authorization') ?? '');
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) return NextResponse.json({ error: 'database not configured' }, { status: 500 });
  return NextResponse.json(await drainQueue(url));
}
