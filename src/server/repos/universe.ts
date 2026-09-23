import postgres from 'postgres';
import { pooledDatabaseUrl } from '../db/resolve-url';
import { PREDICATES, GRAPH_NODE_TYPES } from '@/lib/ontology/generated';

/**
 * Stats for the Universe hub.
 *
 * Deliberately technical in tone: this is the surface where the data work is
 * the product, and the numbers are the argument. Counts come from the graph
 * itself, never from a hardcoded figure that drifts.
 */
const resolved = pooledDatabaseUrl();
const sql = resolved
  ? postgres(resolved.url, { max: 4, prepare: false, idle_timeout: 20, onnotice: () => {} })
  : null;

function db(): ReturnType<typeof postgres> {
  if (!sql) throw new Error('universe repo: no database configured');
  return sql;
}

export interface UniverseStats {
  titles: number;
  people: number;
  edges: number;
  predicatesDeclared: number;
  predicatesInUse: number;
  nodeTypes: number;
  themes: number;
  themedPct: number;
  /** Characters resolved, shown honestly rather than hidden. */
  charactersResolvedPct: number;
  topPredicates: { predicate: string; n: number }[];
}

export async function universeStats(): Promise<UniverseStats> {
  const d = db();
  const [counts] = await d<
    {
      titles: number;
      people: number;
      edges: number;
      themes: number;
      themed_pct: number | null;
      chars_pct: number | null;
    }[]
  >`
    SELECT
      (SELECT count(*)::int FROM core.title)                                  AS titles,
      (SELECT count(*)::int FROM core.person)                                 AS people,
      (SELECT count(*)::int FROM core.credit)
        + (SELECT count(*)::int FROM core.edge)
        + (SELECT count(*)::int FROM core.edge_derived)                       AS edges,
      (SELECT count(*)::int FROM core.concept WHERE scheme = 'theme')         AS themes,
      (SELECT round(100.0 * count(*) FILTER (
          WHERE EXISTS (SELECT 1 FROM core.edge e
                        WHERE e.subject_id = t.id AND e.predicate = 'explores_theme'))
        / nullif(count(*), 0))::int FROM core.title t)                        AS themed_pct,
      (SELECT round(100.0 * count(*) FILTER (WHERE character_id IS NOT NULL)
        / nullif(count(*), 0))::int
       FROM core.credit WHERE predicate = 'acted_in')                         AS chars_pct`;

  const used = await d<{ predicate: string; n: number }[]>`
    SELECT predicate, count(*)::int AS n FROM sem.edge GROUP BY 1 ORDER BY 2 DESC`;

  return {
    titles: counts?.titles ?? 0,
    people: counts?.people ?? 0,
    edges: counts?.edges ?? 0,
    predicatesDeclared: PREDICATES.length,
    predicatesInUse: used.length,
    nodeTypes: GRAPH_NODE_TYPES.length,
    themes: counts?.themes ?? 0,
    themedPct: counts?.themed_pct ?? 0,
    charactersResolvedPct: counts?.chars_pct ?? 0,
    topPredicates: used.slice(0, 8),
  };
}

export interface PickerOption {
  type: string;
  id: string;
  slug: string;
  label: string;
  sublabel: string | null;
  imagePath: string | null;
}

/** Typeahead across every graph node type, for the Connect pickers. */
export async function searchNodes(query: string, limit = 10): Promise<PickerOption[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  return db()<PickerOption[]>`
    SELECT node_type AS type, id, slug, label, sublabel, image_path AS "imagePath"
    FROM sem.node
    WHERE label ILIKE ${'%' + q + '%'}
    ORDER BY (label ILIKE ${q + '%'}) DESC, popularity DESC NULLS LAST, label
    LIMIT ${limit}`;
}

export interface OntologyStats {
  titles: number;
  people: number;
  credits: number;
  edges: number;
  concepts: number;
  predicates: number;
}

/**
 * The corpus, counted.
 *
 * The claim the public page makes is that the ontology is enforced rather than
 * decorative, and a claim like that should be accompanied by its numbers.
 * Predicates come from the generated ontology rather than a COUNT, because the
 * declared vocabulary is the real answer to "how many relationship types are
 * there" -- one that happens to have no rows yet still exists.
 */
export async function ontologyStats(): Promise<OntologyStats> {
  const [row] = await db()<Omit<OntologyStats, 'predicates'>[]>`
    SELECT (SELECT count(*)::int FROM core.title)   AS titles,
           (SELECT count(*)::int FROM core.person)  AS people,
           (SELECT count(*)::int FROM core.credit)  AS credits,
           (SELECT count(*)::int FROM core.edge)
             + (SELECT count(*)::int FROM core.edge_derived) AS edges,
           (SELECT count(*)::int FROM core.concept) AS concepts`;
  return { ...row!, predicates: PREDICATES.length };
}

export interface FeaturedNode {
  type: string;
  id: string;
  slug: string;
  label: string;
  degree: number;
}

/**
 * The front door, chosen deliberately.
 *
 * This used to be `ORDER BY degree DESC` alone, and degree turns out to be a
 * poor proxy for "worth looking at". What it actually ranks first is anthology
 * films whose 300 cameo credits are all one-offs, long-running procedurals,
 * and studios -- production credits on a thousand films make Universal the
 * best-connected node in the corpus and the dullest possible thing to open on.
 * In production it picked a long-running anime; locally, a 1984 road movie. Neither
 * is a front door, and both were accidents of arithmetic.
 *
 * So a small ordered list of openers, resolved by slug, with the degree query
 * behind it as filler. Each entry is here for a measured reason, not a taste
 * one: Nolan's neighborhood has 79 nodes, 274 edges among them and ZERO
 * isolated nodes, across four entity types -- a director's second hop is his
 * repertory company, so it draws as a network rather than a wheel. A title's
 * second hop is its cast's other films, which is looser and leaves floaters.
 *
 * 2001 is second rather than first for the same measured reason, in the other
 * direction: 44 nodes, 14 of them isolated. A 1968 cast has little second-hop
 * overlap in this corpus, so it draws thin and dusty. It is a fine place to
 * GO and a weak place to LAND.
 *
 * Slugs carry the TMDB id (`christopher-nolan-525`), so they are stable across
 * databases. A slug that does not resolve is SKIPPED, not left as a hole, and
 * if every one of them misses, the page still opens on the best node the data
 * offers. Curation that fails closed would be worse than no curation.
 */
const OPENERS: { type: string; slug: string }[] = [
  { type: 'person', slug: 'christopher-nolan-525' },
  { type: 'title', slug: '2001-a-space-odyssey-1968' },
  { type: 'title', slug: 'the-godfather-1972' },
  { type: 'person', slug: 'denis-villeneuve-137427' },
  { type: 'title', slug: 'blade-runner-2049-2017' },
  { type: 'title', slug: 'star-wars-1977' },
  { type: 'title', slug: 'the-matrix-1999' },
  { type: 'title', slug: 'the-odyssey-2026' },
  { type: 'title', slug: 'jaws-1975' },
];

/**
 * Merge curated openers with data-ranked filler.
 *
 * Pure, and separated from the queries so the ordering rules are testable
 * without a database -- they are the part that can quietly go wrong.
 */
export function mergeFeatured(
  curated: FeaturedNode[],
  filler: FeaturedNode[],
  limit: number,
): FeaturedNode[] {
  const out: FeaturedNode[] = [];
  const seen = new Set<string>();
  for (const n of [...curated, ...filler]) {
    const key = `${n.type}:${n.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Entry points for the public landing: the curated openers, then filler.
 *
 * The filler is still degree-ranked but now excludes organizations, and is
 * capped ABOVE as well as below -- a node with thousands of connections lays
 * out as one indistinguishable blob, which is the same reason the path finder
 * bars hubs from intermediate positions.
 */
export async function featuredNodes(limit = 8): Promise<FeaturedNode[]> {
  const d = db();
  const [curatedRows, filler] = await Promise.all([
    /* unnest WITH ORDINALITY, so the curated order survives the round trip and
       the type/slug pair is matched as a PAIR. Two separate ANY() clauses
       would be a cross product, and `(type, slug) IN (...)` is a syntax error
       through this driver -- postgres.js has no tuple-list form. */
    d<FeaturedNode[]>`
      SELECT n.node_type AS type, n.id, n.slug, n.label, coalesce(dg.degree, 0) AS degree
      FROM unnest(${OPENERS.map((o) => o.type)}::text[], ${OPENERS.map((o) => o.slug)}::text[])
             WITH ORDINALITY AS o(node_type, slug, ord)
      JOIN sem.node n ON n.node_type = o.node_type AND n.slug = o.slug
      LEFT JOIN core.node_degree dg ON dg.node_type = n.node_type AND dg.node_id = n.id
      ORDER BY o.ord`,
    d<FeaturedNode[]>`
      SELECT n.node_type AS type, n.id, n.slug, n.label, dg.degree
      FROM sem.node n
      JOIN core.node_degree dg ON dg.node_type = n.node_type AND dg.node_id = n.id
      WHERE n.image_path IS NOT NULL
        AND n.node_type <> 'organization'
        AND dg.degree BETWEEN 40 AND 400
      ORDER BY dg.degree DESC
      LIMIT ${limit}`,
  ]);

  return mergeFeatured(curatedRows, filler, limit);
}

/**
 * The best-connected of a set of titles.
 *
 * Used to center the signed-in Universe on something from the reader's own
 * library, so the default view is THEIR corner of the graph rather than a
 * stranger's. Takes ids the caller already fetched under the row-level policy
 * rather than reaching into usr itself -- the personal half stays behind
 * withUser, and only the degree lookup, which is global, happens here.
 */
export async function bestConnectedAmong(
  titleIds: string[],
): Promise<{ type: string; id: string } | null> {
  if (titleIds.length === 0) return null;
  const [row] = await db()<{ type: string; id: string }[]>`
    SELECT n.node_type AS type, n.id
    FROM sem.node n
    JOIN core.node_degree dg ON dg.node_type = n.node_type AND dg.node_id = n.id
    WHERE n.node_type = 'title' AND n.id = ANY(${titleIds})
    ORDER BY dg.degree DESC
    LIMIT 1`;
  return row ?? null;
}
