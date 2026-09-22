import { sql } from 'drizzle-orm';
import { withUser, type Tx } from '../db/client';

/**
 * The personal layer read back as a shape.
 *
 * Everything here goes through withUser(): sem.user_taste_affinity reads
 * sem.user_title, which is RLS-scoped, and the view is security_invoker so the
 * policy actually applies to the caller rather than the view's owner.
 */

async function rows<T>(tx: Tx, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await tx.execute(query)) as unknown as T[];
}

export interface TasteNode {
  node_type: string;
  node_id: string;
  predicate: string;
  label: string;
  slug: string;
  image_path: string | null;
  n_titles: number;
  /** How many titles in the WHOLE corpus connect to this node. */
  corpus_titles: number;
  avg_rating: string | null;
  affinity_score: string;
}

/**
 * Top nodes per relationship, with corpus coverage alongside.
 *
 * `corpus_titles` is what makes this more than a leaderboard: "4 of Villeneuve's
 * 11" says something about YOU against the graph, where "4" alone says only
 * that you watched four things. It is the personal-layer-over-global-ontology
 * claim, rendered as a number.
 */
export async function tasteByPredicate(
  accountId: string,
  predicate: string,
  limit = 8,
): Promise<TasteNode[]> {
  return withUser(accountId, async (tx) =>
    rows<TasteNode>(
      tx,
      sql`
        SELECT a.node_type, a.node_id, a.predicate, a.label, a.slug, a.image_path,
               a.n_titles, a.avg_rating, a.affinity_score,
               (SELECT count(*)::int FROM sem.edge_bidirectional e
                 WHERE e.subject_type = a.node_type AND e.subject_id = a.node_id
                   AND e.object_type = 'title'
                   AND e.canonical_predicate = a.canonical_predicate) AS corpus_titles
        FROM sem.user_taste_affinity a
        WHERE a.account_id = ${accountId} AND a.predicate = ${predicate}
        ORDER BY a.affinity_score DESC, a.n_titles DESC
        LIMIT ${limit}`,
    ),
  );
}

export interface TasteSummary {
  watched: number;
  rated: number;
  hours: number;
  mean_rating: string | null;
  distinct_directors: number;
  distinct_themes: number;
  top_theme: string | null;
}

/** The headline numbers, in one round trip. */
export async function tasteSummary(accountId: string): Promise<TasteSummary> {
  return withUser(accountId, async (tx) => {
    const r = await rows<TasteSummary>(
      tx,
      sql`
        SELECT
          count(*) FILTER (WHERE ut.status = 'watched')::int              AS watched,
          count(*) FILTER (WHERE ut.rating IS NOT NULL)::int              AS rated,
          -- Runtime is per title, so a rewatch is not counted twice here.
          coalesce(round(sum(t.runtime_minutes) FILTER (
            WHERE ut.status = 'watched') / 60.0), 0)::int                 AS hours,
          round(avg(ut.rating), 2)                                        AS mean_rating,
          (SELECT count(DISTINCT node_id)::int FROM sem.user_taste_affinity
            WHERE account_id = ${accountId} AND predicate = 'directed_by') AS distinct_directors,
          (SELECT count(DISTINCT node_id)::int FROM sem.user_taste_affinity
            WHERE account_id = ${accountId} AND predicate = 'explores_theme') AS distinct_themes,
          (SELECT label FROM sem.user_taste_affinity
            WHERE account_id = ${accountId} AND predicate = 'explores_theme'
            ORDER BY affinity_score DESC LIMIT 1)                          AS top_theme
        FROM sem.user_title ut
        JOIN sem.title t ON t.id = ut.title_id
        WHERE ut.account_id = ${accountId}`,
    );
    return r[0]!;
  });
}
