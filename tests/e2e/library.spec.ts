import { test, expect, type Page } from '@playwright/test';
import { AUTH_STATE } from './fixture-paths';

/**
 * The Library genre filter.
 *
 * The chips are built from the reader's OWN rows rather than from the
 * nineteen TMDB genres, so every chip offered returns something. That is the
 * property worth testing: a filter that can render an empty grid is one you
 * have to discover by clicking.
 *
 * The fixture shelf is deliberately uneven -- Drama 3, Comedy 2, Horror 1 --
 * so these assertions fail if filtering merely re-renders the same list.
 */
test.use({ storageState: AUTH_STATE });

/* The row holds BOTH the kind chips and the genre chips — one control, not
   two stacked rows. The label changed with it, which is what broke this
   selector and is exactly what a selector on a label is for. */
/* The row holds two labeled GROUPS — kind and genre — in one visual line.
   Scoped separately because each has its own aria-current, which is the
   point: they are different questions, not one long list. */
const chips = 'div[role="group"][aria-label="Genre"] a';
const kindChips = 'div[role="group"][aria-label="Movies or shows"] a';
const posters = 'main a[href^="/title/"]';

/**
 * Count the grid, once it exists.
 *
 * locator.count() does NOT wait -- it answers about the DOM as it is right
 * now. The poster grid renders inside a Suspense boundary, so counting
 * straight after goto() returns zero, and an assertion like
 * `filtered < all` then compares against a number that means "not yet"
 * rather than "none". Waiting for the first poster is what makes the
 * measurement about the page instead of about the clock.
 */
async function countPosters(page: Page): Promise<number> {
  await page.locator(posters).first().waitFor({ state: 'attached' });
  return page.locator(posters).count();
}

test.describe('library genre filter', () => {
  test('offers a chip per genre actually present, with its count', async ({ page }) => {
    await page.goto('/library?list=watchlist');
    const labels = await page.locator(chips).allInnerTexts();
    expect(labels[0]).toBe('All genres');
    expect(labels.join(' ')).toContain('Fixture Drama');
    expect(labels.join(' ')).toContain('Fixture Horror');
  });

  test('narrows the grid, and the count on the chip is the number shown', async ({ page }) => {
    await page.goto('/library?list=watchlist');
    const all = await countPosters(page);

    await page.getByRole('link', { name: /Fixture Horror/ }).click();
    await expect(page).toHaveURL(/genre=Fixture\+Horror/);

    const filtered = await countPosters(page);
    expect(filtered, 'Horror is on exactly one fixture title').toBe(1);
    expect(filtered).toBeLessThan(all);
  });

  test('marks the active chip with aria-current, which links are allowed', async ({ page }) => {
    // aria-pressed is defined only on role=button and axe rejects it on a
    // link as a critical violation. These navigate, so aria-current is both
    // valid and the correct meaning: the active member of a set.
    await page.goto('/library?list=watchlist&genre=Fixture+Horror');
    await expect(page.locator(`${chips}[aria-current="true"]`)).toHaveText(/Fixture Horror/);
    await expect(page.locator(`${chips}[aria-pressed]`)).toHaveCount(0);
  });

  test('tapping the active chip clears the filter', async ({ page }) => {
    await page.goto('/library?list=watchlist&genre=Fixture+Horror');
    await page.locator(`${chips}[aria-current="true"]`).click();
    await expect(page).not.toHaveURL(/genre=/);
  });

  test('keeps the filter when the sort changes', async ({ page }) => {
    await page.goto('/library?list=watchlist&genre=Fixture+Drama');
    await page.getByRole('link', { name: 'A–Z', exact: true }).click();
    await expect(page).toHaveURL(/genre=Fixture\+Drama/);
    await expect(page).toHaveURL(/sort=title/);
  });

  test('drops the filter when the segment changes', async ({ page }) => {
    // Chips are per-segment: carrying Horror into Watched would silently
    // filter to nothing and look like an empty library.
    await page.goto('/library?list=watchlist&genre=Fixture+Horror');
    await page.getByRole('link', { name: /^Watched/ }).click();
    await expect(page).not.toHaveURL(/genre=/);
  });

  test('a genre that is not in the library is ignored, not an empty grid', async ({ page }) => {
    await page.goto('/library?list=watchlist&genre=Nonexistent');
    await expect(page.locator(`${chips}[aria-current="true"]`)).toHaveText('All genres');
    expect(await countPosters(page)).toBeGreaterThan(0);
  });
});

/**
 * Movies and shows, in the same chip row as the genres.
 *
 * The fixture shelf is three movies and two shows, which is the smallest mix
 * where the control can be seen to narrow rather than merely re-render. It is
 * the first feature to spend ADR 0004 — one `title` table with a `kind`
 * discriminator — so the filter is a WHERE clause rather than a second query.
 */
test.describe('library kind filter', () => {
  test('offers Movies and Shows with their counts, in their own group', async ({ page }) => {
    await page.goto('/library?list=watchlist');
    const labels = (await page.locator(kindChips).allInnerTexts()).join(' ');
    expect(labels).toContain('Movies');
    expect(labels).toContain('Shows');
    // Three movies and two shows in the shelf; the counts are on the chips.
    expect(labels).toMatch(/Movies\s*3/);
    expect(labels).toMatch(/Shows\s*2/);
  });

  test('each group marks its own current item', async ({ page }) => {
    // aria-current means "the current item in a set". Two of them loose in
    // one nav would claim two current items in one set, which is why these
    // are separate labeled groups.
    await page.goto('/library?list=watchlist&kind=show&genre=Fixture+Comedy');
    await expect(page.locator(`${kindChips}[aria-current="true"]`)).toHaveCount(1);
    await expect(page.locator(`${chips}[aria-current="true"]`)).toHaveCount(1);
  });

  test('narrows to shows only', async ({ page }) => {
    await page.goto('/library?list=watchlist');
    const all = await countPosters(page);
    await page.getByRole('link', { name: /Shows/ }).click();
    await expect(page).toHaveURL(/kind=show/);
    const shows = await countPosters(page);
    expect(shows, 'two of the five fixtures are shows').toBe(2);
    expect(shows).toBeLessThan(all);
  });

  test('combines with the genre filter rather than replacing it', async ({ page }) => {
    // Both narrow. Fixture Comedy is on one movie and one show, so asking for
    // Comedy AND Shows must leave exactly one.
    await page.goto('/library?list=watchlist&genre=Fixture+Comedy');
    expect(await countPosters(page)).toBe(2);
    await page.getByRole('link', { name: /Shows/ }).click();
    await expect(page).toHaveURL(/genre=Fixture\+Comedy/);
    await expect(page).toHaveURL(/kind=show/);
    expect(await countPosters(page)).toBe(1);
  });

  test('a kind that is not in the library is ignored, not an empty grid', async ({ page }) => {
    await page.goto('/library?list=watchlist&kind=nonsense');
    expect(await countPosters(page)).toBeGreaterThan(0);
  });

  test('drops the kind when the segment changes', async ({ page }) => {
    await page.goto('/library?list=watchlist&kind=show');
    await page.getByRole('link', { name: /^Watched/ }).click();
    await expect(page).not.toHaveURL(/kind=/);
  });
});
