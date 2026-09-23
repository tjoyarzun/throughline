import { test, expect } from '@playwright/test';

/**
 * The public ontology pages.
 *
 * This is the one deep surface a stranger reaches from a link, so the tests
 * that matter are about what it exposes and what it does NOT: it must answer
 * without a session, and it must carry nothing belonging to anybody. The
 * e2e suite runs signed out by default, which is exactly the visitor being
 * modeled here.
 */

const PAGE = '/explore/title/e2e-fixture-film';

test.describe('public explore', () => {
  test('answers with no session at all', async ({ request }) => {
    const res = await request.get(PAGE, { maxRedirects: 0, failOnStatusCode: false });
    expect(res.status(), 'a public route must not bounce to sign-in').toBe(200);
    expect(res.headers()['location'] ?? '').not.toContain('/auth/signin');
  });

  test('renders its relationships without JavaScript', async ({ request }) => {
    // The constellation is an enhancement. A crawler, a screen reader and a
    // browser with scripting off must all get the same facts from the HTML --
    // which is also what makes the canvas safe to mark aria-hidden.
    const html = await (await request.get(PAGE)).text();
    expect(html).toContain('An E2E Fixture');
    // The seeded person is credited on this title, so the acting relationship
    // has to be in the markup rather than only in the canvas.
    expect(html).toContain('Edwina Testwright');
    expect(html).toContain('/explore/person/e2e-fixture-person');
  });

  test('is indexable, unlike a share page', async ({ request }) => {
    const html = await (await request.get(PAGE)).text();
    expect(html).not.toMatch(/name="robots"[^>]*noindex/);
    // Share pages are personal messages and are noindex; this is a reference
    // page about a public fact and is meant to be found.
    const share = await (await request.get('/s/e2eFixtureShareSlug1')).text();
    expect(share).toMatch(/noindex/);
  });

  test('carries the TMDB attribution it is obliged to', async ({ request }) => {
    const html = await (await request.get(PAGE)).text();
    expect(html).toContain('not endorsed or certified by TMDB');
  });

  test('an unknown node is a clean 404, not a crash', async ({ request }) => {
    const res = await request.get('/explore/title/no-such-title-at-all', {
      failOnStatusCode: false,
    });
    expect(res.status()).toBe(404);
  });

  test('refuses a node type that is not in the ontology', async ({ request }) => {
    // The type segment reaches a database query, so it is validated against a
    // closed set rather than passed through.
    const res = await request.get('/explore/usr_account/anything', { failOnStatusCode: false });
    expect(res.status()).toBe(404);
  });
});
