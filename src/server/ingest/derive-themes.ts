/**
 * Theme derivation: the curated vocabulary and the keyword crosswalk become
 * core.concept rows and explores_theme edges.
 *
 * THIS IS THE REPLAYABILITY PAYOFF. Revising the vocabulary or the crosswalk
 * means re-running this -- no re-crawling TMDB -- because raw keyword
 * assignments are already in core.title_keyword and the payloads are in raw.
 * That is the entire argument for keeping a raw layer.
 *
 * Derived theme edges carry provenance 'curated', not 'asserted': no provider
 * said this film explores Memory. We did.
 *
 * Lives in src/server (not scripts/) because it must also run inside a job
 * handler, where the production database is the only database reachable.
 */
import { CROSSWALK, DEFAULT_DECIDED_BY, EXCLUDED, THEMES } from '@/lib/ontology/vocabulary';
import { slugify } from '@/server/ingest/normalize';
import type { Sql } from './resolve';

/** Summed salience below this is noise, not a theme. */
export const SALIENCE_THRESHOLD = 0.5;
/** More than this and "themes" stops meaning anything. */
export const MAX_THEMES_PER_TITLE = 6;

export interface DeriveResult {
  themes: number;
  pairs: number;
  exclusions: number;
  edges: number;
}

export async function deriveThemes(sql: Sql): Promise<DeriveResult> {
  // 1. The curated theme vocabulary becomes concepts.
  const themeIds = new Map<string, string>();
  for (const [key, t] of Object.entries(THEMES)) {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO core.concept (scheme, slug, label, description, is_curated)
      VALUES ('theme', ${slugify(key)}, ${t.label}, ${t.definition}, true)
      ON CONFLICT (scheme, slug)
      DO UPDATE SET label = excluded.label, description = excluded.description
      RETURNING id`;
    themeIds.set(key, row!.id);
  }

  // 2. The crosswalk, keyed by keyword LABEL: TMDB keyword ids are stable, but
  //    the mapping is authored against human-readable names.
  //    The file is the source of truth, so the table is rebuilt wholesale.
  await sql`DELETE FROM core.crosswalk_keyword_theme`;
  let pairs = 0;
  for (const [keyword, mappings] of Object.entries(CROSSWALK)) {
    for (const m of mappings) {
      const conceptId = themeIds.get(m.theme);
      if (!conceptId) throw new Error(`crosswalk references unknown theme: ${m.theme}`);
      await sql`
        INSERT INTO core.crosswalk_keyword_theme
          (keyword_source_id, keyword_label, concept_id, salience, decided_by)
        VALUES (${keyword}, ${keyword}, ${conceptId}, ${m.salience}, ${DEFAULT_DECIDED_BY})
        ON CONFLICT (keyword_source_id, concept_id)
        DO UPDATE SET salience = excluded.salience, decided_by = excluded.decided_by`;
      pairs++;
    }
  }

  // Excluded keywords are recorded with a null concept: "considered and
  // deliberately not a theme" is different information from "never looked at",
  // and the coverage metric needs to tell them apart.
  let exclusions = 0;
  for (const [reason, keywords] of Object.entries(EXCLUDED)) {
    for (const k of keywords) {
      await sql`
        INSERT INTO core.crosswalk_keyword_theme
          (keyword_source_id, keyword_label, concept_id, salience, decided_by, notes)
        VALUES (${k}, ${k}, NULL, 0, 'human', ${`excluded: ${reason}`})
        ON CONFLICT (keyword_source_id) WHERE concept_id IS NULL DO NOTHING`;
      exclusions++;
    }
  }

  // 3. Derive. Salience accumulates across a title's keywords, then the top N
  //    above threshold win.
  await sql`DELETE FROM core.edge WHERE predicate = 'explores_theme' AND source = 'crosswalk'`;
  const inserted = await sql<{ n: number }[]>`
    WITH scored AS (
      SELECT tk.title_id,
             x.concept_id,
             sum(x.salience) AS score,
             row_number() OVER (PARTITION BY tk.title_id ORDER BY sum(x.salience) DESC, x.concept_id) AS rn
      FROM core.title_keyword tk
      JOIN core.crosswalk_keyword_theme x
        ON lower(x.keyword_label) = lower(tk.keyword_label)
      WHERE x.concept_id IS NOT NULL
      GROUP BY tk.title_id, x.concept_id
    ), kept AS (
      SELECT title_id, concept_id, least(score, 1.0) AS salience
      FROM scored
      WHERE score >= ${SALIENCE_THRESHOLD} AND rn <= ${MAX_THEMES_PER_TITLE}
    )
    INSERT INTO core.edge
      (subject_type, subject_id, predicate, object_type, object_id, attributes, provenance, source)
    SELECT 'title', title_id, 'explores_theme', 'concept', concept_id,
           jsonb_build_object('salience', salience, 'derived_from', 'tmdb_keywords'),
           'curated', 'crosswalk'
    FROM kept
    ON CONFLICT (subject_type, subject_id, predicate, object_type, object_id)
    DO UPDATE SET attributes = excluded.attributes
    RETURNING 1 AS n`;

  return {
    themes: themeIds.size,
    pairs,
    exclusions,
    edges: inserted.length,
  };
}

export interface Coverage {
  titles: number;
  no_keywords: number;
  with_keywords: number;
  themed: number;
  distinct_keywords: number;
  mapped_keywords: number;
  excluded_keywords: number;
  assignments: number;
  mapped_assignments: number;
  excluded_assignments: number;
}

/**
 * Coverage, reported against what is actually achievable.
 *
 * Measuring themed titles against ALL titles is misleading: some titles have no
 * TMDB keywords at all, and no crosswalk can theme those. That share is an
 * absolute ceiling, so it is reported separately rather than counted as a
 * crosswalk failure.
 */
export async function themeCoverage(sql: Sql): Promise<Coverage> {
  const [cov] = await sql<Coverage[]>`
    WITH t AS (
      SELECT ti.id,
             EXISTS (SELECT 1 FROM core.title_keyword k WHERE k.title_id = ti.id) AS has_kw,
             EXISTS (SELECT 1 FROM core.edge e
                     WHERE e.subject_id = ti.id AND e.predicate = 'explores_theme') AS themed
      FROM core.title ti
    )
    SELECT
      (SELECT count(*)::int FROM t)                                   AS titles,
      (SELECT count(*)::int FROM t WHERE NOT has_kw)                  AS no_keywords,
      (SELECT count(*)::int FROM t WHERE has_kw)                      AS with_keywords,
      (SELECT count(*)::int FROM t WHERE has_kw AND themed)           AS themed,
      (SELECT count(DISTINCT lower(keyword_label))::int FROM core.title_keyword) AS distinct_keywords,
      (SELECT count(DISTINCT lower(tk.keyword_label))::int FROM core.title_keyword tk
        JOIN core.crosswalk_keyword_theme x ON lower(x.keyword_label) = lower(tk.keyword_label)
        WHERE x.concept_id IS NOT NULL)                               AS mapped_keywords,
      (SELECT count(DISTINCT lower(tk.keyword_label))::int FROM core.title_keyword tk
        JOIN core.crosswalk_keyword_theme x ON lower(x.keyword_label) = lower(tk.keyword_label)
        WHERE x.concept_id IS NULL)                                   AS excluded_keywords,
      (SELECT count(*)::int FROM core.title_keyword)                  AS assignments,
      (SELECT count(DISTINCT (tk.title_id, lower(tk.keyword_label)))::int
        FROM core.title_keyword tk
        JOIN core.crosswalk_keyword_theme x ON lower(x.keyword_label) = lower(tk.keyword_label)
        WHERE x.concept_id IS NOT NULL)                               AS mapped_assignments,
      (SELECT count(DISTINCT (tk.title_id, lower(tk.keyword_label)))::int
        FROM core.title_keyword tk
        JOIN core.crosswalk_keyword_theme x ON lower(x.keyword_label) = lower(tk.keyword_label)
        WHERE x.concept_id IS NULL)                                   AS excluded_assignments`;
  return cov!;
}
