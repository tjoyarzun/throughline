import postgres from 'postgres';
import { directDatabaseUrl } from '../db/resolve-url';
import { TmdbClient } from '../providers/tmdb/client';
import { Ingestor } from './ingest';

/**
 * Ingest a single title on first view.
 *
 * Synchronous on purpose. docs/api.md describes enqueueing a hydrate job and
 * rendering a skeleton, but the Hobby plan caps cron at once per DAY — so a
 * queued job would arrive up to 24 hours after the person clicked. Until the
 * drain runs more often, the only honest option is to do the work now and make
 * the person wait the ~2s a TMDB round trip costs.
 *
 * Recorded in docs/deployment.md as one of the three ways out of that
 * constraint; this is the one that costs nothing.
 */
export async function hydrateOnDemand(tmdbId: number, kind: string): Promise<void> {
  const resolved = directDatabaseUrl();
  if (!resolved) throw new Error('hydrateOnDemand: no database configured');

  const sql = postgres(resolved.url, { max: 2, prepare: false, onnotice: () => {} });
  try {
    const captureRaw = async (
      resource: string,
      sourceId: string,
      variant: string,
      payload: unknown,
      status: number,
    ) => {
      await sql`INSERT INTO raw.tmdb_payload (resource, source_id, variant, payload, http_status)
                VALUES (${resource}, ${sourceId}, ${variant}, ${sql.json(payload as never)}, ${status})
                ON CONFLICT (resource, source_id, variant)
                DO UPDATE SET payload = excluded.payload, fetched_at = now()`;
    };
    const ing = new Ingestor(sql, new TmdbClient(undefined, captureRaw));
    if (kind === 'show') await ing.ingestShow(tmdbId);
    else await ing.ingestMovie(tmdbId);
  } finally {
    await sql.end();
  }
}
