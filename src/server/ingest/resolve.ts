import type postgres from 'postgres';
import { normalizeTitle, normalizePersonName } from './normalize';

/**
 * Entity resolution.
 *
 * One canonical UUID per real-world thing; many external IDs pointing at it.
 * The cascade short-circuits, cheapest and most certain first, and refuses to
 * guess: anything in the ambiguous band goes to core.er_review rather than
 * being merged on weak evidence. A wrong merge is far more expensive to undo
 * than a duplicate is to merge later.
 *
 * See docs/data-model.md and docs/ontology.md.
 */

export type Sql = ReturnType<typeof postgres>;

export type ResolutionMethod =
  | 'external_id' // 1. exact match on the source we already know
  | 'crosswalk' // 2. a shared secondary key (IMDb, Wikidata)
  | 'blocking_exact' // 3. same block, identical normalized title
  | 'fuzzy_corroborated' // 4. similar title AND independent corroboration
  | 'created'; // 6. genuinely new

export interface Resolution {
  entityId: string;
  method: ResolutionMethod;
  created: boolean;
}

/** Similarity at or above this, WITH corroboration, is an automatic match. */
const AUTO_MERGE_SIMILARITY = 0.92;
/** Between this and AUTO_MERGE_SIMILARITY goes to a human. Below, it is a new entity. */
const REVIEW_SIMILARITY = 0.8;

async function findByExternalId(
  sql: Sql,
  source: string,
  sourceId: string,
  entityType: string,
): Promise<string | null> {
  const [row] = await sql<{ entity_id: string }[]>`
    SELECT entity_id FROM core.external_id
    WHERE source = ${source} AND source_id = ${sourceId} AND entity_type = ${entityType}`;
  return row?.entity_id ?? null;
}

async function linkExternalId(
  sql: Sql,
  source: string,
  sourceId: string,
  entityType: string,
  entityId: string,
  isPrimary: boolean,
): Promise<void> {
  await sql`
    INSERT INTO core.external_id (source, source_id, entity_type, entity_id, is_primary, last_verified)
    VALUES (${source}, ${sourceId}, ${entityType}, ${entityId}, ${isPrimary}, now())
    ON CONFLICT (source, source_id, entity_type)
    DO UPDATE SET last_verified = now()`;
}

async function queueReview(
  sql: Sql,
  entityType: string,
  source: string,
  sourceId: string,
  candidateEntityId: string | null,
  similarity: number,
  evidence: unknown,
): Promise<void> {
  await sql`
    INSERT INTO core.er_review
      (entity_type, incoming_source, incoming_source_id, candidate_entity_id, similarity, evidence)
    VALUES (${entityType}, ${source}, ${sourceId}, ${candidateEntityId}, ${similarity},
            ${sql.json(evidence as never)})`;
}

// ── Titles ───────────────────────────────────────────────────────────────────

export interface TitleCandidate {
  tmdbId: number;
  imdbId: string | null;
  kind: 'movie' | 'show';
  title: string;
  releaseYear: number | null;
  runtimeMinutes: number | null;
  /** TMDB person ids of the top-billed cast. The corroborating signal. */
  topCastTmdbIds: number[];
}

/**
 * Title cascade.
 *
 * Step 4 is the one that matters. Title similarity ALONE produces disasters:
 * The Office (2001 UK) vs The Office (2005 US) are a perfect string match, and
 * there are six films called Pinocchio. Corroboration by shared cast and
 * runtime is what makes a fuzzy match safe.
 */
export async function resolveTitle(sql: Sql, c: TitleCandidate): Promise<Resolution> {
  // 1. Exact primary-source match. ~97% of cases, because TMDB is the spine.
  const byTmdb = await findByExternalId(sql, 'tmdb', String(c.tmdbId), 'title');
  if (byTmdb) {
    await linkExternalId(sql, 'tmdb', String(c.tmdbId), 'title', byTmdb, true);
    if (c.imdbId) await linkExternalId(sql, 'imdb', c.imdbId, 'title', byTmdb, false);
    return { entityId: byTmdb, method: 'external_id', created: false };
  }

  // 2. Secondary-key crosswalk. How Wikidata and OMDb attach without duplicating.
  if (c.imdbId) {
    const byImdb = await findByExternalId(sql, 'imdb', c.imdbId, 'title');
    if (byImdb) {
      await linkExternalId(sql, 'tmdb', String(c.tmdbId), 'title', byImdb, true);
      return { entityId: byImdb, method: 'crosswalk', created: false };
    }
  }

  // 3 + 4. Block on (kind, year +/- 1), then compare inside the block only.
  const sortTitle = normalizeTitle(c.title);
  const candidates = await sql<
    {
      id: string;
      sort_title: string;
      runtime_minutes: number | null;
      release_year: number | null;
      sim: number;
    }[]
  >`
    SELECT t.id, t.sort_title, t.runtime_minutes,
           EXTRACT(YEAR FROM t.release_date)::int AS release_year,
           similarity(t.sort_title, ${sortTitle}) AS sim
    FROM core.title t
    WHERE t.kind = ${c.kind}
      AND (${c.releaseYear}::int IS NULL
           OR t.release_date IS NULL
           OR abs(EXTRACT(YEAR FROM t.release_date)::int - ${c.releaseYear}::int) <= 1)
      AND similarity(t.sort_title, ${sortTitle}) >= ${REVIEW_SIMILARITY}
    ORDER BY sim DESC
    LIMIT 5`;

  for (const cand of candidates) {
    const exact = cand.sort_title === sortTitle;
    const runtimeOk =
      c.runtimeMinutes === null ||
      cand.runtime_minutes === null ||
      Math.abs(cand.runtime_minutes - c.runtimeMinutes) / Math.max(cand.runtime_minutes, 1) <= 0.1;

    const sharedCast = await countSharedCast(sql, cand.id, c.topCastTmdbIds);

    // An identical normalized title inside the block, with nothing contradicting
    // it, is a match. This is the common case for a title we already ingested
    // from another source.
    if (exact && runtimeOk && sharedCast >= 1) {
      await linkExternalId(sql, 'tmdb', String(c.tmdbId), 'title', cand.id, true);
      if (c.imdbId) await linkExternalId(sql, 'imdb', c.imdbId, 'title', cand.id, false);
      return { entityId: cand.id, method: 'blocking_exact', created: false };
    }

    if (Number(cand.sim) >= AUTO_MERGE_SIMILARITY && runtimeOk && sharedCast >= 1) {
      await linkExternalId(sql, 'tmdb', String(c.tmdbId), 'title', cand.id, true);
      if (c.imdbId) await linkExternalId(sql, 'imdb', c.imdbId, 'title', cand.id, false);
      return { entityId: cand.id, method: 'fuzzy_corroborated', created: false };
    }

    // 5. Similar but uncorroborated. Never guess — this is The Office case.
    if (Number(cand.sim) >= REVIEW_SIMILARITY) {
      await queueReview(sql, 'title', 'tmdb', String(c.tmdbId), cand.id, Number(cand.sim), {
        incoming: { title: c.title, year: c.releaseYear, runtime: c.runtimeMinutes },
        candidate: {
          sort_title: cand.sort_title,
          year: cand.release_year,
          runtime: cand.runtime_minutes,
        },
        shared_cast: sharedCast,
        runtime_compatible: runtimeOk,
        reason: exact
          ? 'identical normalized title but no shared cast'
          : 'similar title, insufficient corroboration',
      });
    }
  }

  return { entityId: '', method: 'created', created: true };
}

/** How many of the incoming top-billed cast already act in this candidate title. */
async function countSharedCast(sql: Sql, titleId: string, castTmdbIds: number[]): Promise<number> {
  if (castTmdbIds.length === 0) return 0;
  const ids = castTmdbIds.slice(0, 5).map(String);
  const [row] = await sql<{ n: number }[]>`
    SELECT count(DISTINCT x.source_id)::int AS n
    FROM core.credit cr
    JOIN core.external_id x
      ON x.entity_type = 'person' AND x.entity_id = cr.person_id AND x.source = 'tmdb'
    WHERE cr.title_id = ${titleId}
      AND cr.predicate = 'acted_in'
      AND x.source_id = ANY(${ids}::text[])`;
  return row?.n ?? 0;
}

// ── People ───────────────────────────────────────────────────────────────────

export interface PersonCandidate {
  tmdbId: number;
  imdbId: string | null;
  name: string;
  birthday: string | null;
  /** Canonical title ids this person is already known to be credited on. */
  knownTitleIds: string[];
}

/**
 * Person cascade.
 *
 * Names collide heavily and TMDB itself carries duplicate person records, so
 * we NEVER fuzzy-match a person on name alone. Filmography overlap is the
 * strong signal; the name is the weak one.
 */
export async function resolvePerson(sql: Sql, c: PersonCandidate): Promise<Resolution> {
  const byTmdb = await findByExternalId(sql, 'tmdb', String(c.tmdbId), 'person');
  if (byTmdb) {
    await linkExternalId(sql, 'tmdb', String(c.tmdbId), 'person', byTmdb, true);
    if (c.imdbId) await linkExternalId(sql, 'imdb', c.imdbId, 'person', byTmdb, false);
    return { entityId: byTmdb, method: 'external_id', created: false };
  }

  if (c.imdbId) {
    const byImdb = await findByExternalId(sql, 'imdb', c.imdbId, 'person');
    if (byImdb) {
      await linkExternalId(sql, 'tmdb', String(c.tmdbId), 'person', byImdb, true);
      return { entityId: byImdb, method: 'crosswalk', created: false };
    }
  }

  // Exact normalized name only — no trigram fuzz for people.
  const normalized = normalizePersonName(c.name);
  const sameName = await sql<{ id: string; birthday: string | null }[]>`
    SELECT id, birthday::text FROM core.person
    WHERE sort_name = ${normalizePersonName(c.name).split(' ').reverse().join(' ')}
       OR lower(name) = ${c.name.toLowerCase()}
    LIMIT 5`;

  for (const cand of sameName) {
    const birthdayConflict =
      c.birthday !== null && cand.birthday !== null && c.birthday !== cand.birthday;
    if (birthdayConflict) continue; // Same name, different human.

    const overlap =
      c.knownTitleIds.length === 0
        ? 0
        : ((
            await sql<{ n: number }[]>`
              SELECT count(DISTINCT title_id)::int AS n FROM core.credit
              WHERE person_id = ${cand.id} AND title_id = ANY(${c.knownTitleIds}::uuid[])`
          )[0]?.n ?? 0);

    if (overlap >= 2) {
      await linkExternalId(sql, 'tmdb', String(c.tmdbId), 'person', cand.id, true);
      if (c.imdbId) await linkExternalId(sql, 'imdb', c.imdbId, 'person', cand.id, false);
      return { entityId: cand.id, method: 'fuzzy_corroborated', created: false };
    }

    /**
     * ZERO overlap is NOT ambiguity — it is evidence of two different people.
     *
     * The first version queued every name collision, and the queue filled with
     * 206 items that were all correct refusals: Steve McQueen the actor and
     * Steve McQueen the director, Graham Greene the novelist and Graham Greene
     * the actor, John Williams the composer and several John Williams who act.
     * No human will ever work through a queue of obviously-different people,
     * and a review queue nobody reads is worse than none — it buries the cases
     * that genuinely need a decision.
     *
     * So only the middle band is queued: exactly one shared title, which is
     * too little to merge on and too much to dismiss. A matching birthday with
     * no shared work is also queued, because that combination is suspicious.
     *
     * The cost of being wrong here is asymmetric and in our favor: a missed
     * merge leaves a duplicate, which mergeEntities() fixes later. A wrong
     * merge destroys two identities and needs a revert.
     */
    const birthdayMatches =
      c.birthday !== null && cand.birthday !== null && c.birthday === cand.birthday;
    if (overlap === 1 || birthdayMatches) {
      await queueReview(sql, 'person', 'tmdb', String(c.tmdbId), cand.id, 1.0, {
        incoming: { name: c.name, birthday: c.birthday, normalized },
        candidate_birthday: cand.birthday,
        filmography_overlap: overlap,
        reason: birthdayMatches
          ? 'identical name and birthday, but no shared filmography'
          : 'identical name, exactly one shared title',
      });
    }
  }

  return { entityId: '', method: 'created', created: true };
}

// ── Merge and revert ─────────────────────────────────────────────────────────

/**
 * Merge two entities, REVERSIBLY.
 *
 * The merged row is snapshotted into core.merge_log along with the exact ids of
 * every credit and edge that moved, so revertMerge() can put everything back.
 * The only thing worse than a duplicate is an irreversible wrong merge — and
 * automated resolution will occasionally be wrong, which is the entire reason
 * the review queue exists.
 */
export async function mergeEntities(
  sql: Sql,
  entityType: 'title' | 'person',
  survivingId: string,
  mergedId: string,
  reason: string,
  evidence: Record<string, unknown> = {},
): Promise<{ mergeId: string; repointed: number; collapsed: number }> {
  if (survivingId === mergedId)
    throw new Error('mergeEntities: cannot merge an entity into itself');

  return sql.begin(async (tx) => {
    const [snapshot] =
      entityType === 'title'
        ? await tx`SELECT * FROM core.title WHERE id = ${mergedId}`
        : await tx`SELECT * FROM core.person WHERE id = ${mergedId}`;
    if (!snapshot) throw new Error(`mergeEntities: ${entityType} ${mergedId} does not exist`);

    const displayName = (entityType === 'title' ? snapshot.title : snapshot.name) as string;

    // Which external ids move, so revert can move exactly those back.
    const movedExternal = await tx<{ source: string; source_id: string }[]>`
      SELECT source, source_id FROM core.external_id
      WHERE entity_type = ${entityType} AND entity_id = ${mergedId}`;

    const movedCredits =
      entityType === 'person'
        ? await tx<{ id: string }[]>`
            UPDATE core.credit SET person_id = ${survivingId}
            WHERE person_id = ${mergedId} RETURNING id`
        : await tx<{ id: string }[]>`
            UPDATE core.credit SET title_id = ${survivingId}
            WHERE title_id = ${mergedId} RETURNING id`;

    // Edges may collide with one already on the survivor. The unique constraint
    // would abort the whole merge, so collapse duplicates explicitly and count
    // them — a silent DO NOTHING would hide real data loss.
    const collidingSubjects = await tx<{ id: string }[]>`
      DELETE FROM core.edge e
      WHERE e.subject_type = ${entityType} AND e.subject_id = ${mergedId}
        AND EXISTS (SELECT 1 FROM core.edge s
                    WHERE s.subject_type = ${entityType} AND s.subject_id = ${survivingId}
                      AND s.predicate = e.predicate
                      AND s.object_type = e.object_type AND s.object_id = e.object_id)
      RETURNING e.id`;
    const collidingObjects = await tx<{ id: string }[]>`
      DELETE FROM core.edge e
      WHERE e.object_type = ${entityType} AND e.object_id = ${mergedId}
        AND EXISTS (SELECT 1 FROM core.edge s
                    WHERE s.object_type = ${entityType} AND s.object_id = ${survivingId}
                      AND s.predicate = e.predicate
                      AND s.subject_type = e.subject_type AND s.subject_id = e.subject_id)
      RETURNING e.id`;

    const movedSubjectEdges = await tx<{ id: string }[]>`
      UPDATE core.edge SET subject_id = ${survivingId}
      WHERE subject_type = ${entityType} AND subject_id = ${mergedId} RETURNING id`;
    const movedObjectEdges = await tx<{ id: string }[]>`
      UPDATE core.edge SET object_id = ${survivingId}
      WHERE object_type = ${entityType} AND object_id = ${mergedId} RETURNING id`;

    if (entityType === 'title') {
      await tx`UPDATE core.season SET title_id = ${survivingId} WHERE title_id = ${mergedId}`;
      await tx`UPDATE core.episode SET title_id = ${survivingId} WHERE title_id = ${mergedId}`;
    }

    await tx`UPDATE core.external_id SET entity_id = ${survivingId}
             WHERE entity_type = ${entityType} AND entity_id = ${mergedId}`;

    // Keep the merged name searchable without keeping the entity.
    await tx`INSERT INTO core.entity_alias (entity_type, entity_id, alias, alias_type)
             VALUES (${entityType}, ${survivingId}, ${displayName}, 'merged_from')`;

    if (entityType === 'title') await tx`DELETE FROM core.title WHERE id = ${mergedId}`;
    else await tx`DELETE FROM core.person WHERE id = ${mergedId}`;

    const collapsed = collidingSubjects.length + collidingObjects.length;
    const [log] = await tx<{ id: string }[]>`
      INSERT INTO core.merge_log (entity_type, surviving_id, merged_id, reason, evidence, merged_by)
      VALUES (${entityType}, ${survivingId}, ${mergedId}, ${reason},
              ${tx.json({
                ...evidence,
                snapshot,
                moved_external_ids: movedExternal,
                moved_credit_ids: movedCredits.map((r) => r.id),
                moved_subject_edge_ids: movedSubjectEdges.map((r) => r.id),
                moved_object_edge_ids: movedObjectEdges.map((r) => r.id),
                collapsed_edge_count: collapsed,
                display_name: displayName,
              } as never)}, 'ingest')
      RETURNING id`;

    return {
      mergeId: log!.id,
      repointed: movedCredits.length + movedSubjectEdges.length + movedObjectEdges.length,
      collapsed,
    };
  });
}

/**
 * Undo a merge. Restores the snapshotted row and moves back exactly the
 * credits, edges and external ids that were recorded as having moved.
 *
 * Edges collapsed as duplicates are NOT restored — they were genuinely
 * redundant, and the count is in the log. Everything else round-trips.
 */
export async function revertMerge(sql: Sql, mergeId: string): Promise<void> {
  await sql.begin(async (tx) => {
    const [log] = await tx<
      {
        entity_type: 'title' | 'person';
        surviving_id: string;
        merged_id: string;
        evidence: Record<string, unknown>;
        reverted_at: string | null;
      }[]
    >`SELECT entity_type, surviving_id, merged_id, evidence, reverted_at
         FROM core.merge_log WHERE id = ${mergeId}`;
    if (!log) throw new Error(`revertMerge: no merge ${mergeId}`);
    if (log.reverted_at) throw new Error(`revertMerge: ${mergeId} was already reverted`);

    const ev = log.evidence;
    const snapshot = ev.snapshot as Record<string, unknown>;
    const cols = Object.keys(snapshot);

    if (log.entity_type === 'title') {
      await tx`INSERT INTO core.title ${tx(snapshot, ...cols)}`;
    } else {
      await tx`INSERT INTO core.person ${tx(snapshot, ...cols)}`;
    }

    const creditIds = (ev.moved_credit_ids as string[]) ?? [];
    if (creditIds.length > 0) {
      if (log.entity_type === 'person') {
        await tx`UPDATE core.credit SET person_id = ${log.merged_id}
                 WHERE id = ANY(${creditIds}::uuid[])`;
      } else {
        await tx`UPDATE core.credit SET title_id = ${log.merged_id}
                 WHERE id = ANY(${creditIds}::uuid[])`;
      }
    }

    const subjEdges = (ev.moved_subject_edge_ids as string[]) ?? [];
    if (subjEdges.length > 0) {
      await tx`UPDATE core.edge SET subject_id = ${log.merged_id}
               WHERE id = ANY(${subjEdges}::uuid[])`;
    }
    const objEdges = (ev.moved_object_edge_ids as string[]) ?? [];
    if (objEdges.length > 0) {
      await tx`UPDATE core.edge SET object_id = ${log.merged_id}
               WHERE id = ANY(${objEdges}::uuid[])`;
    }

    for (const x of (ev.moved_external_ids as { source: string; source_id: string }[]) ?? []) {
      await tx`UPDATE core.external_id SET entity_id = ${log.merged_id}
               WHERE source = ${x.source} AND source_id = ${x.source_id}
                 AND entity_type = ${log.entity_type}`;
    }

    await tx`DELETE FROM core.entity_alias
             WHERE entity_type = ${log.entity_type} AND entity_id = ${log.surviving_id}
               AND alias = ${String(ev.display_name)} AND alias_type = 'merged_from'`;

    await tx`UPDATE core.merge_log SET reverted_at = now() WHERE id = ${mergeId}`;
  });
}
