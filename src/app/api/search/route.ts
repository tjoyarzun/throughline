import { NextResponse } from 'next/server';
import { searchTitles, searchPeople } from '@/server/repos/titles';
import { searchProvider } from '@/server/providers/tmdb/search';
import { getAccountId } from '@/server/auth/session';
import { rateLimit } from '@/server/rate-limit';

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
  const accountId = await getAccountId();
  if (!accountId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json({ local: [], remote: [] });

  /**
   * Bounded by account, not by IP: a household behind one address should not
   * share a budget, and every caller here is authenticated anyway.
   *
   * 30/min is generous against a 250ms debounce -- roughly a person typing
   * continuously for half a minute -- so it should never be felt. It exists
   * because this endpoint spends someone else's quota: TMDB's. Counted after
   * the 2-character floor so backspacing to one character is free.
   */
  const gate = await rateLimit(`search:${accountId}`, 30, 60);
  if (!gate.allowed) {
    return NextResponse.json(
      { local: [], remote: [], throttled: true },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
    );
  }

  // Local never fails the request: if the provider is down, search still works
  // against everything already ingested.
  const [local, people] = await Promise.all([searchTitles(q), searchPeople(q)]);
  const localTmdbIds = new Set(local.map((t) => t.tmdb_id).filter(Boolean));

  let remote: Awaited<ReturnType<typeof searchProvider>> = [];
  try {
    remote = (await searchProvider(q)).filter((r) => !localTmdbIds.has(String(r.tmdbId)));
  } catch {
    // Degrade to local-only rather than erroring the search box.
  }

  /* People come from the corpus only, deliberately.
     TMDB's multi-search returns people we do not hold, and surfacing them
     would promise a page we cannot fill: a person enters core through a
     CREDIT, so someone with no credits on any of our titles has an empty
     filmography and nothing else to show. 58,714 people are already in the
     corpus, drawn from the credits of every title we hold, so anyone worth
     searching for is almost certainly among them. */
  return NextResponse.json({ local, remote, people });
}
