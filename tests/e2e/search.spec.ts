import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { AUTH_STATE, FIXTURES, type Fixtures } from './fixture-paths';

/**
 * Searching for a person.
 *
 * Search queried sem.title and nothing else, while the provider half filtered
 * TMDB's multi-search down to movies and tv. So a person sitting in the corpus
 * with sixteen credits was unfindable by name, even though their page existed
 * and every title they worked on linked to it. Reported from real use: "Search
 * shows nothing for John Krasinski".
 */
const fixtures = (): Fixtures => JSON.parse(readFileSync(FIXTURES, 'utf8')) as Fixtures;

test.describe('search finds people', () => {
  test.use({ storageState: AUTH_STATE });

  test('a person in the corpus is findable by name', async ({ page }) => {
    const { personName } = fixtures();
    await page.goto('/search');

    await page.getByRole('searchbox').or(page.locator('input').first()).fill(personName);

    // The People group only renders when there are people to put in it, so its
    // presence is the assertion -- not a heading that is always there.
    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: new RegExp(personName, 'i') })).toBeVisible();
  });

  test('clicking through reaches their real page, not a provisional one', async ({ page }) => {
    const { personName } = fixtures();
    await page.goto('/search');
    await page.getByRole('searchbox').or(page.locator('input').first()).fill(personName);

    await page
      .getByRole('link', { name: new RegExp(personName, 'i') })
      .first()
      .click();
    await page.waitForLoadState('networkidle');
    // A corpus person links by slug. A tmdb- prefix would mean we sent them to
    // the lazy-ingest path for someone we already hold.
    expect(page.url()).toContain('/person/');
    expect(page.url()).not.toContain('/person/tmdb-');
  });

  test('a title query does not drag in unrelated people', async ({ page }) => {
    // The similarity threshold is shared with title search; too loose and every
    // query grows a People section full of noise.
    await page.goto('/search');
    await page.getByRole('searchbox').or(page.locator('input').first()).fill('An E2E Fixture');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'People' })).toHaveCount(0);
  });
});
