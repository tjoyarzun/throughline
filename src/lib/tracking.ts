/**
 * The vocabularies of the personal layer.
 *
 * These arrays are the SINGLE SOURCE for both the TypeScript unions and the
 * database CHECK constraints -- drizzle/schema/usr.ts builds its checks from
 * them. A vocabulary that lives only in a comment is not enforced, and every
 * one of these columns was plain `text` with the allowed values written in a
 * comment above it, so the database would happily have stored a status with a
 * typo in it and every query filtering on the real value would quietly miss it.
 */

/** The standing relationship with a work. See docs/data-model.md. */
export const STATUSES = ['watchlist', 'watching', 'watched', 'abandoned'] as const;
export type Status = (typeof STATUSES)[number];

/**
 * What a state_event records.
 *
 * Favoriting is in the same log as status changes, because the log answers
 * "what did I do to this title, and when" -- splitting it would mean merging
 * two tables to ask that. Favorite is still NOT a status (docs/adr/0005).
 */
export const EVENT_KINDS = ['status_change', 'favorited', 'unfavorited'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** What caused a state_event. Auto-transitions must stay distinguishable. */
export const EVENT_SOURCES = [
  'manual',
  'auto_from_viewing',
  'auto_from_episode',
  'import',
] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/**
 * How precisely a viewing date is known.
 *
 * 'unknown' is what keeps "I have seen this, no idea when" out of the
 * time-series metrics instead of silently landing on today.
 */
export const DATE_PRECISIONS = ['exact', 'day', 'month', 'year', 'unknown'] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

/** Where it was watched. Nullable: this is an optional detail, never required. */
export const MEDIUMS = ['theater', 'streaming', 'physical', 'tv', 'flight'] as const;
export type Medium = (typeof MEDIUMS)[number];

/** Half-stars are stored as 1..10 and displayed as 0.5..5.0. */
export const RATING_MIN = 1;
export const RATING_MAX = 10;

/** 4.5 -> 9. Throws rather than rounding silently. */
export function starsToValue(stars: number): number {
  const v = Math.round(stars * 2);
  if (v < RATING_MIN || v > RATING_MAX) throw new Error(`rating out of range: ${stars}`);
  return v;
}

/** 9 -> 4.5 */
export function valueToStars(value: number): number {
  return value / 2;
}

/** Renders a SQL IN-list for a CHECK constraint from a vocabulary. */
export function sqlInList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(', ');
}
