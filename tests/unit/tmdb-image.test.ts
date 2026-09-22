import { describe, it, expect } from 'vitest';
import {
  TMDB_SIZES,
  posterUrl,
  profileUrl,
  backdropUrl,
  logoUrl,
  stillUrl,
  nodeImageUrl,
} from '@/lib/tmdb-image';

/**
 * A size name that TMDB does not publish returns a 400, and an <img> whose src
 * 400s renders as a broken image with no error anywhere in the app. That is
 * exactly what shipped: profile sizes end at h632, constrained by HEIGHT, but
 * the name was built by prefixing "w" to the width, so every person image
 * above 92px CSS pointed at /t/p/w632/... and silently failed.
 */
const BUILDERS = [
  { name: 'poster', fn: posterUrl, sizes: TMDB_SIZES.poster },
  { name: 'profile', fn: profileUrl, sizes: TMDB_SIZES.profile },
  { name: 'backdrop', fn: backdropUrl, sizes: TMDB_SIZES.backdrop },
  { name: 'logo', fn: logoUrl, sizes: TMDB_SIZES.logo },
  { name: 'still', fn: stillUrl, sizes: TMDB_SIZES.still },
] as const;

describe('TMDB image URLs', () => {
  it.each(BUILDERS)('$name only ever emits a published size', ({ fn, sizes }) => {
    const allowed = new Set<string>(sizes);
    // Every width the app could plausibly ask for, not just the ones it does
    // today: the bug was introduced by a call site changing from 80 to 96.
    for (let w = 1; w <= 2000; w++) {
      const u = fn('/abc.jpg', w);
      expect(u, `width ${w} produced no URL`).toBeDefined();
      const size = u!.replace('https://image.tmdb.org/t/p/', '').split('/')[0]!;
      expect(allowed.has(size), `width ${w} emitted unpublished size "${size}"`).toBe(true);
    }
  });

  it('returns undefined rather than a URL to nothing', () => {
    expect(posterUrl(null)).toBeUndefined();
    expect(profileUrl(undefined)).toBeUndefined();
    expect(posterUrl('')).toBeUndefined();
  });

  it('picks the smallest bucket that covers a 2x render', () => {
    expect(posterUrl('/a.jpg', 40)).toContain('/w92/');
    // 96 CSS px at 2x needs 192, which is past w185 — so w342, not w185.
    expect(posterUrl('/a.jpg', 92)).toContain('/w185/');
    expect(posterUrl('/a.jpg', 96)).toContain('/w342/');
    expect(profileUrl('/a.jpg', 20)).toContain('/w45/');
    expect(profileUrl('/a.jpg', 80)).toContain('/w185/');
  });

  it('uses the height-constrained profile size for large avatars', () => {
    // The specific regression: 96px CSS wants ~192px, which is past w185.
    expect(profileUrl('/a.jpg', 96)).toContain('/h632/');
    expect(profileUrl('/a.jpg', 96)).not.toContain('w632');
  });

  it('treats an organization logo as a logo, not a poster', () => {
    // w342 is a valid poster size and a 400 for a logo.
    const org = nodeImageUrl('organization', '/a.png', 200);
    expect(TMDB_SIZES.logo).toContain(org!.split('/t/p/')[1]!.split('/')[0]);
    expect(nodeImageUrl('person', '/a.jpg', 96)).toContain('/h632/');
    expect(nodeImageUrl('title', '/a.jpg', 92)).toContain('/w185/');
  });
});
