/**
 * TMDB image URLs.
 *
 * TMDB already serves pre-sized variants from its own CDN, so these bypass the
 * Next image optimizer entirely — see docs/adr/0012. Routing them through it
 * would burn optimization units on assets that are already optimized and
 * already on a CDN, for nothing.
 *
 * SIZE NAMES ARE NOT DERIVABLE FROM A WIDTH. Most are w<width>, but profiles
 * top out at `h632`, which is constrained by HEIGHT. Building the name by
 * prefixing "w" produced /t/p/w632/..., which TMDB answers with a 400 — so
 * every person image above 92px CSS silently rendered as a broken image: the
 * person page header, the orbit thumbnails and the path chain. Each bucket
 * therefore carries its published name alongside the width used to choose it.
 *
 * Source: TMDB /configuration. Update these lists only from that response.
 */
interface Bucket {
  /** Width used for selection. For height-constrained sizes, the effective width. */
  width: number;
  /** The exact path segment TMDB publishes. */
  name: string;
}

const POSTER: Bucket[] = [
  { width: 92, name: 'w92' },
  { width: 154, name: 'w154' },
  { width: 185, name: 'w185' },
  { width: 342, name: 'w342' },
  { width: 500, name: 'w500' },
  { width: 780, name: 'w780' },
];

// h632 is a 632px-TALL profile; at the usual 2:3 crop that is roughly 421 wide.
const PROFILE: Bucket[] = [
  { width: 45, name: 'w45' },
  { width: 185, name: 'w185' },
  { width: 421, name: 'h632' },
];

const BACKDROP: Bucket[] = [
  { width: 300, name: 'w300' },
  { width: 780, name: 'w780' },
  { width: 1280, name: 'w1280' },
];

const LOGO: Bucket[] = [
  { width: 45, name: 'w45' },
  { width: 92, name: 'w92' },
  { width: 154, name: 'w154' },
  { width: 185, name: 'w185' },
  { width: 300, name: 'w300' },
  { width: 500, name: 'w500' },
];

const STILL: Bucket[] = [
  { width: 92, name: 'w92' },
  { width: 185, name: 'w185' },
  { width: 300, name: 'w300' },
];

const BASE = 'https://image.tmdb.org/t/p';

/** Exported so a test can assert we never emit a size TMDB does not publish. */
export const TMDB_SIZES = {
  poster: POSTER.map((b) => b.name),
  profile: PROFILE.map((b) => b.name),
  backdrop: BACKDROP.map((b) => b.name),
  logo: LOGO.map((b) => b.name),
  still: STILL.map((b) => b.name),
} as const;

/** Smallest published bucket covering the rendered width at 2x. */
function pick(buckets: Bucket[], cssWidth: number): string {
  const target = cssWidth * 2;
  return (buckets.find((b) => b.width >= target) ?? buckets[buckets.length - 1]!).name;
}

function url(buckets: Bucket[], path: string | null | undefined, cssWidth: number) {
  return path ? `${BASE}/${pick(buckets, cssWidth)}${path}` : undefined;
}

export function posterUrl(path: string | null | undefined, cssWidth = 185) {
  return url(POSTER, path, cssWidth);
}

export function profileUrl(path: string | null | undefined, cssWidth = 64) {
  return url(PROFILE, path, cssWidth);
}

export function backdropUrl(path: string | null | undefined, cssWidth = 640) {
  return url(BACKDROP, path, cssWidth);
}

export function logoUrl(path: string | null | undefined, cssWidth = 92) {
  return url(LOGO, path, cssWidth);
}

export function stillUrl(path: string | null | undefined, cssWidth = 185) {
  return url(STILL, path, cssWidth);
}

/**
 * The right URL for a graph node, whose image means a different thing per type.
 *
 * An organization's image is a logo, not a poster, and the two do not publish
 * the same sizes — w342 is a valid poster and a 400 for a logo.
 */
export function nodeImageUrl(
  nodeType: string,
  path: string | null | undefined,
  cssWidth: number,
): string | undefined {
  if (nodeType === 'person') return profileUrl(path, cssWidth);
  if (nodeType === 'organization') return logoUrl(path, cssWidth);
  return posterUrl(path, cssWidth);
}
