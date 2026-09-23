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
  test('the landing answers with no session', async ({ request }) => {
    // '/explore' is NOT covered by an allowlist entry of '/explore/': the gate
    // matches on equality or prefix, so the bare path 307'd to sign-in -- the
    // exact URL a stranger gets handed.
    const res = await request.get('/explore', { maxRedirects: 0, failOnStatusCode: false });
    expect(res.status()).toBe(200);
  });

  /**
   * The scripts must actually RUN, twice.
   *
   * A nonce-based CSP and cached HTML are incompatible: the middleware mints a
   * fresh nonce per request while cached HTML carries a stale one, or none at
   * all when it was prerendered. Every script is then blocked and the page
   * renders its server half only -- which looked fine, because the lists are
   * the server half. The canvas sitting at its untouched 300x150 default is
   * the tell.
   *
   * Two passes, because the first request is what populates a cache and the
   * second is what reads it.
   *
   * This only bites against a production build; CI runs e2e through `pnpm dev`
   * where nothing is statically cached. tests/unit/public-pages-dynamic.test.ts
   * is what guards the regression in every mode, and that one was verified by
   * reintroducing the bug.
   */
  for (const path of ['/explore', '/explore/title/e2e-fixture-film']) {
    test(`${path} hydrates on a repeat request`, async ({ page }) => {
      const violations: string[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error' && /Content Security Policy/i.test(m.text())) {
          violations.push(m.text().slice(0, 120));
        }
      });

      for (const pass of [1, 2]) {
        violations.length = 0;
        await page.goto(path, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1200);
        expect(violations, `CSP blocked scripts on pass ${pass} of ${path}`).toEqual([]);

        /* A canvas is asserted only when the data produced one. CI runs against
           a database holding just the e2e fixture -- no posters, no computed
           node degrees -- so the landing has nothing to draw and there is no
           canvas to measure. The CSP check above is the data-independent half
           and is the one that actually catches the regression.

           Not asserted via the nonce, either: browsers strip the nonce CONTENT
           attribute after parsing, so getAttribute returns "" by design and
           checking it tested nothing. */
        const sized = await page.evaluate(() => {
          const c = document.querySelector('canvas');
          return c ? c.width > 400 : 'no-canvas';
        });
        if (sized !== 'no-canvas') {
          expect(sized, `pass ${pass}: canvas present but never sized`).toBe(true);
        }
      }
    });
  }

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
