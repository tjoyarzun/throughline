/**
 * Which core.external_id source a title's TMDB id lives under.
 *
 * TMDB numbers movies and TV in SEPARATE spaces -- movie 1402 is The Pursuit of
 * Happyness, TV 1402 is The Walking Dead -- so the bare number is not an
 * identity. Shows live under 'tmdb_tv' and movies under 'tmdb'; see
 * drizzle/migrations/0010_tmdb_tv_source.sql for why a separate source rather
 * than the `${kind}:${id}` prefix organizations use.
 *
 * Every title-side read or write of a TMDB id goes through one of these two. A
 * reader that hard-codes source = 'tmdb' for a title silently misses every show.
 */
export function tmdbSource(kind: string): 'tmdb' | 'tmdb_tv' {
  return kind === 'show' ? 'tmdb_tv' : 'tmdb';
}

/** For readers that need a title's TMDB id without knowing its kind. */
export const TMDB_TITLE_SOURCES = ['tmdb', 'tmdb_tv'] as const;
