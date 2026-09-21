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
