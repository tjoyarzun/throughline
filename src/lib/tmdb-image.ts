/**
 * TMDB image URLs.
 *
 * TMDB already serves pre-sized variants from its own CDN, so these bypass the
 * Next image optimizer entirely — see docs/adr/0012. Routing them through it
 * would burn optimization units on assets that are already optimized and
 * already on a CDN, for nothing.
 *
 * Pick the smallest bucket that covers the rendered width at 2x.
 */
const POSTER_BUCKETS = [92, 154, 185, 342, 500, 780] as const;
const PROFILE_BUCKETS = [45, 185, 632] as const;
const BACKDROP_BUCKETS = [300, 780, 1280] as const;

const BASE = 'https://image.tmdb.org/t/p';

function pick(buckets: readonly number[], cssWidth: number): string {
  const target = cssWidth * 2; // assume a 2x display; the cost of one size up is small
  return `w${buckets.find((b) => b >= target) ?? buckets[buckets.length - 1]}`;
}

export function posterUrl(path: string | null | undefined, cssWidth = 185): string | undefined {
  return path ? `${BASE}/${pick(POSTER_BUCKETS, cssWidth)}${path}` : undefined;
}

export function profileUrl(path: string | null | undefined, cssWidth = 64): string | undefined {
  return path ? `${BASE}/${pick(PROFILE_BUCKETS, cssWidth)}${path}` : undefined;
}

export function backdropUrl(path: string | null | undefined, cssWidth = 640): string | undefined {
  return path ? `${BASE}/${pick(BACKDROP_BUCKETS, cssWidth)}${path}` : undefined;
}
