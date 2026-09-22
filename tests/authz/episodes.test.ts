import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import type * as EpisodeRepo from '@/server/repos/episodes';

/**
 * Episode progress, as the real application role.
 *
 * The interesting cases are all about what "done" means: a season still
 * airing, specials in season 0, and finishing the last AIRED episode of a
 * show that is not finished.
 */
const ADMIN_URL = process.env.DATABASE_URL;
const APP_URL = process.env.TEST_DATABASE_URL;
const run = ADMIN_URL && APP_URL ? describe : describe.skip;

let admin: ReturnType<typeof postgres>;
let repo: typeof EpisodeRepo;
let alice: string;
let bob: string;
let showId: string;
const episodes: { id: string; season: number; number: number }[] = [];

run('episode progress', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = APP_URL;
    repo = await import('@/server/repos/episodes');

    admin = postgres(ADMIN_URL!, { max: 2, prepare: false, onnotice: () => {} });
    await admin`DELETE FROM usr.account WHERE email LIKE 'ep-%@test.local'`;
    await admin`DELETE FROM core.title WHERE slug = 'ep-fixture'`;

    const [t] = await admin<{ id: string }[]>`
      INSERT INTO core.title (slug, kind, title, sort_title)
      VALUES ('ep-fixture', 'show', 'Ep Fixture', 'epfixture') RETURNING id`;
    showId = t!.id;

    // Season 0 holds specials; season 1 has aired; season 2 is mid-flight with
    // two of four aired. That last one is the case progress usually gets wrong.
    const seasons = await admin<{ id: string; season_number: number }[]>`
      INSERT INTO core.season (title_id, season_number, name)
      VALUES (${showId}, 0, 'Specials'), (${showId}, 1, 'Season 1'), (${showId}, 2, 'Season 2')
      RETURNING id, season_number`;

    const mk = async (season: number, n: number, aired: boolean) => {
      const s = seasons.find((x) => x.season_number === season)!;
      const [e] = await admin<{ id: string }[]>`
        INSERT INTO core.episode (season_id, title_id, episode_number, name, air_date)
        VALUES (${s.id}, ${showId}, ${n}, ${'E' + n},
                ${aired ? '2020-01-01' : '2099-01-01'})
        RETURNING id`;
      episodes.push({ id: e!.id, season, number: n });
    };
    await mk(0, 1, true);
    for (let n = 1; n <= 3; n++) await mk(1, n, true);
    await mk(2, 1, true);
    await mk(2, 2, true);
    await mk(2, 3, false);
    await mk(2, 4, false);

    const [a] = await admin<{ id: string }[]>`
      INSERT INTO usr.account (email, display_name) VALUES ('ep-alice@test.local','A') RETURNING id`;
    alice = a!.id;
    const [b] = await admin<{ id: string }[]>`
      INSERT INTO usr.account (email, display_name) VALUES ('ep-bob@test.local','B') RETURNING id`;
    bob = b!.id;
  });

  beforeEach(async () => {
    await admin`DELETE FROM usr.episode_progress WHERE title_id = ${showId}`;
    await admin`DELETE FROM usr.title_state WHERE title_id = ${showId}`;
  });

  afterAll(async () => {
    await admin`DELETE FROM usr.account WHERE email LIKE 'ep-%@test.local'`;
    await admin`DELETE FROM core.title WHERE slug = 'ep-fixture'`;
    await admin.end();
  });

  const ep = (season: number, number: number) =>
    episodes.find((e) => e.season === season && e.number === number)!.id;

  it('starts the show on the first episode, without being asked', async () => {
    const r = await repo.setEpisodeWatched(alice, showId, ep(1, 1), true);
    expect(r.watched).toBe(1);

    const [state] = await admin<{ status: string }[]>`
      SELECT status FROM usr.title_state
      WHERE account_id = ${alice} AND title_id = ${showId}`;
    expect(state!.status, 'marking an episode means you started it').toBe('watching');

    const [ev] = await admin<{ source: string }[]>`
      SELECT source FROM usr.state_event
      WHERE account_id = ${alice} AND title_id = ${showId} ORDER BY occurred_at DESC LIMIT 1`;
    expect(ev!.source, 'and the log says it was not a manual choice').toBe('auto_from_episode');
  });

  it('counts progress against AIRED episodes, not the advertised total', async () => {
    // Caught up on a season still airing is 100%, not 60%. Telling someone
    // they are behind when they are not is the bug this guards.
    await repo.markThrough(alice, showId, ep(2, 2));
    const r = await repo.setEpisodeWatched(alice, showId, ep(2, 2), true);
    expect(r.aired, 'four unaired episodes do not count').toBe(6);
    expect(r.watched).toBe(6);
    expect(r.justCompleted, 'every aired episode is watched').toBe(true);
  });

  it('never marks an episode that has not aired', async () => {
    await repo.markSeason(alice, showId, 2, true);
    const eps = await repo.episodesForSeason(alice, showId, 2);
    const unaired = eps.filter((e) => !e.has_aired);
    expect(unaired.length).toBe(2);
    expect(
      unaired.every((e) => !e.watched),
      'you cannot have watched something that does not exist yet',
    ).toBe(true);
  });

  it('marks through in season/episode order, including specials', async () => {
    // Ordering by id would follow INGEST order, and season 0 sorts first by
    // number but is not necessarily first by id.
    await repo.markThrough(alice, showId, ep(1, 2));
    const s0 = await repo.episodesForSeason(alice, showId, 0);
    const s1 = await repo.episodesForSeason(alice, showId, 1);
    expect(s0[0]!.watched, 'the special precedes season 1').toBe(true);
    expect(s1.map((e) => e.watched)).toEqual([true, true, false]);
  });

  it('reports completion instead of deciding it', async () => {
    // Finishing the last AIRED episode of an unfinished show must not silently
    // call the whole series watched.
    const r = await repo.markThrough(alice, showId, ep(2, 2));
    expect(r.justCompleted).toBe(true);

    const [state] = await admin<{ status: string }[]>`
      SELECT status FROM usr.title_state
      WHERE account_id = ${alice} AND title_id = ${showId}`;
    expect(state!.status, 'still watching until the person says otherwise').toBe('watching');
  });

  it('unmarking takes the count back down', async () => {
    await repo.markSeason(alice, showId, 1, true);
    let seasons = await repo.seasonsForTitle(alice, showId);
    expect(seasons.find((s) => s.season_number === 1)!.watched_count).toBe(3);

    await repo.markSeason(alice, showId, 1, false);
    seasons = await repo.seasonsForTitle(alice, showId);
    expect(seasons.find((s) => s.season_number === 1)!.watched_count).toBe(0);
  });

  it('keeps one viewer’s progress away from another', async () => {
    await repo.markSeason(alice, showId, 1, true);
    const bobSeasons = await repo.seasonsForTitle(bob, showId);
    expect(
      bobSeasons.every((s) => s.watched_count === 0),
      'Bob has watched none of it',
    ).toBe(true);
    const bobEps = await repo.episodesForSeason(bob, showId, 1);
    expect(bobEps.every((e) => !e.watched)).toBe(true);
  });
});
