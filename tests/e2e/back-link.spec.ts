import { test, expect } from '@playwright/test';
import { AUTH_STATE } from './fixture-paths';

/**
 * Back, on the deep pages that had no way out.
 *
 * Installed as a PWA there is no browser chrome, so a title page reached from
 * Library used to be a dead end: the only exit was the tab bar, which loses
 * your place in the grid.
 *
 * Resolved server-side from Referer, so these assertions are about rendered
 * HTML rather than about a click handler. The case that matters most is the
 * last one -- somebody arriving from a share link has no in-app history, and
 * a control that calls history.back() there does nothing at all.
 */
test.use({ storageState: AUTH_STATE });

const back =
  'article a[href]:has(span[aria-hidden="true"]), div > a[href]:has(span[aria-hidden="true"])';

test('returns to the exact screen you came from, query string included', async ({ page }) => {
  await page.goto('/library?list=watchlist&sort=title');
  await page.locator('main a[href^="/title/"]').first().click();
  await page.waitForURL(/\/title\//);

  const link = page.locator(back).first();
  await expect(link).toHaveAttribute('href', '/library?list=watchlist&sort=title');
  await expect(link).toContainText('Library');
});

test('names the destination rather than showing a bare arrow', async ({ page }) => {
  await page.goto('/search');
  await page.goto('/library');
  await page.locator('main a[href^="/title/"]').first().click();
  await page.waitForURL(/\/title\//);
  await expect(page.locator(back).first()).toContainText('Library');
});

test('falls back to a real page when there is no referrer at all', async ({ page }) => {
  // A cold load, as from a share link or a bookmark. There is no history to
  // go back to, so the control must still lead somewhere that exists.
  await page.goto('/library');
  const href = await page.locator('main a[href^="/title/"]').first().getAttribute('href');
  await page.goto(`http://localhost:3000${href}`);
  const link = page.locator(back).first();
  await expect(link).toHaveAttribute('href', '/search');
  await expect(link).toContainText('Search');
});

test('never offers to go back to the page you are already on', async ({ page }) => {
  await page.goto('/library');
  const href = (await page.locator('main a[href^="/title/"]').first().getAttribute('href'))!;
  await page.goto(`http://localhost:3000${href}`);
  // Reload from itself: the referrer is now this very page.
  await page.reload();
  await expect(page.locator(back).first()).not.toHaveAttribute('href', href);
});

test('does not send you back into the sign-in flow', async ({ page }) => {
  await page.goto('/library');
  const href = (await page.locator('main a[href^="/title/"]').first().getAttribute('href'))!;
  await page.setExtraHTTPHeaders({ referer: 'http://localhost:3000/auth/signin?next=/library' });
  await page.goto(`http://localhost:3000${href}`);
  await expect(page.locator(back).first()).toHaveAttribute('href', '/search');
});

test('ignores a referrer from another site', async ({ page }) => {
  await page.goto('/library');
  const href = (await page.locator('main a[href^="/title/"]').first().getAttribute('href'))!;
  await page.setExtraHTTPHeaders({ referer: 'https://example.com/somewhere' });
  await page.goto(`http://localhost:3000${href}`);
  await expect(page.locator(back).first()).toHaveAttribute('href', '/search');
});
