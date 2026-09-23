import { sql } from 'drizzle-orm';
import { withUser, type Tx } from '../db/client';

/**
 * What to watch, derived from the graph rather than from a model.
 *
 * This is the clearest demonstration in the app that the semantic layer is
 * load-bearing: sem.user_taste_affinity already existed and already powered
 * the five metrics on /universe/me. One view, another feature, no new model
 * and no new table.
 *
 * The product rule is that the REASON is the product. A recommendation you
 * cannot interrogate is indistinguishable from a guess, and the whole thesis
 * of this app is that the connections are declared rather than inferred -- so
 * every suggestion carries the edges it came from, in the reader's language:
 * "Denis Villeneuve, whose work you have watched 4 of."
 */

async function rows<T>(tx: Tx, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await tx.execute(query)) as unknown as T[];
}

export interface SuggestionReason {
  /** The node the evidence came from: a director, a theme, a franchise. */
  label: string;
  /** Canonical predicate, for the sentence: directed, explores_theme, ... */
  predicate: string;
  /** How many titles you have watched that share it. */
  n: number;
}

export interface Suggestion {
  title_id: string;
  slug: string;
  title: string;
  release_year: number | null;
  poster_path: string | null;
  runtime_minutes: number | null;
  score: number;
  reasons: SuggestionReason[];
}

/**
 * Bounded at every step, and weighted by the ontology rather than by opinion.
 *
 * The first version of this ranked by raw affinity and produced exactly the
 * failure the spec warns about for path-finding -- "both are Drama". Every
 * reason it gave was a genre, and the top result was Superman IV: The Quest
 * for Peace, recommended because it is Science Fiction and Action. True, and
 * worthless.
 *
 * The fix was already declared. core.predicate_meta is generated from
 * ontology.yaml and carries both the path weight (directed 1.0, acted_in 1.4,
 * explores_theme 2.6, belongs_to_genre 4.5) and the flag that bars genre from
 * path intermediates for precisely this reason. Both are applied here, so
 * "the ontology is load-bearing" is a fact about this query rather than a
 * claim about the project: a director is worth 4.5x a genre because the file
 * says so, and adjusting the file adjusts the recommendations.
 *
 * Hubs are penalized the same way the path ranker penalizes them, by
 * ln(degree) rather than by a cliff. A prolific character actor should not
 * fill the list with their own filmography.
 *
 * sem.user_taste_affinity is a plain view over the whole watched set joined to
 * sem.edge_bidirectional, so expanding every affinity node to every title it
 * touches would be a cross product with the corpus. Hence the seed cap.
 */
export async function suggestions(
  accountId: string,
  opts: { limit?: number; kind?: 'movie' | 'show' } = {},
): Promise<Suggestion[]> {
  const limit = opts.limit ?? 12;

  return withUser(accountId, async (tx) =>
    rows<Suggestion>(
      tx,
      sql`
        WITH seed AS (
          /* The strongest signals only. Affinity already blends how much you
             watched, how much better than your own mean you rated it, and how
             recently -- so this is a cap on breadth, not a second ranking. */
          SELECT a.node_type, a.node_id, a.canonical_predicate, a.label,
                 a.n_titles, a.affinity_score, pm.path_weight
          FROM sem.user_taste_affinity a
          JOIN core.predicate_meta pm ON pm.predicate = a.canonical_predicate
          WHERE a.account_id = ${accountId}
            AND a.n_titles >= 2
            /* Declared in ontology.yaml, not decided here. Genre is barred
               from path intermediates because "both are Science Fiction"
               explains nothing, and it explains nothing here either. */
            AND NOT pm.excluded_from_path_intermediates
          ORDER BY a.affinity_score DESC
          LIMIT 40
        ),
        candidate AS (
          /* DISTINCT ON the (title, seed) pair. sem.edge unions core.credit,
             where one person legitimately holds several rows under one
             predicate -- Lawrence Konner is credited on Superman IV as both
             Writer and Screenplay -- and without this he was counted twice in
             the score and printed twice in the reason. */
          SELECT DISTINCT ON (e.object_id, s.node_type, s.node_id)
            e.object_id AS title_id,
            s.label,
            s.canonical_predicate AS predicate,
            s.n_titles AS n,
            s.node_type || ':' || s.node_id AS seed_key,
            /* Inverse path weight: a shared director (1.0) counts 4.5x a
               shared genre (4.5) and 2.6x a shared theme. Squared, because
               the linear form still let two weak signals outvote one strong
               one -- which is how a studio credit beat a director.
               Hub-penalized on the SEED, so a prolific actor contributes less
               per title than a director with eleven films. */
            (s.affinity_score / (s.path_weight * s.path_weight))
              / (1 + ln(greatest(d.degree, 1)::numeric)) AS contribution
          FROM seed s
          JOIN sem.edge_bidirectional e
            ON e.subject_type = s.node_type
           AND e.subject_id = s.node_id
           AND e.object_type = 'title'
            /* The SAME relationship the affinity was built from.
               Without this, a seed of "Michael Imperioli, whose writing you
               have watched 3 of" expanded to every title he touches by any
               predicate, and then labeled the result "wrote" -- recommending
               seven films he ACTED in, each with a reason that was false. In
               a feature whose entire product is the reason, a wrong reason is
               worse than no recommendation. */
           AND e.canonical_predicate = s.canonical_predicate
          JOIN core.node_degree d
            ON d.node_type = s.node_type AND d.node_id = s.node_id
          WHERE
            /* Never suggest something already in your library -- watched,
               watching, abandoned, or on the watchlist. The watchlist is one
               tap away in Library and already sorted; what a recommender is
               for is the part of the graph you have NOT seen. */
            NOT EXISTS (
              SELECT 1 FROM sem.user_title ut
              WHERE ut.account_id = ${accountId} AND ut.title_id = e.object_id
            )
          ORDER BY e.object_id, s.node_type, s.node_id
        ),
        scored AS (
          SELECT
            title_id,
            sum(contribution) AS score,
            /* The evidence, strongest first, for the sentence under the
               poster. Two is enough to be convincing and short. */
            (array_agg(
               jsonb_build_object('label', label, 'predicate', predicate, 'n', n)
               ORDER BY contribution DESC
             ))[1:2] AS reasons,
            /* Which seed contributed most. Used only to keep one person from
               owning the list. */
            (array_agg(seed_key ORDER BY contribution DESC))[1] AS lead_seed
          FROM candidate
          GROUP BY title_id
        ),
        /* Diversity, the same rule the path finder applies for the same
           reason: without it the answer was six Spider-Man films, because one
           strong seed expands to its whole filmography and every one of those
           outranks the next seed's best. A list of six films by one actor is
           not six recommendations. Two per seed, then rank across seeds.
           This is also why the query asks for more rows than it returns. */
        diversified AS (
          SELECT *,
                 row_number() OVER (PARTITION BY lead_seed ORDER BY score DESC) AS rn
          FROM scored
        )
        SELECT
          t.id AS title_id,
          t.slug, t.title, t.release_year, t.poster_path, t.runtime_minutes,
          round(d.score, 6)::float8 AS score,
          to_jsonb(d.reasons) AS reasons
        FROM diversified d
        JOIN sem.title t ON t.id = d.title_id
        WHERE t.poster_path IS NOT NULL
          AND d.rn <= 2
          ${opts.kind ? sql`AND t.kind = ${opts.kind}` : sql``}
        ORDER BY d.score DESC
        LIMIT ${limit}`,
    ),
  );
}
