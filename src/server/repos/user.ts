import { sql } from 'drizzle-orm';
import { withUser, type Tx } from '../db/client';
import type { DatePrecision, Medium, Status } from '@/lib/tracking';
import { starsToValue } from '@/lib/tracking';

/**
 * The personal layer. EVERY function here takes accountId as its first
 * parameter and goes through withUser().
 *
 * The explicit parameter is not redundant with RLS -- it makes "did we scope
 * this?" visible at the call site and greppable in review, and RLS is the net
 * underneath if a call site gets it wrong. See docs/security.md.
 */

/** drizzle's execute() returns a driver-shaped result; this narrows it. */
async function rows<T>(tx: Tx, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await tx.execute(query)) as unknown as T[];
}

export interface UserTitle {
  title_id: string;
  kind: string;
  status: Status;
  is_favorite: boolean;
  added_at: string;
  updated_at: string;
  completed_at: string | null;
  /** 0.5-5.0, or null. */
  rating: string | null;
  view_count: number;
  last_watched_on: string | null;
  days_on_watchlist: number;
  episodes_watched: number | null;
  episodes_aired: number | null;
  progress_pct: number | null;
  next_episode_id: string | null;
  season_number: number | null;
  episode_number: number | null;
  next_episode_name: string | null;
  next_episode_air_date: string | null;
}

export async function getUserTitle(accountId: string, titleId: string): Promise<UserTitle | null> {
  return withUser(accountId, async (tx) => {
    const r = await rows<UserTitle>(
      tx,
      sql`SELECT * FROM sem.user_title WHERE account_id = ${accountId} AND title_id = ${titleId}`,
    );
    return r[0] ?? null;
  });
}

/**
 * Set the standing relationship with a title.
 *
 * Every transition is legal -- people correct mistakes, and refusing a
 * "wrong" one just means the app disagrees with the person using it. All of
 * them are logged. A no-op re-set is NOT logged, because a log full of
 * "watched -> watched" makes the real transitions unfindable.
 */
export async function setStatus(
  accountId: string,
  titleId: string,
  status: Status,
  source: 'manual' | 'auto_from_viewing' | 'auto_from_episode' = 'manual',
): Promise<{ from: Status | null; to: Status }> {
  return withUser(accountId, async (tx) => {
    const prev = await rows<{ status: Status }>(
      tx,
      sql`SELECT status FROM usr.title_state
          WHERE account_id = ${accountId} AND title_id = ${titleId}`,
    );
    const from = prev[0]?.status ?? null;

    await tx.execute(sql`
      INSERT INTO usr.title_state (account_id, title_id, status, started_at, completed_at)
      VALUES (${accountId}, ${titleId}, ${status},
              CASE WHEN ${status} IN ('watching', 'watched') THEN now() END,
              CASE WHEN ${status} = 'watched' THEN now() END)
      ON CONFLICT (account_id, title_id) DO UPDATE SET
        status = excluded.status,
        updated_at = now(),
        -- started_at is when you FIRST began, so it never moves once set.
        started_at = COALESCE(usr.title_state.started_at, excluded.started_at),
        completed_at = CASE
          WHEN excluded.status = 'watched'
            THEN COALESCE(usr.title_state.completed_at, now())
          ELSE usr.title_state.completed_at
        END`);

    if (from !== status) {
      await tx.execute(sql`
        INSERT INTO usr.state_event (account_id, title_id, event_kind, from_status, to_status, source)
        VALUES (${accountId}, ${titleId}, 'status_change', ${from}, ${status}, ${source})`);
    }
    return { from, to: status };
  });
}

/**
 * Affinity, not judgment, and orthogonal to status (docs/adr/0005) -- you can
 * favorite a show you are midway through. A title favorited before it is
 * tracked gets a watchlist row, because the alternative is a favorite that
 * belongs to nothing.
 */
export async function toggleFavorite(
  accountId: string,
  titleId: string,
): Promise<{ isFavorite: boolean }> {
  return withUser(accountId, async (tx) => {
    const r = await rows<{ is_favorite: boolean }>(
      tx,
      sql`
        INSERT INTO usr.title_state (account_id, title_id, status, is_favorite, favorited_at)
        VALUES (${accountId}, ${titleId}, 'watchlist', true, now())
        ON CONFLICT (account_id, title_id) DO UPDATE SET
          is_favorite = NOT usr.title_state.is_favorite,
          favorited_at = CASE WHEN NOT usr.title_state.is_favorite THEN now() ELSE NULL END,
          updated_at = now()
        RETURNING is_favorite`,
    );
    const isFavorite = r[0]!.is_favorite;
    await tx.execute(sql`
      INSERT INTO usr.state_event (account_id, title_id, event_kind, source)
      VALUES (${accountId}, ${titleId}, ${isFavorite ? 'favorited' : 'unfavorited'}, 'manual')`);
    return { isFavorite };
  });
}

/**
 * Rate in half-stars. History is preserved: the previous rating is superseded,
 * not overwritten, so "3 in 2019, 5 on rewatch" stays representable and the
 * partial unique index keeps exactly one current row.
 */
export async function setRating(
  accountId: string,
  titleId: string,
  stars: number,
): Promise<{ stars: number }> {
  const value = starsToValue(stars);
  return withUser(accountId, async (tx) => {
    await tx.execute(sql`
      UPDATE usr.rating SET superseded_at = now()
      WHERE account_id = ${accountId} AND title_id = ${titleId} AND superseded_at IS NULL`);
    await tx.execute(sql`
      INSERT INTO usr.rating (account_id, title_id, value)
      VALUES (${accountId}, ${titleId}, ${value})`);
    return { stars };
  });
}

/** Clears the current rating without erasing that it was ever rated. */
export async function clearRating(accountId: string, titleId: string): Promise<void> {
  await withUser(accountId, async (tx) => {
    await tx.execute(sql`
      UPDATE usr.rating SET superseded_at = now()
      WHERE account_id = ${accountId} AND title_id = ${titleId} AND superseded_at IS NULL`);
  });
}

/**
 * Every field admits `undefined` explicitly because tsconfig sets
 * exactOptionalPropertyTypes: under that rule `f?: string` means "absent or a
 * string", NOT "may be undefined", and parsed input routinely carries the key
 * with an undefined value.
 */
export interface ViewingDetails {
  watchedOn?: string | null | undefined;
  datePrecision?: DatePrecision | undefined;
  companions?: string[] | null | undefined;
  location?: string | null | undefined;
  medium?: Medium | null | undefined;
  note?: string | null | undefined;
}

/**
 * Record one discrete viewing.
 *
 * is_rewatch is DERIVED, not asked: if a viewing already exists for this
 * title, this one is a rewatch by definition, and making the person tell us
 * something we already know is exactly the friction principle 2 rejects.
 */
export async function logViewing(
  accountId: string,
  titleId: string,
  details: ViewingDetails = {},
): Promise<{ viewingId: string; isRewatch: boolean }> {
  const precision = details.datePrecision ?? 'day';
  const watchedOn = precision === 'unknown' ? null : (details.watchedOn ?? todayIso());
  return withUser(accountId, async (tx) => {
    const r = await rows<{ id: string; is_rewatch: boolean }>(
      tx,
      sql`
        INSERT INTO usr.viewing
          (account_id, title_id, watched_on, date_precision, companions, location, medium, note, is_rewatch)
        VALUES (${accountId}, ${titleId}, ${watchedOn}, ${precision},
                ${details.companions ?? null}, ${details.location ?? null},
                ${details.medium ?? null}, ${details.note ?? null},
                EXISTS (SELECT 1 FROM usr.viewing v
                        WHERE v.account_id = ${accountId} AND v.title_id = ${titleId}
                          AND v.episode_id IS NULL))
        RETURNING id, is_rewatch`,
    );
    return { viewingId: r[0]!.id, isRewatch: r[0]!.is_rewatch };
  });
}

/**
 * The ten-second capture flow (AC-8), as ONE transaction.
 *
 * Status, the event, the viewing and the optional rating either all land or
 * none do. Split across calls, a failure halfway leaves a title marked watched
 * with no viewing behind it -- which is indistinguishable from a retroactive
 * "I saw this years ago" and quietly corrupts every time-series metric.
 */
export async function markWatched(
  accountId: string,
  titleId: string,
  opts: { stars?: number | undefined; details?: ViewingDetails | undefined } = {},
): Promise<{ isRewatch: boolean }> {
  const value = opts.stars === undefined ? null : starsToValue(opts.stars);
  const precision = opts.details?.datePrecision ?? 'day';
  const watchedOn = precision === 'unknown' ? null : (opts.details?.watchedOn ?? todayIso());

  return withUser(accountId, async (tx) => {
    const prev = await rows<{ status: Status }>(
      tx,
      sql`SELECT status FROM usr.title_state
          WHERE account_id = ${accountId} AND title_id = ${titleId}`,
    );
    const from = prev[0]?.status ?? null;

    await tx.execute(sql`
      INSERT INTO usr.title_state (account_id, title_id, status, started_at, completed_at)
      VALUES (${accountId}, ${titleId}, 'watched', now(), now())
      ON CONFLICT (account_id, title_id) DO UPDATE SET
        status = 'watched',
        updated_at = now(),
        started_at = COALESCE(usr.title_state.started_at, now()),
        completed_at = COALESCE(usr.title_state.completed_at, now())`);

    if (from !== 'watched') {
      await tx.execute(sql`
        INSERT INTO usr.state_event (account_id, title_id, event_kind, from_status, to_status, source)
        VALUES (${accountId}, ${titleId}, 'status_change', ${from}, 'watched', 'manual')`);
    }

    const v = await rows<{ id: string; is_rewatch: boolean }>(
      tx,
      sql`
        INSERT INTO usr.viewing
          (account_id, title_id, watched_on, date_precision, companions, location, medium, note, is_rewatch)
        VALUES (${accountId}, ${titleId}, ${watchedOn}, ${precision},
                ${opts.details?.companions ?? null}, ${opts.details?.location ?? null},
                ${opts.details?.medium ?? null}, ${opts.details?.note ?? null},
                EXISTS (SELECT 1 FROM usr.viewing v2
                        WHERE v2.account_id = ${accountId} AND v2.title_id = ${titleId}
                          AND v2.episode_id IS NULL))
        RETURNING id, is_rewatch`,
    );

    if (value !== null) {
      await tx.execute(sql`
        UPDATE usr.rating SET superseded_at = now()
        WHERE account_id = ${accountId} AND title_id = ${titleId} AND superseded_at IS NULL`);
      await tx.execute(sql`
        INSERT INTO usr.rating (account_id, title_id, value, viewing_id)
        VALUES (${accountId}, ${titleId}, ${value}, ${v[0]!.id})`);
    }
    return { isRewatch: v[0]!.is_rewatch };
  });
}

/** Forget a title entirely. The event log keeps that it once mattered. */
export async function removeFromLibrary(accountId: string, titleId: string): Promise<void> {
  await withUser(accountId, async (tx) => {
    await tx.execute(sql`
      DELETE FROM usr.title_state
      WHERE account_id = ${accountId} AND title_id = ${titleId}`);
  });
}

export type LibrarySort = 'added' | 'rating' | 'title' | 'release' | 'runtime' | 'streaming';

export interface LibraryItem extends UserTitle {
  slug: string;
  backdrop_path?: string | null;
  title: string;
  release_year: number | null;
  poster_path: string | null;
  runtime_minutes: number | null;
  genres: string[];
}

/**
 * One Library segment.
 *
 * 'favorites' is not a status, so it is a separate argument rather than a
 * fifth status value -- the moment it becomes one, a favorited show you are
 * midway through has to stop being 'watching'.
 */
export async function listLibrary(
  accountId: string,
  opts: {
    status?: Status;
    favoritesOnly?: boolean;
    sort?: LibrarySort;
    limit?: number;
    region?: string;
    /** One genre label, exactly as it appears in sem.title.genres. */
    genre?: string;
  } = {},
): Promise<LibraryItem[]> {
  const sort = opts.sort ?? 'added';
  const limit = opts.limit ?? 200;
  const region = (opts.region ?? 'US').toUpperCase();
  return withUser(accountId, async (tx) => {
    // Sort is a closed set mapped to fixed SQL; the value never reaches the
    // query as text. See docs/security.md on dynamic SQL.
    const order = {
      added: sql`ut.added_at DESC`,
      rating: sql`ut.rating DESC NULLS LAST, ut.added_at DESC`,
      title: sql`t.title ASC`,
      release: sql`t.release_date DESC NULLS LAST`,
      runtime: sql`t.runtime_minutes ASC NULLS LAST`,
      /* "What can I actually put on right now." Only the subscription-like
         offers count -- rent and buy are available for almost everything, so
         including them would sort nothing. */
      streaming: sql`
        EXISTS (
          SELECT 1 FROM sem.availability a
          WHERE a.title_id = ut.title_id AND a.region = ${region}
            AND a.offer_type IN ('flatrate', 'free', 'ads')
        ) DESC,
        ut.added_at DESC`,
    }[sort];

    return rows<LibraryItem>(
      tx,
      sql`
        SELECT ut.*, t.slug, t.title, t.release_year, t.poster_path,
               t.runtime_minutes, t.genres
        FROM sem.user_title ut
        JOIN sem.title t ON t.id = ut.title_id
        WHERE ut.account_id = ${accountId}
          ${opts.status ? sql`AND ut.status = ${opts.status}` : sql``}
          ${opts.favoritesOnly ? sql`AND ut.is_favorite` : sql``}
          ${opts.genre ? sql`AND ${opts.genre} = ANY(t.genres)` : sql``}
        ORDER BY ${order}
        LIMIT ${limit}`,
    );
  });
}

/**
 * Shows in progress, for Continue Watching -- the highest-value module on Home.
 *
 * A show you are caught up on is deliberately EXCLUDED: with no unwatched
 * aired episode there is nothing to continue, and leaving it in makes the rail
 * a list of things you cannot act on. Shows with no episodes ingested yet fall
 * out too, since next_episode_id is null until hydrate_episodes runs.
 */
export async function continueWatching(accountId: string, limit = 12): Promise<LibraryItem[]> {
  return withUser(accountId, async (tx) =>
    rows<LibraryItem>(
      tx,
      sql`
        SELECT ut.*, t.slug, t.title, t.release_year, t.poster_path,
               t.runtime_minutes, t.genres, t.backdrop_path
        FROM sem.user_title ut
        JOIN sem.title t ON t.id = ut.title_id
        WHERE ut.account_id = ${accountId}
          AND ut.status = 'watching'
          AND ut.next_episode_id IS NOT NULL
        ORDER BY ut.updated_at DESC, ut.added_at DESC
        LIMIT ${limit}`,
    ),
  );
}

/** Most recently watched, for the Home strip. */
export async function recentlyWatched(accountId: string, limit = 12): Promise<LibraryItem[]> {
  return withUser(accountId, async (tx) =>
    rows<LibraryItem>(
      tx,
      sql`
        SELECT ut.*, t.slug, t.title, t.release_year, t.poster_path,
               t.runtime_minutes, t.genres
        FROM sem.user_title ut
        JOIN sem.title t ON t.id = ut.title_id
        WHERE ut.account_id = ${accountId} AND ut.status = 'watched'
        ORDER BY COALESCE(ut.last_watched_on, ut.completed_at::date) DESC NULLS LAST
        LIMIT ${limit}`,
    ),
  );
}

/** Counts for the segmented control, in one round trip rather than five. */
/**
 * The genres actually present in one segment of a library, with counts.
 *
 * Derived from the reader's own rows rather than from the nineteen TMDB
 * genres, so every chip offered returns something. A filter that can produce
 * an empty result is a filter you have to test by clicking, and a list of
 * nineteen options over a library of forty titles is mostly dead ends.
 *
 * Counted under the same row-level policy as the list it filters, so the
 * numbers on the chips and the rows behind them cannot disagree.
 */
export async function libraryGenres(
  accountId: string,
  opts: { status?: Status; favoritesOnly?: boolean } = {},
): Promise<{ genre: string; n: number }[]> {
  return withUser(accountId, async (tx) =>
    rows<{ genre: string; n: number }>(
      tx,
      sql`
        SELECT g AS genre, count(*)::int AS n
        FROM sem.user_title ut
        JOIN sem.title t ON t.id = ut.title_id
        CROSS JOIN LATERAL unnest(t.genres) AS g
        WHERE ut.account_id = ${accountId}
          ${opts.status ? sql`AND ut.status = ${opts.status}` : sql``}
          ${opts.favoritesOnly ? sql`AND ut.is_favorite` : sql``}
        GROUP BY g
        ORDER BY n DESC, g`,
    ),
  );
}

export async function libraryCounts(accountId: string): Promise<Record<string, number>> {
  return withUser(accountId, async (tx) => {
    const r = await rows<{
      watchlist: number;
      watching: number;
      watched: number;
      favorites: number;
    }>(
      tx,
      sql`
        SELECT count(*) FILTER (WHERE status = 'watchlist')::int AS watchlist,
               count(*) FILTER (WHERE status = 'watching')::int  AS watching,
               count(*) FILTER (WHERE status = 'watched')::int   AS watched,
               count(*) FILTER (WHERE is_favorite)::int          AS favorites
        FROM sem.user_title WHERE account_id = ${accountId}`,
    );
    return r[0] as unknown as Record<string, number>;
  });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The account's region, for availability.
 *
 * Falls back to US rather than throwing: a missing region should narrow what
 * we can tell someone, not break their title page. The column is NOT NULL
 * with a default today, so the fallback is for the case where it stops being.
 */
export async function accountRegion(accountId: string): Promise<string> {
  const rows = await withUser(
    accountId,
    async (tx) =>
      (await tx.execute(
        sql`SELECT region FROM usr.account WHERE id = ${accountId}::uuid`,
      )) as unknown as { region: string | null }[],
  );
  return (rows[0]?.region ?? 'US').trim().toUpperCase() || 'US';
}

/**
 * Which of these titles the account already tracks.
 *
 * The personal layer drawn over the global graph: "you have seen 4 of
 * Villeneuve's 11" is the clearest single statement of what this whole
 * architecture is for, and it needs exactly this -- an intersection, computed
 * where the row-level policy can enforce it.
 *
 * Takes the ids to check rather than returning the whole library, because the
 * caller already has a bounded neighborhood and the library may not be.
 */
export async function trackedAmong(accountId: string, titleIds: string[]): Promise<Set<string>> {
  if (titleIds.length === 0) return new Set();

  /**
   * IN with an expanded parameter list, not ANY(array), and the distinction is
   * not cosmetic.
   *
   * This file uses DRIZZLE's sql template; the graph engine uses postgres.js's.
   * They look identical and interpolate arrays differently: postgres.js sends
   * a real Postgres array, so `= ANY(${ids})` is right there, while drizzle
   * expands the array into a parameter list, which Postgres reads as a record
   * and rejects with "op ANY/ALL (array) requires array on right side".
   *
   * It cost a debugging round because the first symptom was not an error
   * message -- the page just quietly rendered its empty state.
   */
  return withUser(accountId, async (tx) => {
    const found = (await tx.execute(
      sql`SELECT title_id FROM usr.title_state
          WHERE account_id = ${accountId}::uuid
            AND title_id IN (${sql.join(
              titleIds.map((id) => sql`${id}::uuid`),
              sql`, `,
            )})`,
    )) as unknown as { title_id: string }[];
    return new Set(found.map((r) => r.title_id));
  });
}
