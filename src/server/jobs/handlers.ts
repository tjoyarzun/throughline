import type { Sql } from '../ingest/resolve';
import { deriveThemes } from '../ingest/derive-themes';
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
