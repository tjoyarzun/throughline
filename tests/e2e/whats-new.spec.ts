import { test, expect } from '@playwright/test';
import { AUTH_STATE } from './fixture-paths';

/**
 * The unread mark on the Me tab.
 *
 * Marked read by MIDDLEWARE on the request for /whats-new, not by a client
 * component calling an action on mount -- a server component may not write a
 * cookie during render, and the client route does nothing with scripting off.
 * So these assertions are about cookies and server-rendered HTML, which is
 * where the behavior actually lives.
 */
test.use({ storageState: AUTH_STATE });

const meTab = 'nav[aria-label="Primary"] a[href="/me"]';

test.describe('unread release mark', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies({ name: 'tl-seen-release' });
  });

  test('shows on the Me tab when there is news you have not opened', async ({ page }) => {
    await page.goto('/library');
    await expect(page.locator(meTab)).toContainText('new');
  });

  test('is announced, not only colored', async ({ page }) => {
    // A colored dot alone fails SC 1.4.1 and is invisible to a screen reader.
    await page.goto('/library');
    const label = await page.locator(meTab).getAttribute('aria-label');
    const text = await page.locator(meTab).innerText();
    expect(`${label ?? ''} ${text}`.toLowerCase()).toContain('new');
  });

  test('opening the notes clears it', async ({ page }) => {
    await page.goto('/library');
    await expect(page.locator(meTab)).toContainText('new');

    await page.goto('/whats-new');
    await page.goto('/library');
    await expect(page.locator(meTab)).not.toContainText('new');
  });

  test('stays cleared across a fresh load', async ({ page }) => {
    await page.goto('/whats-new');
    await page.goto('/');
    await expect(page.locator(meTab)).not.toContainText('new');
  });

  test('is hidden while you are reading the notes', async ({ page }) => {
    // The cookie is set on this very request, so the server rendered the shell
    // with the stale value. The dot must not sit there accusing you of not
    // having read the page you are on.
    await page.goto('/whats-new');
    await expect(page.locator(meTab)).not.toContainText('new');
  });

  test('the notes are reachable from Me', async ({ page }) => {
    await page.goto('/me');
    await page.getByRole('link', { name: /What.s new/ }).click();
    await expect(page).toHaveURL(/\/whats-new/);
    await expect(page.locator('h1')).toContainText(/What.s new/);
  });

  test('every "take a look" link resolves, not just in the unit test', async ({ page }) => {
    await page.goto('/whats-new');

    /**
     * Wait for the page, then for a link, before counting either.
     *
     * locator.count() answers about the DOM as it is right now and never
     * waits -- the same flaw that made the Library genre test compare against
     * a zero. Under load this failed in 310ms with no links found, which
     * reads as "the feature is broken" and was "I asked too early".
     *
     * The URL assertion is here so a real failure still names itself: if the
     * session were ever lost this lands on /auth/signin, and "no links" would
     * otherwise be a very confusing way to be told that.
     */
    await expect(page).toHaveURL(/\/whats-new/);
    const links = page.getByRole('link', { name: 'Take a look →' });
    await expect(links.first()).toBeAttached();
    const n = await links.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const href = await links.nth(i).getAttribute('href');
      const res = await page.request.get(`http://localhost:3000${href}`);
      expect(res.status(), `${href} answered ${res.status()}`).toBeLessThan(400);
    }
  });
});
