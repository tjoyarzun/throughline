import { z } from 'zod';
import { TmdbClient } from './client';

/**
 * New and upcoming releases.
 *
 * These are VOLATILE RANKINGS, not facts about the world: what is "new"
 * changes daily and depends on where you are. So they are fetched and cached,
 * never written to core. Putting them in the graph would mean the ontology
 * changed shape every week, which is the same mistake as modeling streaming
 * availability as an edge. See docs/adr/0007.
 */

/** Six hours. New releases do not move faster than that, and neither should we. */
const TTL_SECONDS = 6 * 60 * 60;

const listItem = z.object({
  id: z.number(),
  title: z.string().optional(),
  name: z.string().optional(),
  release_date: z.string().optional(),
  first_air_date: z.string().optional(),
  poster_path: z.string().nullish(),
  popularity: z.number().nullish(),
  vote_count: z.number().nullish(),
});
const listResponse = z.object({ results: z.array(listItem).default([]) });

export interface DiscoveryItem {
  tmdbId: number;
  kind: 'movie' | 'show';
  title: string;
  /** ISO date; may be in the future for upcoming items. */
  date: string | null;
  posterPath: string | null;
  popularity: number;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchList(
  client: TmdbClient,
  path: '/discover/movie' | '/discover/tv',
  params: Record<string, string>,
): Promise<DiscoveryItem[]> {
  const raw = await client.discoverCached(path, params, TTL_SECONDS);
  const parsed = listResponse.safeParse(raw);
  if (!parsed.success) return [];
  const kind = path === '/discover/movie' ? 'movie' : 'show';
  return parsed.data.results
    .map((r) => ({
      tmdbId: r.id,
      kind: kind as 'movie' | 'show',
      title: r.title ?? r.name ?? '',
      date: r.release_date || r.first_air_date || null,
      posterPath: r.poster_path ?? null,
      popularity: r.popularity ?? 0,
    }))
    .filter((r) => r.title && r.posterPath);
}

/**
 * Released in the last ninety days, most popular first.
 *
 * Discover rather than /movie/now_playing: now_playing is theatrical and
 * region-dependent, and the question here is "what is new to watch", which
 * includes everything that has just landed at home.
 */
export async function newReleases(limit = 12): Promise<DiscoveryItem[]> {
  const client = new TmdbClient();
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - 90);

  const [movies, shows] = await Promise.all([
    fetchList(client, '/discover/movie', {
      'primary_release_date.gte': iso(from),
      'primary_release_date.lte': iso(today),
      sort_by: 'popularity.desc',
      // Without a vote floor the list fills with things nobody has seen.
      'vote_count.gte': '25',
    }),
    fetchList(client, '/discover/tv', {
      'first_air_date.gte': iso(from),
      'first_air_date.lte': iso(today),
      sort_by: 'popularity.desc',
      'vote_count.gte': '15',
    }),
  ]);

  return [...movies, ...shows].sort((a, b) => b.popularity - a.popularity).slice(0, limit);
}

/**
 * Not out yet, soonest first.
 *
 * Ordered by DATE, not popularity: the useful question is what arrives next,
 * and a blockbuster eighteen months away is not an answer to it. Upcoming
 * titles have few or no votes, so no vote floor is possible or wanted.
 */
export async function upcoming(limit = 12): Promise<DiscoveryItem[]> {
  const client = new TmdbClient();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 365);

  const [movies, shows] = await Promise.all([
    fetchList(client, '/discover/movie', {
      'primary_release_date.gte': iso(tomorrow),
      'primary_release_date.lte': iso(horizon),
      sort_by: 'popularity.desc',
    }),
    fetchList(client, '/discover/tv', {
      'first_air_date.gte': iso(tomorrow),
      'first_air_date.lte': iso(horizon),
      sort_by: 'popularity.desc',
    }),
  ]);

  return [...movies, ...shows]
    .filter((r) => r.date)
    .sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : b.popularity - a.popularity))
    .slice(0, limit);
}
