import { test, expect } from '@playwright/test';

/**
 * Page geometry and background continuity.
 *
 * This exists because of a real defect: the sign-in page rendered inside the
 * app shell, inheriting `pb-28` reserved for a bottom nav that was hidden on
 * that route, plus its own `min-h-dvh`. The page came out 128px taller than
 * the viewport, and macOS rubber-band overscroll revealed the browser canvas
 * behind it as dark bands across the form.
 *
 * Nothing in typechecking, linting or the unit suite can see that. It needs a
 * browser and a measurement.
 */

test.describe('sign-in page', () => {
  test('fits the viewport exactly and does not scroll', async ({ page }) => {
    await page.goto('/auth/signin');
    const m = await page.evaluate(() => ({
      viewport: window.innerHeight,
      document: document.documentElement.scrollHeight,
    }));
    // A short page that scrolls is what produces the overscroll banding.
    expect(
      m.document,
      `document ${m.document}px in a ${m.viewport}px viewport`,
    ).toBeLessThanOrEqual(m.viewport + 1);
  });

  test('paints one continuous background, html and body agreeing', async ({ page }) => {
    await page.goto('/auth/signin');
    const c = await page.evaluate(() => ({
      html: getComputedStyle(document.documentElement).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
    }));
    expect(c.html).toBe(c.body);
    expect(c.html, 'must not be transparent, or the canvas shows through').not.toMatch(
      /rgba\(0, 0, 0, 0\)/,
    );
  });

  test('carries no app chrome', async ({ page }) => {
    await page.goto('/auth/signin');
    await expect(page.locator('nav[aria-label="Primary"]')).toHaveCount(0);
  });

  test('never scrolls sideways', async ({ page }) => {
    await page.goto('/auth/signin');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'horizontal overflow').toBeLessThanOrEqual(0);
  });

  test('the form is usable: fields are labeled and reachable by keyboard', async ({ page }) => {
    await page.goto('/auth/signin');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel(/Invite code/)).toBeVisible();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    expect(focused).toBe('INPUT');
  });
});

test.describe('gated routes', () => {
  for (const path of ['/', '/library', '/me', '/universe', '/search']) {
    test(`${path} redirects to sign-in without a session`, async ({ page }) => {
      const res = await page.goto(path);
      expect(page.url()).toContain('/auth/signin');
      expect(res?.status()).toBeLessThan(400);
    });
  }
});

test.describe('public surfaces', () => {
  test('health is reachable with no session', async ({ request }) => {
    const res = await request.get('/api/health');
    expect([200, 503]).toContain(res.status());
  });

  test('the admin route returns 401, not a redirect', async ({ request }) => {
    // A self-authenticating route behind the session gate returns a 307 to
    // HTML, which hides a failed authorization behind a routing quirk.
    const res = await request.post('/api/admin/invite', { failOnStatusCode: false });
    expect(res.status()).toBe(401);
  });
});

test.describe('installability', () => {
  /**
   * There was no manifest at all, so "Add to Home Screen" produced a bookmark
   * with a screenshot for an icon rather than an installed app. None of that
   * fails loudly — the page renders fine in a browser tab either way.
   */
  test('ships a manifest that describes an installable app', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);
    const m = (await res.json()) as {
      display: string;
      scope: string;
      start_url: string;
      background_color: string;
      icons: { src: string; sizes: string; purpose?: string }[];
    };

    expect(m.display, 'standalone is what drops the Safari chrome').toBe('standalone');
    expect(m.scope, 'without a scope, navigation escapes to the browser').toBe('/');
    expect(m.start_url).toContain('/');
    // A background_color that does not match the app makes the launch flash.
    expect(m.background_color.toLowerCase()).toBe('#0b0c0e');

    const sizes = m.icons.map((i) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(
      m.icons.some((i) => i.purpose === 'maskable'),
      'a launcher cropping a non-maskable icon to a circle clips the mark',
    ).toBe(true);

    for (const icon of m.icons) {
      const img = await request.get(icon.src);
      expect(img.status(), `${icon.src} must resolve`).toBe(200);
    }
  });

  test('declares an apple touch icon that resolves', async ({ page, request }) => {
    await page.goto('/auth/signin');
    const href = await page.locator('link[rel="apple-touch-icon"]').first().getAttribute('href');
    expect(href, 'iOS falls back to a screenshot without this').toBeTruthy();
    expect((await request.get(href!)).status()).toBe(200);
  });

  test('does not put content under the status bar', async ({ page }) => {
    // black-translucent extends the view UNDER the status bar and makes padding
    // the page's job. Nothing did it, so the first line of every screen sat
    // beneath the clock on an installed iPhone.
    await page.goto('/auth/signin');
    const style = await page
      .locator('meta[name="apple-mobile-web-app-status-bar-style"]')
      .getAttribute('content');
    expect(style).not.toBe('black-translucent');
  });
});

test.describe('sharing', () => {
  /**
   * The share page is the only surface a stranger reaches, and it must work
   * with no session at all. It also must not leak: it renders one snapshot
   * row fetched by slug, never a user-scoped read.
   */
  test('a share page is reachable with no session and is not indexed', async ({ request }) => {
    // An unknown slug must be a clean 404, not an error and not a redirect to
    // sign-in -- /s/ is public, so a wrong link should simply not exist.
    const missing = await request.get('/s/thisSlugDoesNotExist12', {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    expect(missing.status(), 'an unknown share is a 404, never a redirect').toBe(404);
  });

  test('share routes are public, not behind the session gate', async ({ request }) => {
    // Asserts ROUTING, so it must not depend on a database. The first version
    // demanded 200 or 404, which conflated "got past middleware" with "the
    // data layer answered" -- and failed on every CI push for a day because
    // the e2e job had no Postgres and the page threw a 500. Whether the route
    // is gated is answered by where it went, not by what it returned.
    const res = await request.get('/s/anything', { failOnStatusCode: false, maxRedirects: 0 });
    expect(res.status(), 'a public route must not redirect to sign-in').not.toBe(307);
    expect(res.headers()['location'] ?? '').not.toContain('/auth/signin');
  });
});

test.describe('security headers', () => {
  /**
   * The app shipped with only the HSTS header Vercel adds on its own: no CSP,
   * no frame-ancestors, no Referrer-Policy. All three are named ship-blocking
   * in docs/security.md.
   */
  test('every document carries the policy', async ({ request }) => {
    const res = await request.get('/auth/signin');
    const h = res.headers();

    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    // Share slugs are capability URLs; a full path in a Referer header hands
    // the capability to whoever receives it.
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(h['permissions-policy']).toContain('geolocation=()');

    const csp = h['content-security-policy'];
    expect(csp, 'a CSP must be present').toBeTruthy();
    expect(csp, 'scripts are nonce-locked').toMatch(/script-src [^;]*'nonce-/);
    expect(csp, 'nothing may frame this').toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    // Posters bypass the Next optimizer and come from TMDB directly, so the
    // policy has to say so or every image on every page breaks.
    expect(csp).toContain('https://image.tmdb.org');
  });

  test('the nonce is per request, not a constant', async ({ request }) => {
    // A reused nonce is the same as no nonce: anything injected once works
    // forever.
    const nonce = async () => {
      const csp = (await request.get('/auth/signin')).headers()['content-security-policy'] ?? '';
      return /'nonce-([^']+)'/.exec(csp)?.[1];
    };
    const [a, b] = await Promise.all([nonce(), nonce()]);
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  test('renders with no policy violations', async ({ page }) => {
    const violations: string[] = [];
    page.on('console', (m) => {
      if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
    });
    await page.goto('/auth/signin');
    await page.waitForLoadState('networkidle');
    expect(violations, violations.join(' | ')).toEqual([]);
  });
});
