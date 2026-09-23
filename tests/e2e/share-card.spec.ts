import { test, expect } from '@playwright/test';
import { AUTH_STATE, FIXTURES, type Fixtures } from './fixture-paths';
import { readFileSync } from 'node:fs';

const fixtures = (): Fixtures => JSON.parse(readFileSync(FIXTURES, 'utf8'));

/**
 * Sharing the card image.
 *
 * The property worth testing is not that a share sheet opens -- Playwright
 * cannot open one -- but that the File reaches the click handler ALREADY
 * FETCHED. On iOS Safari any await between the tap and navigator.share()
 * loses user activation and the sheet silently refuses to open, so a version
 * that fetched the PNG on tap would look correct in every browser that is not
 * the one this app is built for.
 */
test.use({ storageState: AUTH_STATE });

test('the card is prefetched with the share row, not on the tap', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('opengraph-image')) requested.push(r.url());
  });

  await page.goto(`/title/${fixtures().titleSlug}`);
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page.getByRole('button', { name: 'Send link' })).toBeVisible();

  // The fetch must already have happened, before any second tap.
  await expect
    .poll(() => requested.length, { message: 'the card should be fetched with the share row' })
    .toBeGreaterThan(0);
});

test('the card button appears only where the browser can actually share a PNG', async ({
  page,
}) => {
  await page.goto(`/title/${fixtures().titleSlug}`);
  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page.getByRole('button', { name: 'Send link' })).toBeVisible();

  const supported = await page.evaluate(() => {
    const f = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    return navigator.canShare?.({ files: [f] }) ?? false;
  });

  const card = page.getByRole('button', { name: 'Send card' });
  if (supported) {
    // Appears once the prefetch resolves, not before -- the File has to exist
    // for canShare to be asked about it.
    await expect(card).toBeVisible();
  } else {
    // Give the prefetch the same chance to land, then assert it stayed away.
    await page.waitForTimeout(1500);
    await expect(card, 'must track canShare, not appear unconditionally').toHaveCount(0);
  }
});

test('a failed card fetch never takes the link with it', async ({ page }) => {
  await page.route('**/opengraph-image*', (r) => r.abort());
  await page.goto(`/title/${fixtures().titleSlug}`);
  await page.getByRole('button', { name: 'Share' }).click();
  // The link is the thing that must survive: it is the better share anyway.
  await expect(page.getByRole('button', { name: 'Send link' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send card' })).toHaveCount(0);
});
