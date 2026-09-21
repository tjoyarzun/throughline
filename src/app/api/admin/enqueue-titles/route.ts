import { NextResponse } from 'next/server';
import { cronAuthorized, databaseUrl } from '@/server/jobs/cron-auth';
import { enqueueTitles } from '@/server/jobs/drain';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request): Promise<NextResponse> {
  if (!cronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = databaseUrl();
  if (!url) return NextResponse.json({ error: 'database not configured' }, { status: 500 });

  let titles: { tmdbId: number; kind: string }[];
  try {
    const body = (await request.json()) as { titles?: { tmdbId: number; kind: string }[] };
    titles = body.titles ?? [];
  } catch {
    return NextResponse.json({ error: 'expected {titles:[{tmdbId,kind}]}' }, { status: 400 });
  }
  if (titles.length === 0 || titles.length > 2000) {
    return NextResponse.json({ error: '1..2000 titles per request' }, { status: 400 });
  }
  return NextResponse.json(await enqueueTitles(url, titles));
}
