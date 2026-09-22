import { NextResponse } from 'next/server';
import { cronAuthorized, databaseUrl } from '@/server/jobs/cron-auth';
import { enqueueJobKind } from '@/server/jobs/drain';

export const dynamic = 'force-dynamic';

/**
 * Nightly: put a refresh pass on the queue.
 *
 * Enqueues rather than running inline. A full refresh is thousands of TMDB
 * calls and the job chains itself through the backlog; doing that inside one
 * cron invocation would blow the function's wall clock, which is how the
 * Wikidata walk was lost the first time.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = databaseUrl();
  if (!url) return NextResponse.json({ error: 'database not configured' }, { status: 500 });
  return NextResponse.json(await enqueueJobKind(url, 'refresh_stale', { batch: 60 }));
}
