import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { withUser, type Tx } from '../db/client';
import { pooledDatabaseUrl } from '../db/resolve-url';

/**
 * Shares.
 *
 * Two access paths on purpose. Creating, listing and revoking are the owner's
 * operations and go through withUser() like everything else in usr. READING a
 * share is not: the visitor has no session, and the slug itself is the
 * credential. That path goes through usr.share_by_slug, a SECURITY DEFINER
 * function that takes an exact slug and returns at most one row.
 */

const resolved = pooledDatabaseUrl();
const anon = resolved
  ? postgres(resolved.url, { max: 4, prepare: false, idle_timeout: 20, onnotice: () => {} })
  : null;

async function rows<T>(tx: Tx, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await tx.execute(query)) as unknown as T[];
}

/**
 * A share slug is a CAPABILITY: holding it is the permission, so it has to be
 * unguessable. 21 characters of a 64-symbol alphabet is ~126 bits.
 *
 * 64 matters beyond the entropy: 256 divides by it exactly, so reducing a
 * random byte with % introduces no bias toward the front of the alphabet. An
 * alphabet of, say, 62 would quietly make the first two symbols more likely.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

export function shareSlug(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(21));
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export interface CreatedShare {
  slug: string;
  ratingSnapshot: number | null;
}

/**
 * Snapshot, not a live reference.
 *
 * You told someone you gave it four and a half stars. If you re-rate it later
 * the message you already sent must not silently rewrite itself -- so the
 * rating and note are copied at creation and never updated. docs/adr/0008.
 */
export async function createShare(
  accountId: string,
  titleId: string,
  opts: { includeRating?: boolean; message?: string | null } = {},
): Promise<CreatedShare> {
  const includeRating = opts.includeRating ?? true;
  const slug = shareSlug();
  return withUser(accountId, async (tx) => {
    const r = await rows<{ slug: string; rating_snapshot: number | null }>(
      tx,
      sql`
        INSERT INTO usr.share
          (slug, account_id, title_id, include_rating, rating_snapshot, note_snapshot, message)
        SELECT ${slug}, ${accountId}, ${titleId}, ${includeRating},
               CASE WHEN ${includeRating} THEN r.value END,
               n.body,
               ${opts.message ?? null}
        FROM (SELECT 1) one
        LEFT JOIN usr.rating r
          ON r.account_id = ${accountId} AND r.title_id = ${titleId}
         AND r.superseded_at IS NULL
        LEFT JOIN usr.note n
          ON n.account_id = ${accountId} AND n.subject_type = 'title'
         AND n.subject_id = ${titleId} AND NOT n.is_private
        RETURNING slug, rating_snapshot`,
    );
    return { slug: r[0]!.slug, ratingSnapshot: r[0]!.rating_snapshot };
  });
}

export async function revokeShare(accountId: string, slug: string): Promise<void> {
  await withUser(accountId, async (tx) => {
    await tx.execute(sql`
      UPDATE usr.share SET revoked_at = now()
      WHERE account_id = ${accountId} AND slug = ${slug} AND revoked_at IS NULL`);
  });
}

export interface MyShare {
  slug: string;
  title_id: string;
  title: string;
  title_slug: string;
  rating_snapshot: number | null;
  created_at: string;
  view_count: number;
}

export async function listMyShares(accountId: string, limit = 50): Promise<MyShare[]> {
  return withUser(accountId, async (tx) =>
    rows<MyShare>(
      tx,
      sql`
        SELECT s.slug, s.title_id, t.title, t.slug AS title_slug,
               s.rating_snapshot, s.created_at, s.view_count
        FROM usr.share s
        JOIN sem.title t ON t.id = s.title_id
        WHERE s.account_id = ${accountId} AND s.revoked_at IS NULL
        ORDER BY s.created_at DESC
        LIMIT ${limit}`,
    ),
  );
}

export interface PublicShare {
  title_id: string;
  display_name: string | null;
  include_rating: boolean;
  rating_snapshot: number | null;
  note_snapshot: string | null;
  message: string | null;
  created_at: string;
}

/**
 * The public read. Never opens a user-scoped transaction, so there is no code
 * path from a share page to anyone's live data -- only the snapshot this
 * function returns.
 */
export async function getPublicShare(slug: string): Promise<PublicShare | null> {
  if (!anon) throw new Error('shares: no database configured');
  const r = await anon<PublicShare[]>`SELECT * FROM usr.share_by_slug(${slug})`;
  return r[0] ?? null;
}

/** Bots unfurl links constantly; counting them makes the number meaningless. */
const BOT =
  /bot|crawler|spider|facebookexternalhit|slackbot|whatsapp|telegram|discord|preview|curl|wget|headless/i;

export async function recordShareView(slug: string, userAgent: string | null): Promise<void> {
  if (!anon) return;
  if (userAgent && BOT.test(userAgent)) return;
  await anon`SELECT usr.share_record_view(${slug})`;
}
