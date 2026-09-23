import postgres from 'postgres';
import { pooledDatabaseUrl } from '@/server/db/resolve-url';
import { PATH_RANKING, PREDICATE_SPECS, type Predicate } from '@/lib/ontology/generated';
import type { GraphEngine, GraphNode, GraphPath, NeighborGroup, NodeRef, PathStep } from './types';

/**
 * Postgres-backed traversal.
 *
 * Path finding uses EXPLICIT fixed-depth joins against sem.edge_bidirectional,
 * not a recursive CTE. Fixed joins let the planner use the covering index, are
 * far easier to EXPLAIN, and make the depth bound structural rather than a
 * termination condition someone has to get right. See docs/adr/0010.
 */

const resolved = pooledDatabaseUrl();
const sql = resolved
  ? postgres(resolved.url, { max: 6, prepare: false, idle_timeout: 20, onnotice: () => {} })
  : null;

function db(): ReturnType<typeof postgres> {
  if (!sql) throw new Error('graph engine: no database configured');
  return sql;
}

interface NodeRow {
  node_type: string;
  id: string;
  slug: string;
  label: string;
  sublabel: string | null;
  image_path: string | null;
  degree: number | null;
}

function toNode(r: NodeRow): GraphNode {
  return {
    type: r.node_type,
    id: r.id,
    slug: r.slug,
    label: r.label,
    sublabel: r.sublabel,
    imagePath: r.image_path,
    degree: r.degree ?? 0,
  };
}

export class PostgresGraphEngine implements GraphEngine {
  async node(ref: NodeRef): Promise<GraphNode | null> {
    const rows = await db()<NodeRow[]>`
      SELECT n.*, d.degree
      FROM sem.node n
      LEFT JOIN core.node_degree d ON d.node_type = n.node_type AND d.node_id = n.id
      WHERE n.node_type = ${ref.type} AND n.id = ${ref.id}`;
    return rows[0] ? toNode(rows[0]) : null;
  }

  /** Resolve a node by its slug, so URLs can be human-readable. */
  async nodeBySlug(type: string, slug: string): Promise<GraphNode | null> {
    const rows = await db()<NodeRow[]>`
      SELECT n.*, d.degree
      FROM sem.node n
      LEFT JOIN core.node_degree d ON d.node_type = n.node_type AND d.node_id = n.id
      WHERE n.node_type = ${type} AND n.slug = ${slug}`;
    return rows[0] ? toNode(rows[0]) : null;
  }

  /**
   * Neighbors, grouped by predicate, for Focus mode.
   *
   * Capped per group and ranked by edge weight then popularity: a person with
   * 400 credits must not render 400 nodes, and the 32 shown should be the ones
   * worth showing. The remainder is reported as a count rather than dropped
   * silently.
   */
  async neighbors(
    ref: NodeRef,
    opts: { perGroup?: number; groups?: number } = {},
  ): Promise<NeighborGroup[]> {
    const perGroup = opts.perGroup ?? 8;
    const rows = await db()<
      (NodeRow & { predicate: string; predicate_label: string; total: number; rn: number })[]
    >`
      WITH nbr AS (
        SELECT e.predicate, e.predicate_label, e.path_weight,
               n.node_type, n.id, n.slug, n.label, n.sublabel, n.image_path,
               d.degree,
               row_number() OVER (
                 PARTITION BY e.predicate
                 ORDER BY e.path_weight ASC, n.popularity DESC NULLS LAST, n.label
               ) AS rn,
               count(*) OVER (PARTITION BY e.predicate)::int AS total
        FROM sem.edge_bidirectional e
        JOIN sem.node n ON n.node_type = e.object_type AND n.id = e.object_id
        LEFT JOIN core.node_degree d ON d.node_type = n.node_type AND d.node_id = n.id
        WHERE e.subject_type = ${ref.type} AND e.subject_id = ${ref.id}
      )
      SELECT * FROM nbr WHERE rn <= ${perGroup}
      ORDER BY path_weight ASC, predicate, rn`;

    const groups = new Map<string, NeighborGroup>();
    for (const r of rows) {
      let g = groups.get(r.predicate);
      if (!g) {
        g = { predicate: r.predicate, label: r.predicate_label, nodes: [], more: 0 };
        groups.set(r.predicate, g);
      }
      g.nodes.push(toNode(r));
      g.more = Math.max(0, r.total - Math.min(r.total, perGroup));
    }
    const all = [...groups.values()];
    return opts.groups ? all.slice(0, opts.groups) : all;
  }

  /**
   * Why are these two things connected?
   *
   * The shortest path between almost any two films is length 2 through a hub --
   * both are Drama, both were distributed by Warner Bros. Those paths are TRUE
   * and USELESS, which is why this is a ranking problem rather than a search
   * problem. Three mechanisms do the work:
   *
   *   1. predicate weights from the ontology (a shared director beats a shared
   *      genre by 4.5x before anything else is considered);
   *   2. a hub penalty, so a node with 2,000 neighbors costs more to pass
   *      through than one with 6, and anything above hubDegreeBan is barred
   *      from intermediate positions outright;
   *   3. diversity filtering, because three paths through the same director
   *      is one insight printed three times.
   */
  async findPaths(a: NodeRef, b: NodeRef, opts: { limit?: number } = {}): Promise<GraphPath[]> {
    const limit = opts.limit ?? PATH_RANKING.maxPathsReturned;
    const { hubDegreeBan, hubPenaltyCoefficient } = PATH_RANKING;

    const rows = await db()<
      {
        len: number;
        cost_num: number;
        cost_text: string;
        rarity: string;
        p1: string;
        l1: string;
        inv1: boolean;
        m1_type: string | null;
        m1_id: string | null;
        p2: string | null;
        l2: string | null;
        inv2: boolean | null;
        m2_type: string | null;
        m2_id: string | null;
        p3: string | null;
        l3: string | null;
        inv3: boolean | null;
      }[]
    >`
      WITH
      -- Cost of stepping ONTO a node, given the edge used to get there.
      -- Genre edges are dropped ENTIRELY rather than only from intermediate
      -- slots: in a two-hop path both edges touch the intermediate, so there
      -- is no position where "both are Drama" is worth saying.
      --
      -- The endpoint filters are pushed INTO each frontier rather than applied
      -- to one big eligible-edge CTE. Materializing every edge first and
      -- filtering after meant scanning the whole graph to answer a question
      -- about two nodes -- p95 406ms against a 150ms budget.
      out1 AS (
        SELECT eb.subject_type, eb.subject_id, eb.predicate, eb.predicate_label,
               eb.canonical_predicate, eb.is_inverse,
               eb.object_type, eb.object_id,
               COALESCE(d.degree, 0) AS object_degree,
               eb.path_weight * (1 + ${hubPenaltyCoefficient} * ln(1 + COALESCE(d.degree, 0)))
                 / GREATEST(COALESCE(eb.confidence, 1.0), 0.1) AS cost
        FROM sem.edge_bidirectional eb
        LEFT JOIN core.node_degree d
          ON d.node_type = eb.object_type AND d.node_id = eb.object_id
        WHERE eb.subject_type = ${a.type} AND eb.subject_id = ${a.id}
          AND NOT eb.excluded_from_path_intermediates
      ),
      in1 AS (
        SELECT eb.subject_type, eb.subject_id, eb.predicate, eb.predicate_label,
               eb.canonical_predicate, eb.is_inverse,
               eb.object_type, eb.object_id,
               COALESCE(d.degree, 0) AS object_degree,
               eb.path_weight * (1 + ${hubPenaltyCoefficient} * ln(1 + COALESCE(d.degree, 0)))
                 / GREATEST(COALESCE(eb.confidence, 1.0), 0.1) AS cost
        FROM sem.edge_bidirectional eb
        LEFT JOIN core.node_degree d
          ON d.node_type = eb.object_type AND d.node_id = eb.object_id
        WHERE eb.object_type = ${b.type} AND eb.object_id = ${b.id}
          AND NOT eb.excluded_from_path_intermediates
      ),

      -- length 2: A -> m -> B
      p2 AS (
        SELECT 2 AS len,
               (o.cost + i.cost) AS cost,
               o.canonical_predicate AS p1, o.predicate_label AS l1, o.is_inverse AS inv1,
               o.object_type AS m1_type, o.object_id AS m1_id,
               i.canonical_predicate AS p2, i.predicate_label AS l2, i.is_inverse AS inv2,
               NULL::text AS m2_type, NULL::uuid AS m2_id,
               NULL::text AS p3, NULL::text AS l3, NULL::boolean AS inv3,
               o.object_degree AS deg1, 0 AS deg2
        FROM out1 o
        JOIN in1 i ON i.subject_type = o.object_type AND i.subject_id = o.object_id
        WHERE o.object_degree <= ${hubDegreeBan}
          AND NOT (o.object_type = ${b.type} AND o.object_id = ${b.id})
      ),

      -- The middle frontier expands only from A's surviving neighbors, so the
      -- scan stays proportional to the neighborhood rather than the corpus.
      mid AS (
        SELECT eb.subject_type, eb.subject_id, eb.predicate, eb.predicate_label,
               eb.canonical_predicate, eb.is_inverse,
               eb.object_type, eb.object_id,
               COALESCE(d.degree, 0) AS object_degree,
               eb.path_weight * (1 + ${hubPenaltyCoefficient} * ln(1 + COALESCE(d.degree, 0)))
                 / GREATEST(COALESCE(eb.confidence, 1.0), 0.1) AS cost
        FROM sem.edge_bidirectional eb
        JOIN (
          SELECT DISTINCT object_type, object_id FROM out1
          WHERE object_degree <= ${hubDegreeBan}
        ) f ON f.object_type = eb.subject_type AND f.object_id = eb.subject_id
        LEFT JOIN core.node_degree d
          ON d.node_type = eb.object_type AND d.node_id = eb.object_id
        WHERE NOT eb.excluded_from_path_intermediates
      ),

      -- length 3: A -> m1 -> m2 -> B
      p3 AS (
        SELECT 3 AS len,
               (o.cost + m.cost + i.cost) AS cost,
               o.canonical_predicate AS p1, o.predicate_label AS l1, o.is_inverse AS inv1,
               o.object_type AS m1_type, o.object_id AS m1_id,
               m.canonical_predicate AS p2, m.predicate_label AS l2, m.is_inverse AS inv2,
               m.object_type AS m2_type, m.object_id AS m2_id,
               i.canonical_predicate AS p3, i.predicate_label AS l3, i.is_inverse AS inv3,
               o.object_degree AS deg1, m.object_degree AS deg2
        FROM out1 o
        JOIN mid m ON m.subject_type = o.object_type AND m.subject_id = o.object_id
        JOIN in1 i ON i.subject_type = m.object_type AND i.subject_id = m.object_id
        WHERE o.object_degree <= ${hubDegreeBan}
          AND m.object_degree <= ${hubDegreeBan}
          AND NOT (o.object_type = ${b.type} AND o.object_id = ${b.id})
          AND NOT (m.object_type = ${a.type} AND m.object_id = ${a.id})
          AND NOT (m.object_type = ${b.type} AND m.object_id = ${b.id})
          AND NOT (o.object_type = m.object_type AND o.object_id = m.object_id)
      ),
      all_paths AS (SELECT * FROM p2 UNION ALL SELECT * FROM p3)

      -- cost_text, NOT cost::text.
      --
      -- A cost::text with no alias names the OUTPUT column cost, and ORDER BY
      -- resolves output names before input ones -- so the sort became
      -- lexicographic and "16.50" ranked ahead of "5.92". Every cheap path
      -- fell past the LIMIT, and the engine confidently returned a three-hop
      -- detour while the obvious two-hop answer sat unreturned. It looked like
      -- a ranking flaw, not a sort bug.
      SELECT len, cost AS cost_num, cost::text AS cost_text,
             -- Interestingness: rare intermediates and crossing entity types
             -- are what make a connection feel like a discovery rather than a
             -- technicality.
             (1.0 / (1 + ln(1 + deg1 + deg2)))::text AS rarity,
             p1, l1, inv1, m1_type, m1_id::text, p2, l2, inv2,
             m2_type, m2_id::text, p3, l3, inv3
      FROM all_paths
      ORDER BY cost_num ASC
      LIMIT 60`;

    if (rows.length === 0) return [];

    // Hydrate every node referenced, in one round trip rather than per path.
    const refs = new Map<string, NodeRef>();
    refs.set(`${a.type}:${a.id}`, a);
    refs.set(`${b.type}:${b.id}`, b);
    for (const r of rows) {
      if (r.m1_type && r.m1_id)
        refs.set(`${r.m1_type}:${r.m1_id}`, { type: r.m1_type, id: r.m1_id });
      if (r.m2_type && r.m2_id)
        refs.set(`${r.m2_type}:${r.m2_id}`, { type: r.m2_type, id: r.m2_id });
    }
    const nodes = await this.hydrate([...refs.values()]);
    const at = (t: string | null, i: string | null): GraphNode | null =>
      t && i ? (nodes.get(`${t}:${i}`) ?? null) : null;

    const from = nodes.get(`${a.type}:${a.id}`);
    const to = nodes.get(`${b.type}:${b.id}`);
    if (!from || !to) return [];

    const candidates: GraphPath[] = [];
    for (const r of rows) {
      const steps: PathStep[] = [];
      const m1 = at(r.m1_type, r.m1_id);
      const m2 = at(r.m2_type, r.m2_id);
      if (!m1) continue;
      steps.push({
        predicate: r.p1,
        canonical: r.p1,
        isInverse: r.inv1,
        predicateLabel: r.l1,
        node: m1,
      });
      if (r.len === 3) {
        if (!m2) continue;
        steps.push({
          predicate: r.p2!,
          canonical: r.p2!,
          isInverse: r.inv2 ?? false,
          predicateLabel: r.l2!,
          node: m2,
        });
        steps.push({
          predicate: r.p3!,
          canonical: r.p3!,
          isInverse: r.inv3 ?? false,
          predicateLabel: r.l3!,
          node: to,
        });
      } else {
        steps.push({
          predicate: r.p2!,
          canonical: r.p2!,
          isInverse: r.inv2 ?? false,
          predicateLabel: r.l2!,
          node: to,
        });
      }
      candidates.push({
        from,
        steps,
        cost: Number(r.cost_text),
        interestingness: Number(r.rarity),
        narration: narrate(from, steps),
      });
    }

    return diversify(candidates, limit);
  }

  private async hydrate(refs: NodeRef[]): Promise<Map<string, GraphNode>> {
    if (refs.length === 0) return new Map();
    const types = refs.map((r) => r.type);
    const ids = refs.map((r) => r.id);
    const rows = await db()<NodeRow[]>`
      SELECT n.*, d.degree
      FROM sem.node n
      LEFT JOIN core.node_degree d ON d.node_type = n.node_type AND d.node_id = n.id
      JOIN unnest(${types}::text[], ${ids}::uuid[]) AS w(t, i)
        ON w.t = n.node_type AND w.i = n.id`;
    return new Map(rows.map((r) => [`${r.node_type}:${r.id}`, toNode(r)]));
  }
}

/**
 * Compose a path into a sentence, left to right.
 *
 * No model is involved. The fragments come from the ontology's narration
 * templates, which is the entire point: the explanation is generated from the
 * same definition the database enforces, so a predicate cannot be added
 * without also saying how to read it aloud.
 *
 * Each step carries the CANONICAL predicate plus whether it was traversed
 * backwards, because that is what selects between the two templates. Using
 * the bare label instead produced "which similar to Get Out".
 */
export function narrate(from: GraphNode, steps: PathStep[]): string {
  const parts: string[] = [];
  steps.forEach((s, i) => {
    const spec = PREDICATE_SPECS[s.canonical as Predicate];
    const template = s.isInverse
      ? (spec?.narrationInverse ?? spec?.narration)
      : (spec?.narration ?? spec?.narrationInverse);

    // "which" for a thing, "who" for a person. The pronoun depends on what the
    // PREVIOUS hop landed on, not on this step's predicate -- it stands in for
    // the node just named. Hardcoding "which" produced "Arrival was directed
    // by Denis Villeneuve, which directed Blade Runner 2049" on the app's
    // flagship surface.
    const previous = i > 0 ? steps[i - 1]!.node.type : null;
    const subject =
      i === 0 ? from.label : previous === 'person' || previous === 'character' ? 'who' : 'which';
    const fragment = template
      ? template.replace('{subject}', subject).replace('{object}', s.node.label)
      : `${subject} ${s.predicateLabel} ${s.node.label}`;
    parts.push(fragment);
  });
  const sentence = parts.join(', ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
}

/**
 * Keep the best paths that are actually DIFFERENT from one another.
 *
 * Without this, a pair of Villeneuve films returns three paths through
 * Villeneuve -- one insight printed three times. Overlap is measured on
 * intermediate nodes only; the endpoints are shared by definition.
 */
export function diversify(paths: GraphPath[], limit: number): GraphPath[] {
  const kept: GraphPath[] = [];
  const keptSets: Set<string>[] = [];

  for (const p of paths) {
    const mids = new Set(p.steps.slice(0, -1).map((s) => `${s.node.type}:${s.node.id}`));
    if (mids.size === 0) continue;

    const tooSimilar = keptSets.some((prev) => {
      const shared = [...mids].filter((m) => prev.has(m)).length;
      return shared / Math.min(mids.size, prev.size) > PATH_RANKING.diversityMaxOverlap;
    });
    if (tooSimilar) continue;

    kept.push(p);
    keptSets.push(mids);
    if (kept.length >= limit) break;
  }
  return kept;
}

export const graphEngine = new PostgresGraphEngine();
