import { test, expect } from '@playwright/test';
import { AUTH_STATE } from './fixture-paths';

/**
 * The persona card route is PRIVATE.
 *
 * It renders whoever is signed in, takes no account id from the caller, and
 * must never be cached. A stored copy of this is somebody else's taste in a
 * stranger's hands, which is a different and worse class of bug than a stale
 * image -- so the cache header is asserted, not assumed.
 */
test.describe('persona card, signed out', () => {
  test('is not reachable without a session', async ({ page }) => {
    const res = await page.request.get('/api/persona/card', { maxRedirects: 0 });
    // Either the gate bounces it or the route refuses. Both are acceptable;
    // an image is not.
    expect(res.status()).not.toBe(200);
    expect(res.headers()['content-type'] ?? '').not.toContain('image/png');
  });
});

test.describe('persona card, signed in', () => {
  test.use({ storageState: AUTH_STATE });

  test('renders a square PNG', async ({ page }) => {
    const res = await page.request.get('/api/persona/card');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
    const body = await res.body();
    expect(body.length, 'a plausible card, not an empty response').toBeGreaterThan(5_000);
    // PNG header carries the dimensions at a fixed offset.
    expect(body.readUInt32BE(16)).toBe(1080);
    expect(body.readUInt32BE(20)).toBe(1080);
  });

  test('forbids any shared cache from keeping it', async ({ page }) => {
    const res = await page.request.get('/api/persona/card');
    const cc = res.headers()['cache-control'] ?? '';
    expect(cc).toContain('no-store');
    expect(cc, 'must never be public').not.toContain('public');
  });

  test('stays under what a share sheet will carry', async ({ page }) => {
    // iMessage gets unreliable approaching 1MB; the title card targets 300KB
    // and this one has no photographic content at all, so it should be far
    // smaller. A regression here means something started embedding an image.
    const res = await page.request.get('/api/persona/card');
    expect((await res.body()).length).toBeLessThan(300_000);
  });
});
