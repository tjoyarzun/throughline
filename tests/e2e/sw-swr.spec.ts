import { test, expect, type Page } from '@playwright/test';
import { AUTH_STATE } from './fixture-paths';

/**
 * The worker paints the last visit, then checks.
 *
 * It used to be network-first, so the page cache did nothing except when
 * fully offline and every cold launch blocked on a server round trip --
 * measured at 1.0-1.9s cold against production. These assert the two
 * properties that make the change safe rather than merely fast: a cached page
 * still runs its scripts, and nothing about a session is ever replayed.
 */
test.use({ storageState: AUTH_STATE });

/**
 * A worker in control, having handled at least one navigation.
 *
 * The first load is what REGISTERS the worker, so it is not intercepted --
 * waiting only for `controller` leaves the page cache empty and every
 * assertion about its contents passes by finding nothing. The second
 * navigation is the one the worker actually serves.
 */
async function swReady(page: Page): Promise<void> {
  await page.goto('/library');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 20_000,
  });
  await page.goto('/library');
  await page.waitForFunction(
    async () => {
      const keys = await caches.keys();
      const name = keys.find((k) => k.startsWith('tl-pages-'));
      if (!name) return false;
      return (await (await caches.open(name)).keys()).length > 0;
    },
    null,
    { timeout: 20_000 },
  );
}

test('serves a second visit without waiting for the server', async ({ page, browserName }) => {
  /**
   * CHROMIUM ONLY, and this one stings, because iOS Safari is the platform
   * this change exists for.
   *
   * Playwright's WebKit build refuses a navigation whose request is aborted
   * while a service worker is active -- "Blocked by Web Inspector". It is a
   * harness limitation, the same one layout.spec.ts already documents for the
   * offline test, and there is no way to cut the network for a navigation in
   * WebKit without hitting it.
   *
   * So the claim this whole change rests on -- that a repeat visit paints
   * without the server -- is verified on Chromium here and has to be checked
   * by hand on a device for Safari. Naming the gap beats a test that quietly
   * covers the wrong browser.
   */
  test.skip(
    browserName === 'webkit',
    'Playwright WebKit cannot abort a navigation with an active worker',
  );

  await swReady(page);
  await page.goto('/library');

  // Cut the network entirely, then navigate. Network-first would have shown
  // the offline page; stale-while-revalidate paints from cache.
  await page.route('**/library', (r) => r.abort());
  await page.goto('/library');
  await expect(page.locator('h1')).toHaveText('Library');
});

test('a page served from cache still runs its scripts', async ({ page }) => {
  // The property that would have killed this: a nonce-based CSP and cached
  // HTML are incompatible when the body and the header come from different
  // places. Cache Storage keeps them together, so hydration must survive.
  await swReady(page);
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  await page.goto('/library');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  // Hydration is what proves scripts ran: the segmented control is a Link,
  // but the nav marks itself from usePathname, which only runs on the client.
  await expect(page.locator('nav[aria-label="Primary"] a[aria-current="page"]')).toBeVisible();
  expect(violations, violations.join('\n')).toEqual([]);
});

test('never replays a redirect about somebody else’s session', async ({ page, context }) => {
  // A 307 to /auth/signin is a fact about the session that made it. Cached
  // and replayed, it would bounce a signed-in person to sign-in.
  await swReady(page);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const name = keys.find((k) => k.startsWith('tl-pages-'));
    if (!name) return [];
    const cache = await caches.open(name);
    const requests = await cache.keys();
    const out: number[] = [];
    for (const r of requests) {
      const res = await cache.match(r);
      if (res) out.push(res.status);
    }
    return out;
  });
  expect(cached.length, 'the fixture must have cached something').toBeGreaterThan(0);
  expect(
    cached.every((s) => s === 200),
    `statuses: ${cached.join(',')}`,
  ).toBe(true);
  await context.close();
});

test('a navigation that redirects leaves nothing behind', async ({ browser }) => {
  /**
   * The worry was that a signed-out hit on /library would cache the sign-in
   * page under /library and serve it back to a signed-in reader. It cannot,
   * and the reason is worth pinning rather than trusting: a navigation
   * request carries redirect: 'manual', so the 307 arrives as an opaque
   * response with status 0, which nothing will store.
   *
   * That holds only while the request mode holds. Anything that switched to
   * redirect: 'follow' would turn the sign-in page into a 200 cached under
   * the wrong key, and this is what would notice.
   */
  /* Explicitly empty, not merely "no argument": this file sets storageState
     at file scope, and an unqualified newContext() is easy to misread as
     clean when it is not. An empty state is unambiguous. */
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto('/library');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 20_000,
  });
  await page.goto('/library');
  await page.waitForTimeout(600);

  const keys = await page.evaluate(async () => {
    const names = await caches.keys();
    const name = names.find((k) => k.startsWith('tl-pages-'));
    if (!name) return [];
    const cache = await caches.open(name);
    const out: string[] = [];
    for (const r of await cache.keys()) {
      const res = await cache.match(r);
      const html = res ? await res.clone().text() : '';
      const title = (html.match(/<title>([^<]*)</) ?? [])[1] ?? '?';
      out.push(`${new URL(r.url).pathname} [${res?.status}] "${title}"`);
    }
    return out;
  });
  expect(keys, `cached while signed out: ${keys.join(', ')}`).toEqual([]);
  await ctx.close();
});

test('auth still falls back to the offline page with the network cut', async ({
  page,
  context,
  browserName,
}) => {
  /**
   * Keeping auth off the STALE path is right; keeping it out of the worker
   * altogether was not. The first version returned early for /auth/, which
   * also dropped the offline fallback and turned the sign-in page into a
   * browser error page. Fresh or our own offline page -- never the browser's.
   */
  test.skip(
    browserName === 'webkit',
    'Playwright WebKit cannot navigate offline with an active worker',
  );
  await swReady(page);
  await page.goto('/auth/signin');
  await context.setOffline(true);
  try {
    await page.goto('/auth/signin');
    const body = (await page.textContent('body')) ?? '';
    expect(body.trim().length, 'our offline page, not a browser error').toBeGreaterThan(0);
  } finally {
    await context.setOffline(false);
  }
});

test('auth pages are never served from cache', async ({ page }) => {
  await swReady(page);
  await page.goto('/auth/signin');
  const names = await page.evaluate(async () => {
    const keys = await caches.keys();
    const name = keys.find((k) => k.startsWith('tl-pages-'));
    if (!name) return [];
    const cache = await caches.open(name);
    return (await cache.keys()).map((r) => new URL(r.url).pathname);
  });
  expect(names.length, 'must not pass by finding an empty cache').toBeGreaterThan(0);
  expect(names.filter((p) => p.startsWith('/auth/'))).toEqual([]);
});
