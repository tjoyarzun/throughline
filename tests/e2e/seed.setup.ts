import { test as setup } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import postgres from 'postgres';
import { AUTH_STATE, FIXTURES } from './fixture-paths';

/**
 * Fixtures for the tests that need a signed-in view.
 *
 * Most of the e2e suite deliberately runs signed out, because the things it
 * checks -- routing, headers, geometry, the share page -- are all reachable
 * that way. Accessibility is not: the app's real screens are behind the gate,
 * and auditing only the sign-in page would audit almost none of it.
 *
 * The session is written straight into the database rather than driven
 * through the UI, because the UI path is an emailed six-digit code. There is
 * nothing to click.
 */

/**
 * Better Auth signs its session cookie as `<token>.<base64 hmac-sha256>`.
 * Standard base64, not base64url -- an url-safe encoding is silently rejected
 * and presents as a session that simply never authenticates.
 */
function signCookie(token: string, secret: string): string {
  return `${token}.${createHmac('sha256', secret).update(token).digest('base64')}`;
}

setup('seed an account, a title and a share', async () => {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!url || !secret) throw new Error('seed: DATABASE_URL and BETTER_AUTH_SECRET are required');

  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  const token = `e2e-${Math.random().toString(36).slice(2)}${Date.now()}`;

  try {
    // Fixed ids so a re-run replaces the fixture rather than accumulating.
    const [acct] = await sql<{ id: string }[]>`
      INSERT INTO usr.account (email, display_name)
      VALUES ('e2e@test.local', 'Ada')
      ON CONFLICT (email) DO UPDATE SET display_name = excluded.display_name
      RETURNING id`;
    const accountId = acct!.id;

    /**
     * A title of our own rather than whatever happens to be in the corpus.
     * CI runs against an empty database, and a suite that silently audits an
     * empty page when the seed is missing is a suite that passes by finding
     * nothing -- the failure mode this project keeps running into.
     */
    const [title] = await sql<{ id: string; slug: string }[]>`
      INSERT INTO core.title (slug, kind, title, sort_title, release_date, runtime_minutes,
                              overview, original_language)
      VALUES ('e2e-fixture-film', 'movie', 'An E2E Fixture', 'e2e fixture', '2019-01-01', 101,
              'A film that exists so the accessibility suite has something real to render.', 'en')
      ON CONFLICT (slug) DO UPDATE SET title = excluded.title
      RETURNING id, slug`;
    const titleId = title!.id;

    /* A person, credited on the fixture title. Search reaches people now, and
       a test for that would pass by finding nothing if the corpus were empty
       -- so the fixture has to contain someone findable. */
    const [person] = await sql<{ id: string; slug: string }[]>`
      INSERT INTO core.person (slug, name, sort_name, known_for_department)
      VALUES ('e2e-fixture-person', 'Edwina Testwright', 'edwina testwright', 'Acting')
      ON CONFLICT (slug) DO UPDATE SET name = excluded.name
      RETURNING id, slug`;
    await sql`
      INSERT INTO core.credit (person_id, title_id, predicate, billing_order)
      VALUES (${person!.id}, ${titleId}, 'acted_in', 0)
      ON CONFLICT DO NOTHING`;

    await sql`
      INSERT INTO usr.title_state (account_id, title_id, status, is_favorite)
      VALUES (${accountId}, ${titleId}, 'watched', true)
      ON CONFLICT (account_id, title_id) DO UPDATE SET status = excluded.status`;
    await sql`
      INSERT INTO usr.rating (account_id, title_id, value)
      SELECT ${accountId}, ${titleId}, 9
      WHERE NOT EXISTS (
        SELECT 1 FROM usr.rating
        WHERE account_id = ${accountId} AND title_id = ${titleId} AND superseded_at IS NULL)`;

    /* Availability for the fixture, so the attribution obligation can be
       asserted against a page that actually renders providers. Without a row
       here the section returns null and a test for the JustWatch mark would
       pass by finding an absent section -- which is the failure mode this
       suite exists to prevent. */
    const [org] = await sql<{ id: string }[]>`
      INSERT INTO core.organization (slug, name, kind, logo_path)
      VALUES ('e2e-fixture-streamer', 'Fixture Stream', 'streamer', null)
      ON CONFLICT (slug) DO UPDATE SET name = excluded.name
      RETURNING id`;
    await sql`
      INSERT INTO core.availability
        (title_id, organization_id, region, offer_type, link, observed_at, valid_to)
      VALUES (${titleId}, ${org!.id}, 'US', 'flatrate',
              'https://www.themoviedb.org/movie/0/watch?locale=US', now(), NULL)
      ON CONFLICT (title_id, organization_id, region, offer_type)
      DO UPDATE SET valid_to = NULL, observed_at = now()`;

    /**
     * A library with more than one thing in it, across more than one genre.
     *
     * The fixture used to hold a single title with no genres, which meant the
     * Library screen could not be tested at all -- the segment counts, the
     * sort chips and the genre filter all render only when there is something
     * to render, so a suite pointed at it would have passed by finding an
     * empty page. Three genres over five titles is the smallest fixture where
     * filtering can be observed to actually change the result.
     */
    const GENRES = ['Fixture Drama', 'Fixture Comedy', 'Fixture Horror'];
    const concepts = await sql<{ id: string; label: string }[]>`
      INSERT INTO core.concept (scheme, slug, label, is_curated)
      SELECT 'genre', 'e2e-' || lower(replace(g, ' ', '-')), g, false
      FROM unnest(${GENRES}::text[]) AS g
      ON CONFLICT (scheme, slug) DO UPDATE SET label = excluded.label
      RETURNING id, label`;
    const genreId = new Map(concepts.map((c) => [c.label, c.id]));

    /* Deliberately uneven: Drama on three, Comedy on two, Horror on one, so a
       test can assert that filtering NARROWS rather than merely re-renders. */
    /* Two of the five are SHOWS. Without a mix the Movies/Shows control
       renders at all only by accident and cannot be observed to narrow
       anything -- the same gap that let the genre assertions pass vacuously
       before a second genre existed. */
    const shelf: { slug: string; title: string; genres: string[]; kind: 'movie' | 'show' }[] = [
      { slug: 'e2e-shelf-1', title: 'Fixture One', genres: ['Fixture Drama'], kind: 'movie' },
      {
        slug: 'e2e-shelf-2',
        title: 'Fixture Two',
        genres: ['Fixture Drama', 'Fixture Comedy'],
        kind: 'movie',
      },
      { slug: 'e2e-shelf-3', title: 'Fixture Three', genres: ['Fixture Drama'], kind: 'movie' },
      { slug: 'e2e-shelf-4', title: 'Fixture Four', genres: ['Fixture Comedy'], kind: 'show' },
      { slug: 'e2e-shelf-5', title: 'Fixture Five', genres: ['Fixture Horror'], kind: 'show' },
    ];
    for (const item of shelf) {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO core.title (slug, kind, title, sort_title, release_date, runtime_minutes,
                                overview, original_language)
        VALUES (${item.slug}, ${item.kind}, ${item.title}, ${item.title.toLowerCase()},
                '2021-01-01', 90, 'A shelf fixture.', 'en')
        /* kind is in the DO UPDATE, and it has to be. A conflict clause that
           only refreshes the title silently keeps every other column at
           whatever a previous run left, so changing two of these fixtures
           from movie to show did nothing at all on a database that had seen
           the old seed, and the control under test never rendered. Any column
           a fixture might change belongs here. */
        ON CONFLICT (slug) DO UPDATE
          SET title = excluded.title, kind = excluded.kind
        RETURNING id`;
      for (const g of item.genres) {
        await sql`
          INSERT INTO core.edge (subject_type, subject_id, predicate, object_type, object_id,
                                 provenance, source)
          VALUES ('title', ${row!.id}, 'belongs_to_genre', 'concept', ${genreId.get(g)!},
                  'asserted', 'e2e')
          ON CONFLICT DO NOTHING`;
      }
      await sql`
        INSERT INTO usr.title_state (account_id, title_id, status)
        VALUES (${accountId}, ${row!.id}, 'watchlist')
        ON CONFLICT (account_id, title_id) DO UPDATE SET status = excluded.status`;
    }

    /**
     * Clear the fixture account's rate-limit budget.
     *
     * Share creation is capped at twenty an hour, and the share specs create
     * one per run. The suite therefore poisoned itself: after enough runs the
     * button rendered "Try again" forever and three tests failed for a reason
     * that had nothing to do with what they were testing. The cap is correct
     * and stays; the fixture just starts each run with a clean budget, the
     * same way it starts with a clean session.
     */
    await sql`DELETE FROM core.rate_limit WHERE bucket LIKE ${'share:' + accountId + '%'}`;

    const shareSlug = 'e2eFixtureShareSlug1';
    await sql`
      INSERT INTO usr.share (slug, account_id, title_id, include_rating, rating_snapshot, message)
      VALUES (${shareSlug}, ${accountId}, ${titleId}, true, 9, 'Worth it for the sound design.')
      ON CONFLICT (slug) DO UPDATE SET revoked_at = NULL`;

    await sql`
      INSERT INTO usr.auth_session (id, token, user_id, expires_at, created_at, updated_at)
      VALUES ('e2e-session', ${token}, ${accountId}, now() + interval '1 day', now(), now())
      ON CONFLICT (id) DO UPDATE
        SET token = excluded.token, expires_at = excluded.expires_at`;

    const base = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3000');
    const state = {
      cookies: [
        {
          name: 'better-auth.session_token',
          value: signCookie(token, secret),
          domain: base.hostname,
          path: '/',
          expires: Math.floor(Date.now() / 1000) + 86400,
          httpOnly: true,
          secure: base.protocol === 'https:',
          sameSite: 'Lax' as const,
        },
      ],
      origins: [],
    };

    mkdirSync(dirname(AUTH_STATE), { recursive: true });
    writeFileSync(AUTH_STATE, JSON.stringify(state, null, 2));
    writeFileSync(
      FIXTURES,
      JSON.stringify(
        { titleSlug: title!.slug, shareSlug, personName: 'Edwina Testwright' },
        null,
        2,
      ),
    );
  } finally {
    await sql.end();
  }
});
