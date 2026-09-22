/*
 * Throughline service worker.
 *
 * Hand-written rather than generated. The usual reason to reach for Serwist or
 * next-pwa is precaching the build manifest, and this app has nothing static
 * to precache: every page is force-dynamic and behind a session. What is
 * actually worth caching is three specific things, and each wants a different
 * strategy, so a generated worker would be configuration without a library's
 * worth of behavior behind it.
 *
 * SCOPE IS READ-ONLY, deliberately. Offline writes need conflict resolution
 * and a sync log, and a half-built version of that loses data silently --
 * which is worse than refusing to write at all. Mutations are never
 * intercepted; they fail offline and the UI says so.
 */

const VERSION = 'v1';
const SHELL = `tl-shell-${VERSION}`;
const IMAGES = `tl-img-${VERSION}`;
const PAGES = `tl-pages-${VERSION}`;

/** Posters dominate perceived load, and they never change for a given path. */
const IMAGE_LIMIT = 200;
/** Enough to cover the routes someone actually revisits. */
const PAGE_LIMIT = 40;

const OFFLINE_URL = '/offline';

/** Never touched: auth, admin, cron, and anything that changes state. */
function isOffLimits(url) {
  return (
    url.pathname.startsWith('/api/auth/') ||
    url.pathname.startsWith('/api/admin/') ||
    url.pathname.startsWith('/api/cron/')
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll([OFFLINE_URL, '/icon-192.png']))
      // A failed precache must not wedge the worker permanently; the app still
      // works online without it.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('tl-') && !k.endsWith(VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/**
 * Signing out must not leave the previous session's pages on disk.
 *
 * Cached navigations contain personal data -- a Library, a rating history. The
 * cache is per browser profile, like the HTTP cache, but "sign out, go
 * offline, still see their list" is not a defensible outcome, so the sign-out
 * button tells the worker to drop it.
 */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_PRIVATE_CACHES') {
    event.waitUntil(caches.delete(PAGES));
  }
});

/** Approximate LRU: cache key order is insertion order, so drop from the front. */
async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  // Opaque responses (status 0) come from cross-origin images fetched no-cors.
  // They cannot be inspected, but they can be replayed, which is the point.
  if (res.ok || res.type === 'opaque') {
    await cache.put(request, res.clone());
    void trim(cacheName, limit);
  }
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(PAGES);
  try {
    const res = await fetch(request);
    if (res.ok) {
      await cache.put(request, res.clone());
      void trim(PAGES, PAGE_LIMIT);
    }
    return res;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    const shell = await caches.open(SHELL);
    const offline = await shell.match(OFFLINE_URL);
    if (offline) return offline;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Only GET. A cached POST is a lie about something that never happened.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isOffLimits(url)) return;

  if (url.hostname === 'image.tmdb.org') {
    event.respondWith(cacheFirst(request, IMAGES, IMAGE_LIMIT));
    return;
  }

  if (url.origin === self.location.origin) {
    // Build output is content-hashed and immutable.
    if (url.pathname.startsWith('/_next/static/')) {
      event.respondWith(cacheFirst(request, SHELL, 200));
      return;
    }
    if (request.mode === 'navigate') {
      event.respondWith(networkFirst(request));
      return;
    }
  }
  // Everything else goes to the network untouched.
});
