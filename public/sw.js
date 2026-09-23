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

const VERSION = 'v2';
const SHELL = `tl-shell-${VERSION}`;
const IMAGES = `tl-img-${VERSION}`;
const PAGES = `tl-pages-${VERSION}`;

/** Posters dominate perceived load, and they never change for a given path. */
const IMAGE_LIMIT = 200;
/** Enough to cover the routes someone actually revisits. */
const PAGE_LIMIT = 40;
/**
 * How stale a page may be and still be painted instantly.
 *
 * Bounds the worst case rather than the normal one: opening the app after a
 * month should not flash a month-old Library before correcting itself. Inside
 * the window the staleness is seconds to hours and the revalidation lands
 * before anybody reads the screen.
 */
const STALE_LIMIT_MS = 24 * 60 * 60 * 1000;
const CACHED_AT = 'x-tl-cached-at';

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

/**
 * Store a navigation with the time it was stored.
 *
 * The Cache Storage API keeps no metadata of its own, and the response's own
 * Date header is the ORIGIN's clock on a response that may itself have been
 * served from a CDN. Stamping on the way in is the only reading that answers
 * "how old is the thing I am about to paint".
 */
async function putPage(cache, request, res) {
  const body = await res.clone().blob();
  const headers = new Headers(res.headers);
  headers.set(CACHED_AT, String(Date.now()));
  await cache.put(request, new Response(body, { status: res.status, headers }));
  void trim(PAGES, PAGE_LIMIT);
}

function ageOf(res) {
  const at = Number(res.headers.get(CACHED_AT));
  return Number.isFinite(at) && at > 0 ? Date.now() - at : Infinity;
}

async function fromNetwork(request, cache) {
  const res = await fetch(request);
  /* Only 200s. A 307 to /auth/signin is a fact about the CURRENT session, and
     replaying it later would bounce a signed-in person to the sign-in page. */
  if (res.ok && res.status === 200) await putPage(cache, request, res);
  return res;
}

async function offlineFallback(request, cache, err) {
  const hit = await cache.match(request);
  if (hit) return hit;
  const shell = await caches.open(SHELL);
  const offline = await shell.match(OFFLINE_URL);
  if (offline) return offline;
  throw err;
}

/**
 * Paint what we have, then go and check.
 *
 * This replaces network-first, which asked the network on EVERY launch and
 * reached for the cache only when fetch threw -- so the page cache did
 * nothing at all except when fully offline, and every cold start stared at
 * the app background for a server round trip. Measured against production:
 * 1.0-1.9s cold, 0.36-0.7s warm, all of it before first paint.
 *
 * The obvious objection does not apply here, and it is worth writing down
 * because it bit this project once already: a nonce-based CSP is incompatible
 * with cached HTML, and serving a stale page with a dead nonce would block
 * every script on it. That bug was Vercel's DATA cache handing back a body
 * built with nonce A while middleware set header nonce B on the response.
 * Cache Storage keeps headers and body together as one response, so the two
 * always agree. Verified against production before this was written.
 */
async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(PAGES);
  const hit = await cache.match(request);

  if (!hit || ageOf(hit) > STALE_LIMIT_MS) {
    try {
      return await fromNetwork(request, cache);
    } catch (err) {
      return offlineFallback(request, cache, err);
    }
  }

  /* waitUntil, not a bare promise: without it the worker may be killed the
     moment the cached response is returned, and the revalidation never runs
     -- which would leave the cache frozen at whatever it first stored. */
  event.waitUntil(
    fromNetwork(request, cache)
      .then((res) => {
        if (res.ok && res.status === 200) return notifyClients(request.url);
        return undefined;
      })
      .catch(() => undefined),
  );

  return hit;
}

/**
 * Always the network, never the cache -- but still our offline page.
 *
 * For routes where a stale answer would be a WRONG answer rather than an old
 * one. Nothing is stored, so there is nothing to serve back later.
 */
async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const shell = await caches.open(SHELL);
    const offline = await shell.match(OFFLINE_URL);
    if (offline) return offline;
    throw err;
  }
}

/**
 * Tell the open page that what it is showing is now behind.
 *
 * Without this the reader sees their last visit until they navigate, which is
 * fine for a poster grid and wrong for "you marked this watched on the
 * laptop". The page answers with router.refresh(), so the correction costs an
 * RSC payload rather than a reload, and nothing blocked paint to get it.
 */
async function notifyClients(url) {
  const clients = await self.clients.matchAll({ type: 'window' });
  for (const client of clients) client.postMessage({ type: 'PAGE_REVALIDATED', url });
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
      /* Auth is never served STALE -- signing in or out is a transition
         between two states, and painting the previous one first is confusing
         at best and a wrong answer at worst. But it still goes through the
         worker, because bowing out entirely also removes the offline
         fallback: the first version of this returned early and turned the
         sign-in page into a browser error page with the network cut. Fresh
         or nothing, with "nothing" being our own offline page. */
      if (url.pathname.startsWith('/auth/')) {
        event.respondWith(networkOnly(request));
        return;
      }
      event.respondWith(staleWhileRevalidate(request, event));
      return;
    }
  }
  // Everything else goes to the network untouched.
});
