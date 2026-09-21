import { NextResponse } from 'next/server';
import { searchTitles } from '@/server/repos/titles';
import { searchProvider } from '@/server/providers/tmdb/search';
import { getAccountId } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

/**
 * Search: local corpus first, provider second.
 *
 * Local results return in single-digit milliseconds from titles we already
 * hold, so the list is never empty while the provider round trip completes.
 * Provider results merge in behind them, deduplicated by TMDB id.
 *
 * The TMDB key never leaves the server — this proxy is the only path to it.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!(await getAccountId())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json({ local: [], remote: [] });

  // Local never fails the request: if the provider is down, search still works
  // against everything already ingested.
  const local = await searchTitles(q);
  const localTmdbIds = new Set(local.map((t) => t.tmdb_id).filter(Boolean));

  let remote: Awaited<ReturnType<typeof searchProvider>> = [];
  try {
    remote = (await searchProvider(q)).filter((r) => !localTmdbIds.has(String(r.tmdbId)));
  } catch {
    // Degrade to local-only rather than erroring the search box.
  }
  return NextResponse.json({ local, remote });
}
