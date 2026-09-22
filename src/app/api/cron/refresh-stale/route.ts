import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { cronAuthorized, databaseUrl } from '@/server/jobs/cron-auth';
import { drainQueue, enqueueJobKind } from '@/server/jobs/drain';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Nightly: refresh the stalest titles from TMDB.
 *
 * Enqueues AND THEN DRAINS, in that order, in this invocation.
 *
 * Enqueueing alone was wrong. The drain cron runs once a day at 04:00, so a
 * job placed on the queue at 03:00 is only processed if those two fire in
 * that order -- and Hobby cron timing is approximate. The first night this
 * ran, the job sat for nine and a half hours and the health endpoint reported
 * "job queue stalled" the entire morning, because the stall threshold is
 * fifteen minutes and the next drain was twenty hours away.
 *
 * The queue is still the right home for the work: refresh_stale chains itself
 * through the backlog, and the chain survives this function timing out. What
 * changes is that nobody has to wait a day for the first link.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = databaseUrl();
  if (!url) return NextResponse.json({ error: 'database not configured' }, { status: 500 });

  const enqueued = await enqueueJobKind(url, 'refresh_stale', { batch: 60 });

  /* Availability rides this cron rather than getting its own.
     Hobby caps how many schedules exist, and the two belong together anyway:
     both refresh facts about titles from TMDB, both chain through a backlog,
     and both want the drain that happens below. A separate schedule would buy
     independent timing we do not need and spend one of a small budget. */
  const availability = await enqueueJobKind(url, 'refresh_availability', { batch: 30 });

  // after() so the cron response returns immediately; the drain keeps working
  // in the same invocation. A failure here is not a failed cron -- the job is
  // on the queue either way and tomorrow's drain is the backstop.
  after(async () => {
    try {
      await drainQueue(url, { budgetMs: 40_000 });
    } catch {
      /* the queue keeps the work */
    }
  });

  return NextResponse.json({ ...enqueued, availability });
}
