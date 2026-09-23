import { test, expect } from '@playwright/test';
import { AUTH_STATE } from './fixture-paths';

/**
 * The color-scheme choice.
 *
 * Stored in a cookie and applied server-side to <html>, so the assertions
 * here are about the FIRST paint rather than about a class that appears after
 * hydration. A theme that only lands once JavaScript runs is a theme that
 * flashes the wrong one on the phone it exists for.
 */
test.describe('theme control', () => {
  test.use({ storageState: AUTH_STATE, colorScheme: 'dark' });

  test('defaults to following the device, writing no attribute', async ({ page }) => {
    await page.goto('/me');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');
    await expect(page.getByRole('button', { name: 'System', pressed: true })).toBeVisible();
  });

  test('an explicit choice overrides a device set the other way', async ({ page }) => {
    await page.goto('/me');
    await page.getByRole('button', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // The real assertion: the page is actually painted light, not merely
    // labeled light. This fails if the attribute lands somewhere the
    // stylesheet does not key on.
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(251, 250, 248)');
  });

  test('survives a reload, and is there on the first paint', async ({ page }) => {
    await page.goto('/me');
    await page.getByRole('button', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // No JavaScript at all: proves the attribute is server-rendered.
    const plainContext = await page
      .context()
      .browser()!
      .newContext({
        storageState: await page.context().storageState(),
        colorScheme: 'dark',
        javaScriptEnabled: false,
      });
    const plain = await plainContext.newPage();
    await plain.goto('/library');
    await expect(plain.locator('html')).toHaveAttribute('data-theme', 'light');
    await plainContext.close();
  });

  test('reaches the public pages, where there is no account to read', async ({ page }) => {
    await page.goto('/me');
    await page.getByRole('button', { name: 'Light' }).click();
    // Wait for the action to land before navigating: without this the goto
    // races the Set-Cookie and the failure looks like the feature is broken
    // on public pages when it is the test that is early.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.goto('/explore');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('System can be chosen again after choosing otherwise', async ({ page }) => {
    await page.goto('/me');
    await page.getByRole('button', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'System' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg, 'back to following the dark device').toBe('rgb(11, 12, 14)');
  });

  test('the status bar color follows the choice, not only the device', async ({ page }) => {
    await page.goto('/me');
    await page.getByRole('button', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const meta = page.locator('meta[name="theme-color"]');
    await expect(meta).toHaveCount(1);
    await expect(meta).toHaveAttribute('content', '#FBFAF8');
  });
});
