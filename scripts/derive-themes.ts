/**
 * Loads ontology/crosswalk.yaml into core.crosswalk_keyword_theme, then derives
 * explores_theme edges from core.title_keyword.
 *
 * THIS IS THE REPLAYABILITY PAYOFF. Revising the theme vocabulary or the
 * crosswalk means re-running this one command — no re-crawling TMDB — because
 * raw keyword assignments are already in core.title_keyword and the payloads
 * are in raw. That is the entire argument for keeping a raw layer.
 *
 * Derived theme edges carry provenance 'curated', not 'asserted': no provider
 * said this film explores Memory. We did.
 *
 * Usage: pnpm derive:themes
 */
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { slugify } from '@/server/ingest/normalize';

interface Mapping {
  theme: string;
  salience: number;
}
interface Crosswalk {
  default_decided_by: string;
  excluded: Record<string, string[]>;
  mappings: Record<string, Mapping[]>;
}

/** Summed salience below this is noise, not a theme. */
const SALIENCE_THRESHOLD = 0.5;
/** More than this and "themes" stops meaning anything. */
const MAX_THEMES_PER_TITLE = 6;

const sql = postgres(process.env.DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });

async function main(): Promise<void> {
  const cw = parse(readFileSync('ontology/crosswalk.yaml', 'utf8')) as Crosswalk;
  const themesDoc = parse(readFileSync('ontology/themes.yaml', 'utf8')) as {
    clusters: Record<string, { themes: Record<string, { label: string; definition: string }> }>;
  };

  // 1. The curated theme vocabulary becomes concepts.
  console.log('1. loading theme vocabulary');
  const themeIds = new Map<string, string>();
  for (const cluster of Object.values(themesDoc.clusters)) {
    for (const [key, t] of Object.entries(cluster.themes)) {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO core.concept (scheme, slug, label, description, is_curated)
        VALUES ('theme', ${slugify(key)}, ${t.label}, ${t.definition}, true)
        ON CONFLICT (scheme, slug)
        DO UPDATE SET label = excluded.label, description = excluded.description
        RETURNING id`;
      themeIds.set(key, row!.id);
    }
  }
  console.log(`   ${themeIds.size} themes`);

  // 2. The crosswalk itself, keyed by keyword LABEL because TMDB keyword ids
  //    are stable but the mapping is authored against human-readable names.
  console.log('2. loading crosswalk');
  // The file is the source of truth, so the table is rebuilt wholesale.
  await sql`DELETE FROM core.crosswalk_keyword_theme`;
  let pairs = 0;
  for (const [keyword, mappings] of Object.entries(cw.mappings)) {
    for (const m of mappings) {
      const conceptId = themeIds.get(m.theme);
      if (!conceptId) throw new Error(`crosswalk references unknown theme: ${m.theme}`);
      await sql`
        INSERT INTO core.crosswalk_keyword_theme
          (keyword_source_id, keyword_label, concept_id, salience, decided_by)
        VALUES (${keyword}, ${keyword}, ${conceptId}, ${m.salience}, ${cw.default_decided_by})
        ON CONFLICT (keyword_source_id, concept_id)
        DO UPDATE SET salience = excluded.salience, decided_by = excluded.decided_by`;
      pairs++;
    }
  }
  // Excluded keywords are recorded with a null concept: "considered and
  // deliberately not a theme" is different information from "never looked at",
  // and the coverage metric needs to tell them apart.
  for (const [reason, keywords] of Object.entries(cw.excluded)) {
    for (const k of keywords) {
      await sql`
        INSERT INTO core.crosswalk_keyword_theme
          (keyword_source_id, keyword_label, concept_id, salience, decided_by, notes)
        VALUES (${k}, ${k}, NULL, 0, 'human', ${`excluded: ${reason}`})
        ON CONFLICT (keyword_source_id) WHERE concept_id IS NULL DO NOTHING`;
    }
  }
  console.log(
    `   ${pairs} keyword-theme pairs, ${Object.values(cw.excluded).flat().length} exclusions`,
  );

  // 3. Derive. Salience accumulates across a title's keywords, then the top N
  //    above threshold win.
  console.log('3. deriving explores_theme edges');
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
  console.log(`   ${inserted.length} theme edges`);

  // 4. Coverage, reported against what is actually achievable.
  //
  // Measuring themed titles against ALL titles is misleading: some titles have
  // no TMDB keywords at all, and no crosswalk can theme those. That share is an
  // absolute ceiling, so it is reported separately rather than counted as a
  // crosswalk failure.
  const [cov] = await sql<
    {
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
    }[]
  >`
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

  const pct = (a: number, b: number) => (b === 0 ? '0.0' : ((100 * a) / b).toFixed(1));
  const c = cov!;
  console.log('\ncoverage');
  console.log(
    `  THEMED, of titles that have keywords   ${c.themed}/${c.with_keywords}  (${pct(c.themed, c.with_keywords)}%)   <- the number that matters`,
  );
  console.log(
    `  titles with no TMDB keywords at all    ${c.no_keywords}/${c.titles}  (${pct(c.no_keywords, c.titles)}%)   <- hard ceiling, not a crosswalk gap`,
  );
  console.log(
    `  themed, of ALL titles                  ${c.themed}/${c.titles}  (${pct(c.themed, c.titles)}%)`,
  );
  console.log('');
  console.log(
    `  keyword assignments mapped             ${c.mapped_assignments}/${c.assignments}  (${pct(c.mapped_assignments, c.assignments)}%)`,
  );
  console.log(
    `  ... plus deliberately excluded         ${c.excluded_assignments}  (${pct(c.mapped_assignments + c.excluded_assignments, c.assignments)}% adjudicated)`,
  );
  console.log(
    `  distinct keywords mapped               ${c.mapped_keywords}/${c.distinct_keywords}  (${pct(c.mapped_keywords, c.distinct_keywords)}%)`,
  );
  console.log('');
  console.log('  Distinct-keyword coverage is low BY DESIGN: the tail is thousands of');
  console.log('  terms used once each, overwhelmingly settings and objects. Assignment');
  console.log('  coverage weights by how often a keyword is actually used, and');
  console.log('  "adjudicated" counts terms we considered and deliberately excluded —');
  console.log('  which is different information from never having looked at them.');

  await sql.end();
}

main().catch(async (e) => {
  console.error('derive-themes FAILED:', e);
  await sql.end();
  process.exit(1);
});
