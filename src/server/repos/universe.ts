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
 * Well-connected entry points, chosen from the data.
 *
 * Not a hardcoded list of slugs: the corpus grows, and a curated list would
 * quietly start pointing at whatever it pointed at in 2026. The first result
 * carries the landing page's opening view, so it has to be a node whose
 * neighborhood is worth looking at -- hence ordering by degree.
 *
 * Capped ABOVE as well as below. A node with thousands of connections lays out
 * as one indistinguishable blob, which is the same reason the path finder bars
 * hubs from intermediate positions.
 */
export async function featuredNodes(limit = 8): Promise<FeaturedNode[]> {
  return db()<FeaturedNode[]>`
    SELECT n.node_type AS type, n.id, n.slug, n.label, d.degree
    FROM sem.node n
    JOIN core.node_degree d ON d.node_type = n.node_type AND d.node_id = n.id
    WHERE n.image_path IS NOT NULL AND d.degree BETWEEN 40 AND 400
    ORDER BY d.degree DESC
    LIMIT ${limit}`;
}
