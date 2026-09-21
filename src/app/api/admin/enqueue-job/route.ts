import { NextResponse } from 'next/server';
import { cronAuthorized, databaseUrl } from '@/server/jobs/cron-auth';
import { enqueueJobKind } from '@/server/jobs/drain';

export const dynamic = 'force-dynamic';

/**
 * Enqueue one maintenance job by kind -- derive_themes, refresh_degree,
 * housekeeping.
 *
 * This exists because production's database URL is write-only from Vercel's
 * side, so there is no local path to run a maintenance script against it. The
 * job queue is that path, and this is how work gets into it.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = databaseUrl();
  if (!url) return NextResponse.json({ error: 'database not configured' }, { status: 500 });

  let kind: string | undefined;
  let payload: Record<string, unknown> = {};
  try {
    const body = (await request.json()) as { kind?: string; payload?: Record<string, unknown> };
    kind = body.kind;
    payload = body.payload ?? {};
  } catch {
    return NextResponse.json({ error: 'expected {kind, payload?}' }, { status: 400 });
  }
  if (!kind) return NextResponse.json({ error: 'kind is required' }, { status: 400 });

  try {
    return NextResponse.json(await enqueueJobKind(url, kind, payload));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'enqueue failed' },
      { status: 400 },
    );
  }
}
