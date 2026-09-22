import { sql } from 'drizzle-orm';
import { withUser, type Tx } from '../db/client';

/**
 * Taking your data with you, and taking it away.
 *
 * Both halves read only through sem.* and usr.*, scoped by withUser, so the
 * export cannot accidentally widen: an unscoped query here returns zero rows
 * rather than everyone's, because RLS is doing the filtering underneath.
 */

async function rows<T>(tx: Tx, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await tx.execute(query)) as unknown as T[];
}

export interface ExportedTitle {
  title: string;
  year: number | null;
  kind: string;
  status: string;
  rating: number | null;
  is_favorite: boolean;
  added_at: string | null;
  first_watched_on: string | null;
  last_watched_on: string | null;
  view_count: number;
  episodes_watched: number;
  tmdb_id: string | null;
}

export interface ExportedViewing {
  title: string;
  watched_on: string | null;
  date_precision: string;
  companions: string[] | null;
  location: string | null;
  medium: string | null;
  is_rewatch: boolean;
  note: string | null;
}

export interface AccountExport {
  exported_at: string;
  account: {
    email: string;
    display_name: string | null;
    created_at: string;
  };
  titles: ExportedTitle[];
  viewings: ExportedViewing[];
  episodes: { title: string; season: number; episode: number; watched_at: string }[];
  ratings: { title: string; value: number; rated_at: string; superseded_at: string | null }[];
  notes: { subject_type: string; body: string; created_at: string }[];
  shares: { slug: string; title: string; created_at: string; revoked_at: string | null }[];
  state_events: { title: string; from_status: string | null; to_status: string; at: string }[];
}

/**
 * Everything the person put in, and nothing else.
 *
 * Deliberately absent: sessions and verification tokens. They are credentials,
 * not data -- exporting them would hand a copy of a live session to whatever
 * the file is later mailed through, and they tell the person nothing.
 *
 * tmdb_id is included because an export nobody can reconcile against another
 * service is a souvenir, not a portable record. It is the one place in the app
 * a provider id is deliberately surfaced.
 */
export async function exportAccount(accountId: string): Promise<AccountExport> {
  return withUser(accountId, async (tx) => {
    const [account] = await rows<{ email: string; display_name: string; created_at: string }>(
      tx,
      sql`SELECT email::text, display_name, created_at::text
          FROM usr.account WHERE id = ${accountId}::uuid`,
    );

    const titles = await rows<ExportedTitle>(
      tx,
      sql`SELECT t.title, t.release_year AS year, t.tmdb_id,
                 ut.kind, ut.status, ut.rating, ut.is_favorite,
                 ut.added_at::text, ut.first_watched_on::text, ut.last_watched_on::text,
                 ut.view_count, ut.episodes_watched
          FROM sem.user_title ut
          JOIN sem.title t ON t.id = ut.title_id
          ORDER BY t.title`,
    );

    const viewings = await rows<ExportedViewing>(
      tx,
      sql`SELECT t.title, v.watched_on::text, v.date_precision, v.companions,
                 v.location, v.medium, v.is_rewatch, v.note
          FROM usr.viewing v JOIN sem.title t ON t.id = v.title_id
          ORDER BY v.watched_on DESC NULLS LAST`,
    );

    const episodes = await rows<{
      title: string;
      season: number;
      episode: number;
      watched_at: string;
    }>(
      tx,
      sql`SELECT t.title, e.season_number AS season, e.episode_number AS episode,
                 p.watched_at::text
          FROM usr.episode_progress p
          JOIN sem.episode e ON e.id = p.episode_id
          JOIN sem.title t ON t.id = p.title_id
          ORDER BY t.title, e.season_number, e.episode_number`,
    );

    const ratings = await rows<{
      title: string;
      value: number;
      rated_at: string;
      superseded_at: string | null;
    }>(
      tx,
      sql`SELECT t.title, r.value, r.rated_at::text, r.superseded_at::text
          FROM usr.rating r JOIN sem.title t ON t.id = r.title_id
          ORDER BY r.rated_at DESC`,
    );

    const notes = await rows<{ subject_type: string; body: string; created_at: string }>(
      tx,
      sql`SELECT subject_type, body, created_at::text FROM usr.note ORDER BY created_at DESC`,
    );

    const shares = await rows<{
      slug: string;
      title: string;
      created_at: string;
      revoked_at: string | null;
    }>(
      tx,
      sql`SELECT sh.slug, t.title, sh.created_at::text, sh.revoked_at::text
          FROM usr.share sh JOIN sem.title t ON t.id = sh.title_id
          ORDER BY sh.created_at DESC`,
    );

    const stateEvents = await rows<{
      title: string;
      from_status: string | null;
      to_status: string;
      at: string;
    }>(
      tx,
      sql`SELECT t.title, ev.from_status, ev.to_status, ev.occurred_at::text AS at
          FROM usr.state_event ev JOIN sem.title t ON t.id = ev.title_id
          ORDER BY ev.occurred_at DESC`,
    );

    return {
      exported_at: new Date().toISOString(),
      account: {
        email: account!.email,
        display_name: account!.display_name || null,
        created_at: account!.created_at,
      },
      titles,
      viewings,
      episodes,
      ratings,
      notes,
      shares,
      state_events: stateEvents,
    };
  });
}

export interface DeletionReceipt {
  entity: string;
  rows_deleted: number;
}

/**
 * Hard delete. Removes every usr.* row belonging to the account and leaves
 * core.* untouched -- see usr.delete_account for why that is enforced in the
 * database rather than here.
 */
export async function deleteAccount(accountId: string): Promise<DeletionReceipt[]> {
  return withUser(accountId, (tx) =>
    rows<DeletionReceipt>(tx, sql`SELECT * FROM usr.delete_account(${accountId}::uuid)`),
  );
}
