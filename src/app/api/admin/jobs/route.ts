import { NextResponse } from 'next/server';
import { cronAuthorized, databaseUrl } from '@/server/jobs/cron-auth';
import { getJobDiagnostics, requeueJobs } from '@/server/repos/health';

export const dynamic = 'force-dynamic';

/** GET reports why jobs are failing. POST requeues them. */
export async function GET(request: Request): Promise<NextResponse> {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = databaseUrl();
  if (!url) return NextResponse.json({ error: 'database not configured' }, { status: 500 });
  return NextResponse.json(await getJobDiagnostics(url));
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = databaseUrl();
  if (!url) return NextResponse.json({ error: 'database not configured' }, { status: 500 });
  let kind: string | undefined;
  try {
    kind = ((await request.json()) as { kind?: string }).kind;
  } catch {
    /* no body: requeue every kind */
  }
  return NextResponse.json({ requeued: await requeueJobs(url, kind) });
}
