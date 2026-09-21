/**
 * Enriches the corpus with the relationships TMDB does not model: adaptation
 * sources (based_on -> core.work, with authors), verified franchise membership,
 * and influence.
 *
 * CC0, no API key, joined to our corpus through the IMDb id both sources carry.
 * See docs/adr/0006.
 *
 * Idempotent. Usage: pnpm enrich:wikidata [--limit N]
 */
import postgres from 'postgres';
import {
  WikidataClient,
  qid,
  WORK_KIND_BY_QID,
  FRANCHISE_SERIES_QIDS,
  SCREEN_WORK_QIDS,
} from '@/server/providers/wikidata/client';
import { slugify } from '@/server/ingest/normalize';

const args = process.argv.slice(2);
const li = args.indexOf('--limit');
const LIMIT = li >= 0 ? Number(args[li + 1]) : Infinity;
const BATCH = 60;

const sql = postgres(process.env.DATABASE_URL!, { max: 4, prepare: false, onnotice: () => {} });
const wd = new WikidataClient();

async function main(): Promise<void> {
  const rows = await sql<{ imdb: string; title_id: string }[]>`
    SELECT source_id AS imdb, entity_id AS title_id
    FROM core.external_id
    WHERE source = 'imdb' AND entity_type = 'title'
    ORDER BY source_id`;
  const targets = Number.isFinite(LIMIT) ? rows.slice(0, LIMIT) : rows;
  const byImdb = new Map(targets.map((r) => [r.imdb, r.title_id]));
  console.log(`enriching ${targets.length} titles in batches of ${BATCH}`);

  let works = 0;
  let basedOn = 0;
  let franchises = 0;
  let influences = 0;
  let rejectedSeries = 0;
  let skippedScreenWork = 0;
  let skippedUnknownKind = 0;

  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH).map((r) => r.imdb);
    let bindings;
    try {
      bindings = await wd.filmFacts(batch);
    } catch (e) {
      console.error(`  batch ${i} failed: ${e instanceof Error ? e.message : e}`);
      continue;
    }

    for (const b of bindings) {
      const titleId = byImdb.get(b.imdb?.value ?? '');
      if (!titleId) continue;

      // --- based_on -> core.work ---
      if (b.basedOn?.value && b.basedOnLabel?.value) {
        const workQid = qid(b.basedOn.value)!;
        const typeQid = qid(b.basedOnType?.value) ?? '';
        const label = b.basedOnLabel.value;

        // A screen work is not a core.work. That relationship is title-to-title
        // and belongs in the title graph.
        if (SCREEN_WORK_QIDS.has(typeQid)) {
          skippedScreenWork++;
          continue;
        }
        const kind = WORK_KIND_BY_QID[typeQid];
        // No default. An unrecognized source type is skipped, not guessed at.
        if (!kind) {
          skippedUnknownKind++;
          continue;
        }
        // Wikidata returns the QID as the label when no English label exists.
        if (!/^Q\d+$/.test(label)) {
          const existing = await sql<{ entity_id: string }[]>`
            SELECT entity_id FROM core.external_id
            WHERE source = 'wikidata' AND source_id = ${workQid} AND entity_type = 'work'`;
          let workId = existing[0]?.entity_id;
          if (!workId) {
            const [w] = await sql<{ id: string }[]>`
              INSERT INTO core.work (slug, kind, title)
              VALUES (${slugify(label, workQid.toLowerCase())}, ${kind}, ${label})
              ON CONFLICT (slug) DO UPDATE SET title = excluded.title
              RETURNING id`;
            workId = w!.id;
            await sql`INSERT INTO core.external_id (source, source_id, entity_type, entity_id, is_primary)
                      VALUES ('wikidata', ${workQid}, 'work', ${workId}, true)
                      ON CONFLICT DO NOTHING`;
            works++;
          }

          // Link the author if we already know that person by name.
          if (b.authorLabel?.value && !/^Q\d+$/.test(b.authorLabel.value)) {
            await sql`
              UPDATE core.work SET author_person_id = p.id
              FROM core.person p
              WHERE core.work.id = ${workId}
                AND lower(p.name) = ${b.authorLabel.value.toLowerCase()}
                AND core.work.author_person_id IS NULL`;
          }

          await sql`
            INSERT INTO core.edge
              (subject_type, subject_id, predicate, object_type, object_id, provenance, source, source_ref)
            VALUES ('title', ${titleId}, 'based_on', 'work', ${workId}, 'asserted', 'wikidata', ${workQid})
            ON CONFLICT DO NOTHING`;
          basedOn++;
        }
      }

      // --- part_of_franchise, only where the series is genuinely a series ---
      if (b.series?.value && b.seriesLabel?.value) {
        const seriesType = qid(b.seriesType?.value) ?? '';
        if (!FRANCHISE_SERIES_QIDS.has(seriesType)) {
          rejectedSeries++;
        } else {
          const seriesQid = qid(b.series.value)!;
          const label = b.seriesLabel.value;
          if (!/^Q\d+$/.test(label)) {
            const existing = await sql<{ entity_id: string }[]>`
              SELECT entity_id FROM core.external_id
              WHERE source = 'wikidata' AND source_id = ${seriesQid} AND entity_type = 'collection'`;
            let colId = existing[0]?.entity_id;
            if (!colId) {
              const [c] = await sql<{ id: string }[]>`
                INSERT INTO core.collection (slug, kind, name)
                VALUES (${slugify(label, seriesQid.toLowerCase())}, 'franchise', ${label})
                ON CONFLICT (slug) DO UPDATE SET name = excluded.name
                RETURNING id`;
              colId = c!.id;
              await sql`INSERT INTO core.external_id (source, source_id, entity_type, entity_id, is_primary)
                        VALUES ('wikidata', ${seriesQid}, 'collection', ${colId}, false)
                        ON CONFLICT DO NOTHING`;
            }
            await sql`
              INSERT INTO core.edge
                (subject_type, subject_id, predicate, object_type, object_id, provenance, source, source_ref)
              VALUES ('title', ${titleId}, 'part_of_franchise', 'collection', ${colId},
                      'asserted', 'wikidata', ${seriesQid})
              ON CONFLICT DO NOTHING`;
            franchises++;
          }
        }
      }

      // --- influenced_by, title -> title, only when we already have both ---
      if (b.influencedBy?.value) {
        const infQid = qid(b.influencedBy.value)!;
        const [other] = await sql<{ entity_id: string }[]>`
          SELECT entity_id FROM core.external_id
          WHERE source = 'wikidata' AND source_id = ${infQid} AND entity_type = 'title'`;
        if (other && other.entity_id !== titleId) {
          await sql`
            INSERT INTO core.edge
              (subject_type, subject_id, predicate, object_type, object_id, provenance, source)
            VALUES ('title', ${titleId}, 'influenced_by', 'title', ${other.entity_id}, 'curated', 'wikidata')
            ON CONFLICT DO NOTHING`;
          influences++;
        }
      }
    }
    if ((i / BATCH) % 10 === 0) {
      console.log(
        `  ${Math.min(i + BATCH, targets.length)}/${targets.length} · works ${works} based_on ${basedOn} franchises ${franchises}`,
      );
    }
  }

  console.log('\nenrichment complete');
  console.log(`  works created        ${works}`);
  console.log(`  based_on edges       ${basedOn}`);
  console.log(`  franchise edges      ${franchises}`);
  console.log(`  influenced_by edges  ${influences}`);
  console.log(`  series REJECTED as not-a-franchise (lists, award sets): ${rejectedSeries}`);
  console.log(
    `  sources SKIPPED as screen works (title-to-title, not a work): ${skippedScreenWork}`,
  );
  console.log(
    `  sources SKIPPED as an unrecognized type (never guessed):      ${skippedUnknownKind}`,
  );
  await sql.end();
}

main().catch(async (e) => {
  console.error('enrich-wikidata FAILED:', e);
  await sql.end();
  process.exit(1);
});
