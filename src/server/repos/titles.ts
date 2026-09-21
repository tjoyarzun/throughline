import postgres from 'postgres';
import { pooledDatabaseUrl } from '../db/resolve-url';
import { normalizeTitle } from '../ingest/normalize';

/**
 * Title reads. Queries sem.* only — never core, never raw.
 *
 * One module-level client: postgres.js pools internally, and a new pool per
 * request exhausts Neon's connection budget under any real traffic.
 */
const resolved = pooledDatabaseUrl();
const sql = resolved
  ? postgres(resolved.url, { max: 8, prepare: false, idle_timeout: 20, onnotice: () => {} })
  : null;

function db(): ReturnType<typeof postgres> {
  if (!sql) throw new Error('titles repo: no database configured');
  return sql;
}

export interface TitleSummary {
  id: string;
  /** Needed so provider results can be deduplicated against what we hold. */
  tmdb_id: string | null;
  slug: string;
  kind: string;
  title: string;
  release_year: number | null;
  poster_path: string | null;
  popularity: string | null;
  genres: string[];
}

export interface TitleFull extends TitleSummary {
  original_title: string | null;
  release_date: string | null;
  runtime_minutes: number | null;
  overview: string | null;
  backdrop_path: string | null;
  accent_color: string | null;
  vote_average: string | null;
  certification: string | null;
  themes: string[];
  primary_director: string | null;
  franchise: string | null;
  cast_members: {
    person_id: string;
    person_slug: string;
    person_name: string;
    profile_path: string | null;
    character_name: string | null;
  }[];
  crew: { person_slug: string; person_name: string; job: string; predicate: string }[];
  based_on: { slug: string; title: string; kind: string; author: string | null }[];
  franchises: { id: string; slug: string; name: string }[];
}

/**
 * Local search. Returns instantly from the corpus we already hold, so results
 * appear before the provider round trip completes; TMDB results merge in
 * afterwards. See docs/performance-log.md, bottleneck 3.
 *
 * Ranked by trigram similarity on the normalized title, then popularity — not
 * popularity alone, or "The Matrix" returns whatever is trending.
 */
export async function searchTitles(query: string, limit = 12): Promise<TitleSummary[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const normalized = normalizeTitle(q);
  return db()<TitleSummary[]>`
    SELECT t.id, t.slug, t.kind, t.title, t.release_year, t.poster_path,
           t.popularity::text, t.genres, t.tmdb_id
    FROM sem.title t
    WHERE t.sort_title % ${normalized} OR t.title ILIKE ${'%' + q + '%'}
    ORDER BY similarity(t.sort_title, ${normalized}) DESC, t.popularity DESC NULLS LAST
    LIMIT ${limit}`;
}

export async function getTitleBySlug(slug: string): Promise<TitleFull | null> {
  const rows = await db()<TitleFull[]>`SELECT * FROM sem.title_full WHERE slug = ${slug}`;
  return rows[0] ?? null;
}

export async function getTitleByTmdbId(tmdbId: number, kind: string): Promise<TitleFull | null> {
  const rows = await db()<TitleFull[]>`
    SELECT f.* FROM sem.title_full f
    WHERE f.tmdb_id = ${String(tmdbId)} AND f.kind = ${kind}`;
  return rows[0] ?? null;
}

/** Trending, for the empty search state — something to show before typing. */
export async function popularTitles(limit = 18): Promise<TitleSummary[]> {
  return db()<TitleSummary[]>`
    SELECT id, slug, kind, title, release_year, poster_path, popularity::text, genres, NULL AS tmdb_id
    FROM sem.title
    WHERE poster_path IS NOT NULL
    ORDER BY popularity DESC NULLS LAST
    LIMIT ${limit}`;
}

export interface PersonDetail {
  id: string;
  slug: string;
  name: string;
  biography: string | null;
  profile_path: string | null;
  known_for_department: string | null;
  birthday: string | null;
  deathday: string | null;
  place_of_birth: string | null;
  role_summary: Record<string, number>;
}

export async function getPersonBySlug(slug: string): Promise<PersonDetail | null> {
  const rows = await db()<PersonDetail[]>`SELECT * FROM sem.person WHERE slug = ${slug}`;
  return rows[0] ?? null;
}

/**
 * Filmography GROUPED BY ROLE.
 *
 * This grouping is the roles-not-entities decision made visible: one person,
 * several ways of participating, rather than an Actor and a Director who
 * happen to share a name. See docs/adr/0002.
 */
export async function getFilmography(
  personId: string,
): Promise<{ predicate: string; titles: TitleSummary[] }[]> {
  const rows = await db()<(TitleSummary & { predicate: string; character_name: string | null })[]>`
    SELECT DISTINCT ON (c.predicate, t.id)
           c.predicate, c.character_name,
           t.id, t.slug, t.kind, t.title, t.release_year, t.poster_path,
           t.popularity::text, t.genres, NULL AS tmdb_id
    FROM sem.title_credit c
    JOIN sem.title t ON t.id = c.title_id
    WHERE c.person_id = ${personId}
    ORDER BY c.predicate, t.id, t.release_year DESC NULLS LAST`;

  const order = ['directed', 'wrote', 'acted_in', 'composed_for', 'shot'];
  const grouped = new Map<string, TitleSummary[]>();
  for (const r of rows) {
    if (!grouped.has(r.predicate)) grouped.set(r.predicate, []);
    grouped.get(r.predicate)!.push(r);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => (b.release_year ?? 0) - (a.release_year ?? 0));
  }
  return [...grouped.entries()]
    .sort((a, b) => (order.indexOf(a[0]) + 99) % 99 || 0 - ((order.indexOf(b[0]) + 99) % 99))
    .map(([predicate, titles]) => ({ predicate, titles }));
}
