import { NextResponse } from 'next/server';
import { cronAuthorized, databaseUrl } from '@/server/jobs/cron-auth';
import { runMaintenanceJob } from '@/server/jobs/drain';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request): Promise<NextResponse> {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = databaseUrl();
  if (!url) return NextResponse.json({ error: 'database not configured' }, { status: 500 });
  const result = await runMaintenanceJob(url, 'housekeeping');
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
