import { test, expect, type Page } from '@playwright/test';
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

/**
 * Type a query and WAIT FOR THE SEARCH TO ANSWER, rather than racing a fixed
 * timeout against it.
 *
 * CI runs the suite against `pnpm dev`, so the first request to /api/search
 * compiles the route on demand. On a loaded runner that took longer than the
 * ten seconds the first version allowed, and the tests failed on WebKit only
 * -- whichever browser happened to arrive first and pay the compile. Waiting
 * on the actual response is correct regardless of how slow the machine is,
 * and it fails fast rather than after a timeout when the request never fires.
 */
async function search(page: Page, query: string) {
  await page.goto('/search');
  const answered = page.waitForResponse(
    (r) => r.url().includes('/api/search') && r.request().method() === 'GET',
    { timeout: 60_000 },
  );
  await page.locator('input').first().fill(query);
  await answered;
}

test.describe('search finds people', () => {
  test.use({ storageState: AUTH_STATE });

  test('a person in the corpus is findable by name', async ({ page }) => {
    const { personName } = fixtures();
    await search(page, personName);

    // The People group only renders when there are people to put in it, so its
    // presence is the assertion -- not a heading that is always there.
    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(personName, 'i') })).toBeVisible();
  });

  test('clicking through reaches their real page, not a provisional one', async ({ page }) => {
    const { personName } = fixtures();
    await search(page, personName);

    await page
      .getByRole('link', { name: new RegExp(personName, 'i') })
      .first()
      .click();
    await page.waitForURL(/\/person\//);
    // A corpus person links by slug. A tmdb- prefix would mean we sent them to
    // the lazy-ingest path for someone we already hold.
    expect(page.url()).not.toContain('/person/tmdb-');
  });

  test('a title query does not drag in unrelated people', async ({ page }) => {
    // The similarity threshold is shared with title search; too loose and every
    // query grows a People section full of noise.
    await search(page, 'An E2E Fixture');
    await expect(page.getByRole('heading', { name: 'People' })).toHaveCount(0);
  });
});
