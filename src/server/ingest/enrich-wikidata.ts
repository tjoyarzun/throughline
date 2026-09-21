/**
 * Enriches the corpus with the relationships TMDB does not model: adaptation
 * sources (based_on -> core.work, with authors), verified franchise
 * membership, and influence.
 *
 * CC0, no API key, joined to our corpus through the IMDb id both sources
 * carry. See docs/adr/0006.
 *
 * Lives in src/server so it can run as a job: production's database is only
 * reachable from a Vercel function. A full pass is ~83 SPARQL round trips,
 * well past any function's budget, so callers pass a window and the job
 * handler chains the next one.
 */
import {
  WikidataClient,
  qid,
  WORK_KIND_BY_QID,
  FRANCHISE_SERIES_QIDS,
  SCREEN_WORK_QIDS,
} from '@/server/providers/wikidata/client';
import { slugify } from '@/server/ingest/normalize';
import type { Sql } from './resolve';

/** Titles per SPARQL query. Wikidata is a shared public endpoint; be polite. */
export const SPARQL_BATCH = 60;

export interface EnrichStats {
  processed: number;
  works: number;
  basedOn: number;
  franchises: number;
  influences: number;
  rejectedSeries: number;
  skippedScreenWork: number;
  skippedUnknownKind: number;
  /** Offset to resume from, or null when the corpus is exhausted. */
  nextOffset: number | null;
  total: number;
}

export interface EnrichWindow {
  /** Where to start in the IMDb-ordered corpus. */
  offset?: number;
  /** How many titles this call may process. Infinity for a full pass. */
  maxTitles?: number;
  onProgress?: (done: number, total: number, s: EnrichStats) => void;
}

export async function enrichWikidata(sql: Sql, window: EnrichWindow = {}): Promise<EnrichStats> {
  const offset = window.offset ?? 0;
  const maxTitles = window.maxTitles ?? Infinity;

  // Stable ordering, so an offset means the same thing across calls.
  const rows = await sql<{ imdb: string; title_id: string }[]>`
    SELECT source_id AS imdb, entity_id AS title_id
    FROM core.external_id
    WHERE source = 'imdb' AND entity_type = 'title'
    ORDER BY source_id`;

  const targets = rows.slice(offset, Number.isFinite(maxTitles) ? offset + maxTitles : undefined);
  const byImdb = new Map(targets.map((r) => [r.imdb, r.title_id]));
  const wd = new WikidataClient();

  const s: EnrichStats = {
    processed: 0,
    works: 0,
    basedOn: 0,
    franchises: 0,
    influences: 0,
    rejectedSeries: 0,
    skippedScreenWork: 0,
    skippedUnknownKind: 0,
    nextOffset: null,
    total: rows.length,
  };

  for (let i = 0; i < targets.length; i += SPARQL_BATCH) {
    const batch = targets.slice(i, i + SPARQL_BATCH).map((r) => r.imdb);
    let bindings;
    try {
      bindings = await wd.filmFacts(batch);
    } catch {
      // A failed batch is skipped, not retried inline: the job as a whole is
      // idempotent, so the next pass picks these up.
      s.processed += batch.length;
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
          s.skippedScreenWork++;
          continue;
        }
        const kind = WORK_KIND_BY_QID[typeQid];
        // No default. An unrecognized source type is skipped, not guessed at.
        if (!kind) {
          s.skippedUnknownKind++;
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
            s.works++;
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
          s.basedOn++;
        }
      }

      // --- part_of_franchise, only where the series is genuinely a series ---
      if (b.series?.value && b.seriesLabel?.value) {
        const seriesType = qid(b.seriesType?.value) ?? '';
        if (!FRANCHISE_SERIES_QIDS.has(seriesType)) {
          s.rejectedSeries++;
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
            s.franchises++;
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
          s.influences++;
        }
      }
    }

    s.processed += batch.length;
    window.onProgress?.(offset + s.processed, rows.length, s);
  }

  const reached = offset + s.processed;
  s.nextOffset = reached < rows.length ? reached : null;
  return s;
}
