import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import type * as SharesRepo from '@/server/repos/shares';

/**
 * Shares, exercised as the REAL application role.
 *
 * usr.share is RLS-scoped to its owner, which makes the public page
 * unreadable by construction -- a visitor has no session. The way in is a
 * SECURITY DEFINER function keyed on the slug, and these tests are the reason
 * to trust that it is a capability rather than a hole: it must return one row
 * for the right slug and nothing at all for anything else.
 */
const ADMIN_URL = process.env.DATABASE_URL;
const APP_URL = process.env.TEST_DATABASE_URL;
const run = ADMIN_URL && APP_URL ? describe : describe.skip;

let admin: ReturnType<typeof postgres>;
let repo: typeof SharesRepo;
let alice: string;
let bob: string;
let titleId: string;

run('shares', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = APP_URL;
    repo = await import('@/server/repos/shares');

    admin = postgres(ADMIN_URL!, { max: 2, prepare: false, onnotice: () => {} });
    await admin`DELETE FROM usr.account WHERE email LIKE 'share-%@test.local'`;
    await admin`DELETE FROM core.title WHERE slug = 'share-fixture'`;

    const [t] = await admin<{ id: string }[]>`
      INSERT INTO core.title (slug, kind, title, sort_title)
      VALUES ('share-fixture', 'movie', 'Share Fixture', 'sharefixture') RETURNING id`;
    titleId = t!.id;
    const [a] = await admin<{ id: string }[]>`
      INSERT INTO usr.account (email, display_name) VALUES ('share-alice@test.local', 'Alice')
      RETURNING id`;
    alice = a!.id;
    const [b] = await admin<{ id: string }[]>`
      INSERT INTO usr.account (email, display_name) VALUES ('share-bob@test.local', 'Bob')
      RETURNING id`;
    bob = b!.id;
    await admin`INSERT INTO usr.title_state (account_id, title_id, status)
                VALUES (${alice}, ${titleId}, 'watched')`;
    await admin`INSERT INTO usr.rating (account_id, title_id, value)
                VALUES (${alice}, ${titleId}, 9)`;
  });

  afterAll(async () => {
    await admin`DELETE FROM usr.account WHERE email LIKE 'share-%@test.local'`;
    await admin`DELETE FROM core.title WHERE slug = 'share-fixture'`;
    await admin.end();
  });

  it('snapshots the rating instead of pointing at it (AC-14)', async () => {
    const s = await repo.createShare(alice, titleId, { includeRating: true });
    expect(s.ratingSnapshot, '4.5 stars, stored as 9').toBe(9);

    // Alice changes her mind. The message she already sent must not rewrite
    // itself -- that is the entire argument for snapshotting.
    await admin`UPDATE usr.rating SET value = 4
                WHERE account_id = ${alice} AND title_id = ${titleId}`;

    const pub = await repo.getPublicShare(s.slug);
    expect(pub?.rating_snapshot, 'still the rating that was shared').toBe(9);
  });

  it('is readable with no session at all', async () => {
    // The whole point: a stranger holding the link can read it.
    const s = await repo.createShare(alice, titleId, { message: 'worth it' });
    const pub = await repo.getPublicShare(s.slug);
    expect(pub).not.toBeNull();
    expect(pub!.message).toBe('worth it');
    expect(pub!.display_name).toBe('Alice');
  });

  it('gives up nothing for a slug you do not have', async () => {
    expect(await repo.getPublicShare('doesnotexistdoesnotexist')).toBeNull();
    expect(await repo.getPublicShare('')).toBeNull();
  });

  it('stops working the moment it is revoked (AC-16)', async () => {
    const s = await repo.createShare(alice, titleId, {});
    expect(await repo.getPublicShare(s.slug)).not.toBeNull();
    await repo.revokeShare(alice, s.slug);
    expect(await repo.getPublicShare(s.slug), 'a revoked link is gone').toBeNull();
  });

  it('will not let one account revoke another account’s share', async () => {
    const s = await repo.createShare(alice, titleId, {});
    await repo.revokeShare(bob, s.slug);
    expect(await repo.getPublicShare(s.slug), 'Bob cannot kill Alice’s link').not.toBeNull();
  });

  it('shows an owner only their own shares', async () => {
    const mine = await repo.listMyShares(bob);
    expect(mine, 'Bob has created none').toEqual([]);
    expect((await repo.listMyShares(alice)).length).toBeGreaterThan(0);
  });

  it('mints slugs that are not guessable or repeated', async () => {
    const slugs = new Set(Array.from({ length: 500 }, () => repo.shareSlug()));
    expect(slugs.size, 'no collisions in 500').toBe(500);
    for (const s of slugs) expect(s).toHaveLength(21);
  });

  it('does not count bots as views', async () => {
    const s = await repo.createShare(alice, titleId, {});
    await repo.recordShareView(s.slug, 'facebookexternalhit/1.1');
    await repo.recordShareView(s.slug, 'Slackbot-LinkExpanding 1.0');
    let [row] = await admin<{ view_count: number }[]>`
      SELECT view_count FROM usr.share WHERE slug = ${s.slug}`;
    expect(row!.view_count, 'unfurlers are not readers').toBe(0);

    await repo.recordShareView(s.slug, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)');
    [row] = await admin<{ view_count: number }[]>`
      SELECT view_count FROM usr.share WHERE slug = ${s.slug}`;
    expect(row!.view_count).toBe(1);
  });
});
