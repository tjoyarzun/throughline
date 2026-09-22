import postgres from 'postgres';
import { pooledDatabaseUrl } from '../db/resolve-url';

/**
 * Side effects that tracking triggers in the GLOBAL layer.
 *
 * Kept out of repos/user.ts on purpose: that module is user-scoped and runs
 * inside withUser(). This writes to the job queue, which is not user data, and
 * mixing the two would put a core.* write inside a user transaction.
 */
const resolved = pooledDatabaseUrl();
const sql = resolved
  ? postgres(resolved.url, { max: 2, prepare: false, idle_timeout: 20, onnotice: () => {} })
  : null;

/**
 * Ask for a show's episodes once someone starts tracking it.
 *
 * Silent no-op for movies and for shows whose episodes we already hold.
 * enqueue_job dedupes pending work, so repeated status changes do not pile up
 * duplicate jobs.
 */
export async function enqueueEpisodeHydration(titleId: string): Promise<boolean> {
  if (!sql) return false;
  const [row] = await sql<{ tmdb_id: string }[]>`
    SELECT x.source_id AS tmdb_id
    FROM core.title t
    JOIN core.external_id x ON x.entity_type = 'title' AND x.entity_id = t.id
    WHERE t.id = ${titleId} AND t.kind = 'show' AND x.source = 'tmdb'
      AND NOT EXISTS (SELECT 1 FROM core.episode e WHERE e.title_id = t.id)`;
  if (!row) return false;

  await sql`SELECT core.enqueue_job('hydrate_episodes',
              ${sql.json({ tmdbId: Number(row.tmdb_id) } as never)})`;
  return true;
}
