# ADR 0012 — TMDB images bypass the Next image optimizer

**Date:** 2026-09-20 · **Status:** Accepted

## Decision

`next.config.ts` declares `image.tmdb.org` in `remotePatterns` with `unoptimized: true`. A custom
loader maps a requested width to the nearest TMDB size bucket (`w92`, `w185`, `w342`, `w500`,
`w780`, `original`) and returns the direct CDN URL.

## Why

TMDB already serves pre-sized variants from its own CDN. Routing them through Vercel's image
optimizer would burn optimization units on assets that are already optimized and already on a CDN,
add a cold-start latency class, and gain nothing.

Posters are the most-repeated element in the product and dominate perceived load, so this is one of
the higher-value small decisions in the project.

## Consequences

We give up Next's automatic AVIF/WebP negotiation for posters. Acceptable: TMDB serves JPEG at sizes
we control, and the service worker caches them cache-first with a 200-entry LRU.

`<img>` is used directly for posters, with a targeted `eslint-disable` referencing this ADR rather
than disabling the rule globally.
