import type { Sql } from '../ingest/resolve';
import { deriveThemes } from '../ingest/derive-themes';
import { deriveSimilar } from '../ingest/derive-similar';
import { enrichWikidata } from '../ingest/enrich-wikidata';
import { Ingestor } from '../ingest/ingest';
import { TmdbClient } from '../providers/tmdb/client';

export interface Job {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/**
 * Job handlers. Each is idempotent, because a job can be retried after a
 * partial failure and must not double-write.
 */
export type Handler = (sql: Sql, payload: Record<string, unknown>) => Promise<void>;

const captureRaw =
  (sql: Sql) =>
  async (resource: string, sourceId: string, variant: string, payload: unknown, status: number) => {
    await sql`INSERT INTO raw.tmdb_payload (resource, source_id, variant, payload, http_status)
              VALUES (${resource}, ${sourceId}, ${variant}, ${sql.json(payload as never)}, ${status})
              ON CONFLICT (resource, source_id, variant)
              DO UPDATE SET payload = excluded.payload, fetched_at = now()`;
  };

/**
 * Titles per enrich_wikidata job: ONE SPARQL batch.
 *
 * Four batches (240) blew the 60s function limit in production. The drain's
 * 45s budget does not help here -- it is checked between jobs, so a single
 * long job takes the whole function down with it. One batch runs in a few
 * seconds, and the job chains, so the only cost of a small window is more
 * rows in the queue.
 */
const WIKIDATA_TITLES_PER_JOB = 60;

export const HANDLERS: Record<string, Handler> = {
  /** Fetch a title's full record and write it to core. The lazy-ingest path. */
  hydrate_title: async (sql, payload) => {
    const tmdbId = Number(payload.tmdbId);
    const kind = String(payload.kind);
    if (!Number.isFinite(tmdbId)) throw new Error('hydrate_title: tmdbId required');
    const ing = new Ingestor(sql, new TmdbClient(undefined, captureRaw(sql)));
    if (kind === 'show') await ing.ingestShow(tmdbId);
    else await ing.ingestMovie(tmdbId);
  },

  /**
   * Rebuild the curated theme layer from the crosswalk. Runs as a job because
   * the vocabulary has to be applied where the database is, and production's
   * connection string is deliberately unreachable from a laptop.
   *
   * Idempotent and safe to re-run: it rebuilds crosswalk rows wholesale and
   * replaces its own edges (source = 'crosswalk'), touching nothing asserted.
   * Enqueue it after a bulk ingest, since newly hydrated titles arrive with
   * keywords but no themes.
   */
  derive_themes: async (sql) => {
    await deriveThemes(sql);
  },

  /**
   * Fetch every episode of one show. Enqueued when someone starts tracking it.
   *
   * Episodes are not ingested up front: the corpus is ~1,026 seasons, and
   * pulling all of them would be a thousand requests for data nobody reads.
   * Progress, Continue Watching and the episode list all need them, so the
   * trigger is the moment a show enters someone's library.
   */
  hydrate_episodes: async (sql, payload) => {
    const tmdbId = Number(payload.tmdbId);
    if (!Number.isFinite(tmdbId)) throw new Error('hydrate_episodes: tmdbId required');
    const ing = new Ingestor(sql, new TmdbClient(undefined, captureRaw(sql)));
    await ing.ingestEpisodes(tmdbId);
  },

  /**
   * Pull the relationships TMDB does not model -- adaptation sources,
   * franchise membership, influence -- from Wikidata.
   *
   * CHUNKED AND SELF-CHAINING. A full pass is ~83 SPARQL round trips against a
   * shared public endpoint, far beyond one function's budget, so each run
   * handles a window and enqueues the next. Enqueue it once with no payload
   * and the queue walks the whole corpus.
   *
   * It enqueues its successor with raw SQL rather than the enqueue helper
   * because that helper imports this module -- going through it would make the
   * cycle real.
   */
  enrich_wikidata: async (sql, payload) => {
    const offset = Number(payload.offset ?? 0);
    const result = await enrichWikidata(sql, { offset, maxTitles: WIKIDATA_TITLES_PER_JOB });
    if (result.nextOffset !== null) {
      await sql`SELECT core.enqueue_job('enrich_wikidata',
                  ${sql.json({ offset: result.nextOffset } as never)})`;
    }
  },

  /**
   * Rebuild similar_to. Weekly, and after any bulk ingest or theme change.
   *
   * Writes only to core.edge_derived, which is separately truncatable, so a
   * bad scoring run can never damage a provider fact or a curated one. Safe to
   * re-run: it clears its own method's rows first.
   */
  recompute_similar: async (sql) => {
    await deriveSimilar(sql);
  },

  /**
   * Re-sync the STALEST titles from TMDB.
   *
   * Nothing refreshed anything. After the initial seed, a title's data was
   * frozen at its synced_at forever: ratings, runtimes, posters, and the air
   * dates of shows still in production. /api/health even measured
   * pct_fresh -- and reported it without ever checking it, so the number was
   * going to read 0% within two days and nothing would have said a word.
   *
   * Priority order is deliberate. Titles someone actually TRACKS come first,
   * then anything whose release is recent or still ahead (those are the
   * records that genuinely change), then the rest by age. A flat "oldest
   * first" pass would spend the budget refreshing catalog films from 1974
   * whose facts have not moved in fifty years.
   */
  refresh_stale: async (sql, payload) => {
    const batch = Math.min(Number(payload.batch ?? 60), 200);
    const rows = await sql<{ tmdb_id: string; kind: string }[]>`
      SELECT x.source_id AS tmdb_id, t.kind
      FROM core.title t
      JOIN core.external_id x
        ON x.entity_type = 'title' AND x.entity_id = t.id AND x.source = 'tmdb'
      WHERE t.synced_at < now() - interval '7 days'
      ORDER BY
        EXISTS (SELECT 1 FROM usr.title_state ts WHERE ts.title_id = t.id) DESC,
        (t.release_date IS NULL OR t.release_date > now()::date - interval '180 days') DESC,
        t.synced_at ASC
      LIMIT ${batch}`;

    if (rows.length === 0) return;

    const ing = new Ingestor(sql, new TmdbClient(undefined, captureRaw(sql)));
    for (const r of rows) {
      const tmdbId = Number(r.tmdb_id);
      if (!Number.isFinite(tmdbId)) continue;
      if (r.kind === 'show') await ing.ingestShow(tmdbId);
      else await ing.ingestMovie(tmdbId);
    }

    // Chain while stale titles remain, the way the Wikidata walk does, so one
    // nightly trigger works through the backlog instead of nibbling at it.
    const [more] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM core.title
      WHERE synced_at < now() - interval '7 days'`;
    if ((more?.n ?? 0) > 0) {
      await sql`SELECT core.enqueue_job('refresh_stale', ${sql.json({ batch } as never)})`;
    }
  },

  /**
   * Backfill people who have never had their own record fetched.
   *
   * Chains like the Wikidata walk. Ordered by popularity so the names anyone
   * is likely to open arrive first: 58,714 people is far more than anybody
   * browses, and a flat pass would spend a week on bit players before
   * reaching a lead.
   */
  hydrate_people: async (sql, payload) => {
    const batch = Math.min(Number(payload.batch ?? 25), 100);
    const rows = await sql<{ tmdb_id: string }[]>`
      SELECT x.source_id AS tmdb_id
      FROM core.person p
      JOIN core.external_id x
        ON x.entity_type = 'person' AND x.entity_id = p.id AND x.source = 'tmdb'
      WHERE p.detail_synced_at IS NULL
      ORDER BY p.popularity DESC NULLS LAST
      LIMIT ${batch}`;
    if (rows.length === 0) return;

    const ing = new Ingestor(sql, new TmdbClient(undefined, captureRaw(sql)));
    for (const r of rows) {
      const id = Number(r.tmdb_id);
      if (Number.isFinite(id)) await ing.hydratePerson(id);
    }

    const [more] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM core.person WHERE detail_synced_at IS NULL`;
    if ((more?.n ?? 0) > 0) {
      await sql`SELECT core.enqueue_job('hydrate_people', ${sql.json({ batch } as never)})`;
    }
  },

  /** Nightly. Node degree drives the hub penalty in path ranking. */
  refresh_degree: async (sql) => {
    await sql`REFRESH MATERIALIZED VIEW CONCURRENTLY core.node_degree`;
  },

  /**
   * Nightly. Prune raw payloads older than 90 days, expire revoked shares,
   * and run the data-quality checks that feed /api/health.
   */
  housekeeping: async (sql) => {
    await sql`DELETE FROM raw.tmdb_payload
              WHERE fetched_at < now() - interval '90 days' AND pruned_at IS NULL`;
    await sql`ANALYZE core.title, core.person, core.credit, core.edge`;
  },
};

export async function runJob(sql: Sql, job: Job): Promise<void> {
  const handler = HANDLERS[job.kind];
  if (!handler) throw new Error(`no handler registered for job kind '${job.kind}'`);
  await handler(sql, job.payload);
}
