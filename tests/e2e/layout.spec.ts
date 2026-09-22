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
