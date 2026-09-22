/**
 * Computes similar_to edges into core.edge_derived.
 *
 * Similarity here is NOT a vector model. It is the ontology answering the
 * question directly: two titles are similar to the extent that they share
 * signals which are rare in the corpus. That is what makes the result
 * explainable -- every edge carries the reason it exists, so the UI can say
 * "director" or "theme" rather than "the algorithm says so".
 *
 * INVERSE DOCUMENT FREQUENCY does the real work. Sharing "Drama" is worth
 * almost nothing because 2,000 titles share it; sharing "Artificial
 * Personhood" is worth a great deal because twelve do. Without that weighting
 * every film is similar to every other film through its genre, which is the
 * same failure mode the path ranker's hub penalty exists to prevent.
 *
 * Everything lands in core.edge_derived, which is separately truncatable:
 * provider facts and human curation can never be destroyed by a bad run.
 */
import type { Sql } from './resolve';

/** How many neighbors to keep per title. Beyond this the tail is noise. */
export const SIMILAR_PER_TITLE = 12;

/**
 * Raw scores are unbounded sums; the ontology declares score as 0..1. This
 * maps one to the other smoothly rather than clipping, so ordering is
 * preserved across the whole range. HALF_SCORE is the raw score that maps to
 * 0.5 -- tuned so a shared director plus a shared theme lands mid-scale.
 */
const HALF_SCORE = 8;

export interface SimilarResult {
  pairs: number;
  edges: number;
}

export async function deriveSimilar(sql: Sql): Promise<SimilarResult> {
  // Recomputed wholesale. Scoped by method so a future second method can live
  // alongside this one rather than being clobbered by it.
  await sql`DELETE FROM core.edge_derived
            WHERE predicate = 'similar_to' AND method = 'shared_signal_idf_v1'`;

  const inserted = await sql<{ n: number }[]>`
    WITH corpus AS (SELECT count(*)::numeric AS n FROM core.title),

    -- ── candidate pairs, each with a score and the reason it scored ────────
    -- Crew is the strongest signal: a shared director is the single most
    -- satisfying "why are these alike" answer there is.
    crew_df AS (
      SELECT person_id, count(DISTINCT title_id)::numeric AS df
      FROM core.credit
      WHERE episode_id IS NULL
        AND predicate IN ('directed', 'wrote', 'composed_for', 'shot')
      GROUP BY 1
    ),
    crew AS (
      SELECT a.title_id AS x, b.title_id AS y,
             sum(ln(corpus.n / crew_df.df) *
                 CASE a.predicate WHEN 'directed' THEN 1.6
                                  WHEN 'wrote' THEN 1.1
                                  ELSE 0.7 END) AS score,
             CASE WHEN bool_or(a.predicate = 'directed') THEN 'director'
                  WHEN bool_or(a.predicate = 'wrote') THEN 'writer'
                  ELSE 'crew' END AS reason
      FROM core.credit a
      JOIN core.credit b
        ON b.person_id = a.person_id
       AND b.predicate = a.predicate
       AND b.episode_id IS NULL
       AND b.title_id > a.title_id
      JOIN crew_df ON crew_df.person_id = a.person_id
      CROSS JOIN corpus
      WHERE a.episode_id IS NULL
        AND a.predicate IN ('directed', 'wrote', 'composed_for', 'shot')
      GROUP BY 1, 2
    ),

    -- Themes are OUR vocabulary, which is exactly why they are interesting
    -- here. Two shared themes minimum: one is a coincidence.
    theme_df AS (
      SELECT object_id AS concept_id, count(*)::numeric AS df
      FROM core.edge WHERE predicate = 'explores_theme' GROUP BY 1
    ),
    themes AS (
      SELECT a.subject_id AS x, b.subject_id AS y,
             sum(ln(corpus.n / theme_df.df) * 0.9 *
                 least(COALESCE((a.attributes->>'salience')::numeric, 0.5),
                       COALESCE((b.attributes->>'salience')::numeric, 0.5))) AS score,
             'theme' AS reason
      FROM core.edge a
      JOIN core.edge b
        ON b.object_id = a.object_id
       AND b.predicate = 'explores_theme'
       AND b.subject_id > a.subject_id
      JOIN theme_df ON theme_df.concept_id = a.object_id
      CROSS JOIN corpus
      WHERE a.predicate = 'explores_theme'
      GROUP BY 1, 2
      HAVING count(*) >= 2
    ),

    -- Top-billed cast only. A prolific character actor further down the call
    -- sheet connects everything to everything, which is noise, not similarity.
    cast_df AS (
      SELECT person_id, count(DISTINCT title_id)::numeric AS df
      FROM core.credit
      WHERE episode_id IS NULL AND predicate = 'acted_in' AND billing_order <= 2
      GROUP BY 1
    ),
    leads AS (
      SELECT a.title_id AS x, b.title_id AS y,
             sum(ln(corpus.n / cast_df.df) * 0.55) AS score,
             'cast' AS reason
      FROM core.credit a
      JOIN core.credit b
        ON b.person_id = a.person_id
       AND b.predicate = 'acted_in'
       AND b.episode_id IS NULL
       AND b.billing_order <= 2
       AND b.title_id > a.title_id
      JOIN cast_df ON cast_df.person_id = a.person_id
      CROSS JOIN corpus
      WHERE a.episode_id IS NULL AND a.predicate = 'acted_in' AND a.billing_order <= 2
      GROUP BY 1, 2
    ),

    franchise AS (
      SELECT a.subject_id AS x, b.subject_id AS y, 4.0 AS score, 'franchise' AS reason
      FROM core.edge a
      JOIN core.edge b
        ON b.object_id = a.object_id
       AND b.predicate = 'part_of_franchise'
       AND b.subject_id > a.subject_id
      WHERE a.predicate = 'part_of_franchise'
    ),

    signals AS (
      SELECT * FROM crew
      UNION ALL SELECT * FROM themes
      UNION ALL SELECT * FROM leads
      UNION ALL SELECT * FROM franchise
    ),

    -- The reason shown is the single largest contributor, so the chip on the
    -- poster is honest about WHY rather than naming whichever signal sorted
    -- first.
    combined AS (
      SELECT x, y, sum(score) AS score,
             (array_agg(reason ORDER BY score DESC))[1] AS reason
      FROM signals GROUP BY x, y
    ),

    -- Rank from BOTH ends before truncating. Keeping the global top N would
    -- give a title that always sorts second no neighbors at all.
    ranked AS (
      SELECT x AS a, y AS b, score, reason,
             row_number() OVER (PARTITION BY x ORDER BY score DESC, y) AS rn
      FROM combined
      UNION ALL
      SELECT y AS a, x AS b, score, reason,
             row_number() OVER (PARTITION BY y ORDER BY score DESC, x) AS rn
      FROM combined
    ),
    kept AS (
      SELECT DISTINCT
             least(a, b) AS subject_id,
             greatest(a, b) AS object_id,
             score, reason
      FROM ranked WHERE rn <= ${SIMILAR_PER_TITLE}
    )

    -- No provenance column: this table IS the provenance, and sem.edge stamps
    -- every row from it as 'derived'.
    INSERT INTO core.edge_derived
      (subject_type, subject_id, predicate, object_type, object_id,
       attributes, confidence, method, score)
    SELECT 'title', subject_id, 'similar_to', 'title', object_id,
           jsonb_build_object(
             'score', round((score / (score + ${HALF_SCORE}))::numeric, 4),
             'reason', reason,
             -- The raw sum is kept for tuning, but only here: the score COLUMN
             -- is numeric(6,4) and the ontology declares score as 0..1, so the
             -- unbounded value does not belong in it.
             'raw_score', round(score::numeric, 2),
             'method', 'shared_signal_idf_v1'),
           round((score / (score + ${HALF_SCORE}))::numeric, 2),
           'shared_signal_idf_v1',
           round((score / (score + ${HALF_SCORE}))::numeric, 4)
    FROM kept
    ON CONFLICT (subject_type, subject_id, predicate, object_type, object_id, method)
    DO UPDATE SET attributes = excluded.attributes, score = excluded.score,
                  confidence = excluded.confidence, computed_at = now()
    RETURNING 1 AS n`;

  const [pairs] = await sql<{ n: number }[]>`
    SELECT count(DISTINCT subject_id)::int AS n FROM core.edge_derived
    WHERE predicate = 'similar_to'`;

  return { pairs: pairs?.n ?? 0, edges: inserted.length };
}
