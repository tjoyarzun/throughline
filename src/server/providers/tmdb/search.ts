import { z } from 'zod';

/**
 * Provider search. Deliberately NOT the full TmdbClient: search is a hot,
 * cheap, cacheable read that must not share a circuit breaker with ingest,
 * and it never writes to raw — a search result is not a fact about a film.
 */
const multiResult = z.object({
  id: z.number(),
  media_type: z.string().optional(),
  title: z.string().optional(),
  name: z.string().optional(),
  release_date: z.string().optional(),
  first_air_date: z.string().optional(),
  poster_path: z.string().nullish(),
  popularity: z.number().nullish(),
  overview: z.string().nullish(),
});
const multiResponse = z.object({ results: z.array(multiResult).default([]) });

export interface ProviderResult {
  tmdbId: number;
  kind: 'movie' | 'show';
  title: string;
  year: number | null;
  posterPath: string | null;
  popularity: number;
}

export async function searchProvider(query: string): Promise<ProviderResult[]> {
  const token = process.env.TMDB_READ_ACCESS_TOKEN;
  if (!token) return [];

  const url = new URL('https://api.themoviedb.org/3/search/multi');
  url.searchParams.set('query', query);
  url.searchParams.set('include_adult', 'false');

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
    // Identical queries are common while typing; 5 minutes is plenty and keeps
    // us far below the rate limit.
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`TMDB search ${res.status}`);

  const parsed = multiResponse.safeParse(await res.json());
  if (!parsed.success) return [];

  return parsed.data.results
    .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
    .map((r) => {
      const date = r.release_date || r.first_air_date || '';
      return {
        tmdbId: r.id,
        kind: r.media_type === 'tv' ? ('show' as const) : ('movie' as const),
        title: r.title ?? r.name ?? 'Untitled',
        year: date.length >= 4 ? Number(date.slice(0, 4)) : null,
        posterPath: r.poster_path ?? null,
        popularity: r.popularity ?? 0,
      };
    })
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 12);
}
