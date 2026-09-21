/**
 * Title and name normalization for entity-resolution blocking.
 *
 * MUST stay identical to core.normalize_title() in drizzle/sql/00-bootstrap.sql.
 * A test asserts both implementations agree on a shared fixture set — if they
 * drift, blocking keys computed in TypeScript stop matching the ones stored in
 * Postgres and entity resolution silently starts creating duplicates.
 */

const LEADING_ARTICLE = /^(the|a|an|le|la|les|el|der|die|das)\s+/;
const TRAILING_YEAR = /\s*\(\d{4}\)\s*$/;

/** Strip diacritics the way Postgres unaccent does. */
export function stripDiacritics(input: string): string {
  return input.normalize('NFKD').replace(/[̀-ͯ]/g, '');
}

/**
 * `"The Matrix (1999)"` -> `matrix`
 * `"L'Étranger"`        -> `letranger`
 * `"WALL·E"`            -> `walle`
 */
export function normalizeTitle(input: string | null | undefined): string {
  return stripDiacritics(input ?? '')
    .toLowerCase()
    .replace(TRAILING_YEAR, '')
    .replace(LEADING_ARTICLE, '')
    .replace(/[^a-z0-9]+/g, '');
}

/** Person names keep word boundaries: "Denis Villeneuve" -> "denis villeneuve". */
export function normalizePersonName(input: string | null | undefined): string {
  return stripDiacritics(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Sort key: surname first where a surname is inferable. Deliberately naive —
 * it is a display and browse aid, never an identity key.
 */
export function personSortName(input: string): string {
  const n = normalizePersonName(input);
  const parts = n.split(' ');
  if (parts.length < 2) return n;
  const last = parts[parts.length - 1]!;
  return `${last} ${parts.slice(0, -1).join(' ')}`;
}

/** URL slug. Not an identity key either — `core.external_id` is. */
export function slugify(input: string, suffix?: string | number): string {
  const base = stripDiacritics(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const safe = base || 'untitled';
  return suffix === undefined || suffix === null || suffix === '' ? safe : `${safe}-${suffix}`;
}

/** Trigram similarity, matching pg_trgm's definition closely enough for pre-filtering. */
export function trigramSimilarity(a: string, b: string): number {
  const grams = (s: string): Set<string> => {
    const padded = `  ${s} `;
    const out = new Set<string>();
    for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
    return out;
  };
  if (a === b) return 1;
  if (!a || !b) return 0;
  const ga = grams(a);
  const gb = grams(b);
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;
  return shared / (ga.size + gb.size - shared);
}
