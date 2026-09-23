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
 * Type a query and wait for the search to actually fire.
 *
 * Three CI-only failures came out of this helper, all timing, none a defect in
 * the feature. Worth recording because each fix looked right:
 *
 * 1. Racing a fixed timeout. CI runs against `pnpm dev`, so the first hit to
 *    /api/search compiles the route on demand, slower than any number worth
 *    hardcoding.
 *
 * 2. Typing before React hydrated. fill() sets the DOM value, but with no
 *    handler attached nothing listens and no request is made -- so waiting on
 *    the response then timed out on a page that was working.
 *
 * 3. Using autoFocus as the hydration signal. It is not one: React renders it
 *    as the `autofocus` ATTRIBUTE in the server HTML, and the browser applies
 *    that during parse, before any JavaScript runs. The assertion passed while
 *    nothing was listening, which is the most expensive kind of green.
 *
 * The App Router exposes no public "hydrated" signal, so rather than guess at
 * another proxy this retries the one interaction that matters until the
 * request fires. Slow machines take more attempts; correct ones still pass.
 */
async function search(page: Page, query: string) {
  await page.goto('/search');
  const box = page.getByRole('searchbox');
  await box.waitFor({ state: 'visible' });

  await expect(async () => {
    const answered = page.waitForResponse(
      (r) => r.url().includes('/api/search') && r.request().method() === 'GET',
      { timeout: 3000 },
    );
    // Clear first: refilling the same value produces no change event, so a
    // retry would type nothing and wait for a request that cannot come.
    await box.fill('');
    await box.fill(query);
    await answered;
  }).toPass({ timeout: 60_000 });
}

test.describe('search finds people', () => {
  test.use({ storageState: AUTH_STATE });
  // Generous, because a cold dev-mode route compile in CI is legitimately slow
  // and this suite is about behavior, not speed.
  test.describe.configure({ timeout: 90_000 });

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
