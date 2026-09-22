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
    writeFileSync(FIXTURES, JSON.stringify({ titleSlug: title!.slug, shareSlug }, null, 2));
  } finally {
    await sql.end();
  }
});
