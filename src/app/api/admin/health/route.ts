import { NextResponse } from 'next/server';
import { cronAuthorized } from '@/server/jobs/cron-auth';
import { getHealth } from '@/server/repos/health';

/**
 * The full health report, for whoever holds CRON_SECRET. The public
 * /api/health says only ok or not; see the note there for why.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    return NextResponse.json(
      { status: 'error', db: 'not_configured', problems: ['DATABASE_URL is not set'] },
      { status: 503 },
    );
  }
  const report = await getHealth(url);
  return NextResponse.json(report, {
    status: report.status === 'ok' ? 200 : 503,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
