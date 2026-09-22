import { sql } from 'drizzle-orm';
import { withUser, type Tx } from '../db/client';

/**
 * Episode progress.
 *
 * Everything goes through withUser(): usr.episode_progress is RLS-scoped, and
 * the sem views it joins are security_invoker so the policy binds the caller.
 */

async function rows<T>(tx: Tx, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await tx.execute(query)) as unknown as T[];
}

export interface SeasonSummary {
  id: string;
  season_number: number;
  name: string | null;
  air_date: string | null;
  poster_path: string | null;
  episode_count: number;
  aired_count: number;
  watched_count: number;
}

/** Seasons with the viewer's progress, for the accordion on a show page. */
export async function seasonsForTitle(
  accountId: string,
  titleId: string,
): Promise<SeasonSummary[]> {
  return withUser(accountId, async (tx) =>
    rows<SeasonSummary>(
      tx,
      sql`
        SELECT s.id, s.season_number, s.name, s.air_date, s.poster_path,
               s.episode_count, s.aired_count,
               (SELECT count(*)::int FROM usr.episode_progress p
                 JOIN sem.episode e ON e.id = p.episode_id
                WHERE p.account_id = ${accountId} AND e.season_id = s.id) AS watched_count
        FROM sem.season s
        WHERE s.title_id = ${titleId} AND s.episode_count > 0
        ORDER BY s.season_number`,
    ),
  );
}

export interface EpisodeRow {
  id: string;
  episode_number: number;
  name: string | null;
  overview: string | null;
  air_date: string | null;
  runtime_minutes: number | null;
  still_path: string | null;
  has_aired: boolean;
  watched: boolean;
}

export async function episodesForSeason(
  accountId: string,
  titleId: string,
  seasonNumber: number,
): Promise<EpisodeRow[]> {
  return withUser(accountId, async (tx) =>
    rows<EpisodeRow>(
      tx,
      sql`
        SELECT e.id, e.episode_number, e.name, e.overview, e.air_date,
               e.runtime_minutes, e.still_path, e.has_aired,
               (p.episode_id IS NOT NULL) AS watched
        FROM sem.episode e
        LEFT JOIN usr.episode_progress p
          ON p.episode_id = e.id AND p.account_id = ${accountId}
        WHERE e.title_id = ${titleId} AND e.season_number = ${seasonNumber}
        ORDER BY e.episode_number`,
    ),
  );
}

export interface ProgressResult {
  /** Aired episodes of the whole show that are now watched. */
  watched: number;
  aired: number;
  /** True when this action completed the show, so the UI can ASK, not assume. */
  justCompleted: boolean;
}

/**
 * Mark or unmark one episode, and move the show's status to match.
 *
 * Marking anything on a show you were not watching starts it -- that is
 * unambiguous and doing it silently is right. COMPLETING a show is not: the
 * spec is explicit that finishing prompts rather than transitioning on its
 * own, because "watched" is a judgment about a whole work and people finish
 * the last aired episode of an unfinished series all the time.
 */
export async function setEpisodeWatched(
  accountId: string,
  titleId: string,
  episodeId: string,
  watched: boolean,
): Promise<ProgressResult> {
  return withUser(accountId, async (tx) => {
    if (watched) {
      await tx.execute(sql`
        INSERT INTO usr.episode_progress (account_id, episode_id, title_id)
        VALUES (${accountId}, ${episodeId}, ${titleId})
        ON CONFLICT (account_id, episode_id) DO NOTHING`);
    } else {
      await tx.execute(sql`
        DELETE FROM usr.episode_progress
        WHERE account_id = ${accountId} AND episode_id = ${episodeId}`);
    }
    return afterProgress(tx, accountId, titleId);
  });
}

/**
 * Mark everything up to and including one episode.
 *
 * This is the real-world behavior almost every tracker omits: you do not tick
 * forty boxes, you say "I'm here". Ordered by (season, episode) rather than by
 * episode id, because ids are time-sorted by INGEST order and specials sit in
 * season 0.
 */
export async function markThrough(
  accountId: string,
  titleId: string,
  episodeId: string,
): Promise<ProgressResult> {
  return withUser(accountId, async (tx) => {
    await tx.execute(sql`
      INSERT INTO usr.episode_progress (account_id, episode_id, title_id)
      SELECT ${accountId}, e.id, ${titleId}
      FROM sem.episode e
      WHERE e.title_id = ${titleId}
        AND e.has_aired
        -- Two COLUMNS, not one composite value: a row comparison needs the
        -- subquery to yield (a, b), and SELECT (a, b) yields a single record.
        AND (e.season_number, e.episode_number) <= (
          SELECT t.season_number, t.episode_number
          FROM sem.episode t WHERE t.id = ${episodeId}
        )
      ON CONFLICT (account_id, episode_id) DO NOTHING`);
    return afterProgress(tx, accountId, titleId);
  });
}

/** Every aired episode of one season. */
export async function markSeason(
  accountId: string,
  titleId: string,
  seasonNumber: number,
  watched: boolean,
): Promise<ProgressResult> {
  return withUser(accountId, async (tx) => {
    if (watched) {
      await tx.execute(sql`
        INSERT INTO usr.episode_progress (account_id, episode_id, title_id)
        SELECT ${accountId}, e.id, ${titleId}
        FROM sem.episode e
        WHERE e.title_id = ${titleId} AND e.season_number = ${seasonNumber} AND e.has_aired
        ON CONFLICT (account_id, episode_id) DO NOTHING`);
    } else {
      await tx.execute(sql`
        DELETE FROM usr.episode_progress p
        USING sem.episode e
        WHERE p.episode_id = e.id AND p.account_id = ${accountId}
          AND e.title_id = ${titleId} AND e.season_number = ${seasonNumber}`);
    }
    return afterProgress(tx, accountId, titleId);
  });
}

/**
 * Recount, start the show if it was not started, and report completion.
 *
 * Counted against AIRED episodes, never the advertised total: someone caught
 * up on a show mid-season is at 100%, not 60%, and telling them otherwise is
 * telling them they are behind when they are not.
 */
async function afterProgress(tx: Tx, accountId: string, titleId: string): Promise<ProgressResult> {
  const counts = await rows<{ watched: number; aired: number }>(
    tx,
    sql`
      SELECT
        (SELECT count(*)::int FROM usr.episode_progress p
          WHERE p.account_id = ${accountId} AND p.title_id = ${titleId}) AS watched,
        (SELECT count(*)::int FROM sem.episode e
          WHERE e.title_id = ${titleId} AND e.has_aired)                 AS aired`,
  );
  const { watched, aired } = counts[0]!;

  const prev = await rows<{ status: string }>(
    tx,
    sql`SELECT status FROM usr.title_state
        WHERE account_id = ${accountId} AND title_id = ${titleId}`,
  );
  const from = prev[0]?.status ?? null;

  if (watched > 0 && from !== 'watching' && from !== 'watched') {
    await tx.execute(sql`
      INSERT INTO usr.title_state (account_id, title_id, status, started_at)
      VALUES (${accountId}, ${titleId}, 'watching', now())
      ON CONFLICT (account_id, title_id) DO UPDATE SET
        status = 'watching',
        started_at = COALESCE(usr.title_state.started_at, now()),
        updated_at = now()`);
    await tx.execute(sql`
      INSERT INTO usr.state_event
        (account_id, title_id, event_kind, from_status, to_status, source)
      VALUES (${accountId}, ${titleId}, 'status_change', ${from}, 'watching', 'auto_from_episode')`);
  }

  return {
    watched,
    aired,
    justCompleted: aired > 0 && watched >= aired && from !== 'watched',
  };
}
