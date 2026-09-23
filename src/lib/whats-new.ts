import { RELEASES } from '@/content/releases';

/**
 * Whether there is news the reader has not opened.
 *
 * A cookie holding the date of the newest release they have SEEN, rather than
 * a boolean "read" flag or a row in usr. Three reasons:
 *
 *   A date survives new releases. A boolean would have to be reset for every
 *   account on every deploy, which is a migration in exchange for nothing.
 *
 *   It is per device, like the theme. The person who reads the notes on their
 *   phone has read them; their laptop does not need to be told, but nothing
 *   breaks if it shows the dot once more.
 *
 *   It works signed out. Nothing here is private, and reaching into usr for a
 *   preference this small would be the wrong shape.
 */
export const SEEN_COOKIE = 'tl-seen-release';

/** The newest release date, or null when there are no releases at all. */
export const latestReleaseDate: string | null = RELEASES[0]?.date ?? null;

/**
 * ISO dates compare correctly as strings, which is the entire reason the
 * field is stored as one rather than as a Date or a version number.
 */
export function hasUnreadRelease(seen: string | undefined): boolean {
  if (!latestReleaseDate) return false;
  if (!seen) return true;
  return seen < latestReleaseDate;
}
