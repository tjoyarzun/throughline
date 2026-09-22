import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import type * as UserRepo from '@/server/repos/user';

/**
 * The personal layer, exercised through the real repository functions as the
 * REAL application role.
 *
 * Connecting as the owner would make every isolation assertion here vacuous:
 * RLS policies do not constrain a superuser even with FORCE, so the suite
 * would pass just as happily with the policies dropped. This file therefore
 * points the client at TEST_DATABASE_URL (throughline_app) before importing
 * it -- src/server/db/client.ts reads DATABASE_URL once, at module load.
 */
const ADMIN_URL = process.env.DATABASE_URL;
const APP_URL = process.env.TEST_DATABASE_URL;
const run = ADMIN_URL && APP_URL ? describe : describe.skip;

let admin: ReturnType<typeof postgres>;
let repo: typeof UserRepo;
let alice: string;
let bob: string;
let movieId: string;
let showId: string;

run('personal layer', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = APP_URL;
    repo = await import('@/server/repos/user');

    admin = postgres(ADMIN_URL!, { max: 2, prepare: false, onnotice: () => {} });
    await admin`DELETE FROM usr.account WHERE email LIKE 'track-%@test.local'`;
    await admin`DELETE FROM core.title WHERE slug LIKE 'track-fixture-%'`;

    const [m] = await admin<{ id: string }[]>`
      INSERT INTO core.title (slug, kind, title, sort_title, release_date)
      VALUES ('track-fixture-movie', 'movie', 'Track Fixture', 'trackfixture', '2016-01-01')
      RETURNING id`;
    movieId = m!.id;
    const [s] = await admin<{ id: string }[]>`
      INSERT INTO core.title (slug, kind, title, sort_title)
      VALUES ('track-fixture-show', 'show', 'Track Show', 'trackshow') RETURNING id`;
    showId = s!.id;

    const [a] = await admin<{ id: string }[]>`
      INSERT INTO usr.account (email, display_name) VALUES ('track-alice@test.local', 'Alice')
      RETURNING id`;
    alice = a!.id;
    const [b] = await admin<{ id: string }[]>`
      INSERT INTO usr.account (email, display_name) VALUES ('track-bob@test.local', 'Bob')
      RETURNING id`;
    bob = b!.id;
  });

  afterAll(async () => {
    await admin`DELETE FROM usr.account WHERE email LIKE 'track-%@test.local'`;
    await admin`DELETE FROM core.title WHERE slug LIKE 'track-fixture-%'`;
    await admin.end();
  });

  it('captures a watch in one transaction: status, event, viewing, rating', async () => {
    // AC-8. The four writes are one unit; a partial success would leave a
    // title marked watched with no viewing behind it, which is
    // indistinguishable from a retroactive entry.
    await repo.markWatched(alice, movieId, { stars: 4.5 });

    const ut = await repo.getUserTitle(alice, movieId);
    expect(ut?.status).toBe('watched');
    expect(Number(ut?.rating)).toBe(4.5);
    expect(ut?.view_count).toBe(1);

    const [ev] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM usr.state_event
      WHERE account_id = ${alice} AND title_id = ${movieId} AND event_kind = 'status_change'`;
    expect(ev!.n, 'exactly one status event').toBe(1);

    const [v] = await admin<{ n: number; precision: string; watched_on: string }[]>`
      SELECT count(*)::int AS n, min(date_precision) AS precision, min(watched_on)::text AS watched_on
      FROM usr.viewing WHERE account_id = ${alice} AND title_id = ${movieId}`;
    expect(v!.n).toBe(1);
    expect(v!.precision).toBe('day');
    expect(v!.watched_on).toBe(new Date().toISOString().slice(0, 10));
  });

  it('keeps rating history instead of overwriting it', async () => {
    await repo.setRating(alice, movieId, 3);
    const ut = await repo.getUserTitle(alice, movieId);
    expect(Number(ut?.rating), 'current rating is the new one').toBe(3);

    const all = await admin<{ value: number; superseded: boolean }[]>`
      SELECT value, superseded_at IS NOT NULL AS superseded FROM usr.rating
      WHERE account_id = ${alice} AND title_id = ${movieId} ORDER BY rated_at`;
    expect(
      all.map((r) => r.value),
      'both ratings survive',
    ).toEqual([9, 6]);
    expect(all.map((r) => r.superseded)).toEqual([true, false]);
  });

  it('a rewatch is derived, not asked for', async () => {
    const second = await repo.logViewing(alice, movieId, {});
    expect(second.isRewatch, 'a second viewing is a rewatch by definition').toBe(true);
    const ut = await repo.getUserTitle(alice, movieId);
    expect(ut?.view_count).toBe(2);
  });

  it('favoriting leaves status alone (AC-10)', async () => {
    await repo.setStatus(alice, showId, 'watching');
    const fav = await repo.toggleFavorite(alice, showId);
    expect(fav.isFavorite).toBe(true);

    const ut = await repo.getUserTitle(alice, showId);
    expect(ut?.status, 'still watching').toBe('watching');
    expect(ut?.is_favorite).toBe(true);

    // It appears in BOTH segments, which is the whole point of the decision.
    const watching = await repo.listLibrary(alice, { status: 'watching' });
    const favorites = await repo.listLibrary(alice, { favoritesOnly: true });
    expect(watching.map((r) => r.title_id)).toContain(showId);
    expect(favorites.map((r) => r.title_id)).toContain(showId);
  });

  it('does not log a transition that did not happen', async () => {
    const before = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM usr.state_event
      WHERE account_id = ${alice} AND title_id = ${showId} AND event_kind = 'status_change'`;
    await repo.setStatus(alice, showId, 'watching');
    const after = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM usr.state_event
      WHERE account_id = ${alice} AND title_id = ${showId} AND event_kind = 'status_change'`;
    expect(after[0]!.n, 're-setting the same status logs nothing').toBe(before[0]!.n);
  });

  it('never returns one account’s rows to another (AC-2)', async () => {
    // Bob asks for Alice's title by id. RLS is what must refuse, not a filter
    // we remembered to write.
    expect(await repo.getUserTitle(bob, movieId)).toBeNull();
    expect(await repo.listLibrary(bob)).toEqual([]);
    const counts = await repo.libraryCounts(bob);
    expect(
      Object.values(counts).every((n) => n === 0),
      'Bob sees nothing',
    ).toBe(true);

    // And Alice still sees her own, so the isolation is not just "empty".
    expect(await repo.getUserTitle(alice, movieId)).not.toBeNull();
  });

  it('refuses a rating outside the half-star range', async () => {
    await expect(repo.setRating(alice, movieId, 7)).rejects.toThrow(/out of range/);
    await expect(repo.setRating(alice, movieId, 0)).rejects.toThrow(/out of range/);
  });

  it('removing a title leaves the event log intact', async () => {
    await repo.removeFromLibrary(alice, showId);
    expect(await repo.getUserTitle(alice, showId)).toBeNull();
    const [ev] = await admin<{ n: number }[]>`
      SELECT count(*)::int AS n FROM usr.state_event
      WHERE account_id = ${alice} AND title_id = ${showId}`;
    expect(ev!.n, 'nothing is destroyed').toBeGreaterThan(0);
  });
});
