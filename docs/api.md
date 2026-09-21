# API and data access

## Server/client boundary

RSC-first. Server components call repository functions directly — no HTTP hop for our own data.
Client components only for: the graph canvas, the rating control, search-as-you-type, swipe
gestures, and the share sheet.

**Mutations are Server Actions** (`src/actions/`). Each: `'use server'` -> `auth()` -> Zod parse ->
repo call -> `revalidateTag()`. Optimistic UI via `useOptimistic` for status changes and episode
ticks — a 300ms round-trip on "mark watched" is felt.

**Route handlers only for:** the TMDB search proxy (streaming + client debounce), OG image
generation, cron endpoints, and the future AI endpoint.

## Versioning — deliberately none

The data API is **internal only**. There is no public API and no external consumer, so no versioning
or deprecation policy is required. This is a decision, not an omission. If a public API is ever
added it gets `/api/v1/` and an OpenAPI document from day one.

## Repository layer

```
src/server/repos/
  titles.ts   getTitleBySlug, searchTitles, getTitleFull, listByStatus
  people.ts
  graph.ts    neighbors, expand, findPaths, shortestPath, bacon
  user.ts     setStatus, setRating, toggleFavorite, logViewing, markEpisode
  shares.ts
  metrics.ts  resolve(metricName, params)
```

Every function in `user.ts` takes `accountId` as its **first parameter**, supplied from `auth()` at
the call site. Combined with RLS that is belt and braces — see [security.md](security.md).

## External providers

All TMDB traffic goes through `src/server/providers/tmdb/`. Never from the browser.

**Auth is the v4 Read Access Token as `Authorization: Bearer`, not the v3 `api_key` query
parameter.** We log request paths, so a query-string credential would land in our logs.

1. **`fetch` with the Next data cache** — `next: { revalidate, tags }` per endpoint class.
2. **Token-bucket limiter** at 30 req/s, below TMDB's ~50 for headroom, with a Postgres-backed
   counter for cross-instance safety.
3. **Retry** with jittered backoff on 429/5xx, 3 attempts, plus a circuit breaker that degrades to
   cached data rather than erroring the page.
4. **Zod-validated parsing at the boundary.** Provider fields change; we want a typed failure at the
   edge, not `undefined` three layers in.
5. **Raw payload capture** into `raw.tmdb_*` on ingest calls (not on search).

## Ingest

**Lazy-first with a seeded base.**

- **Seed** (one-time local script) — ~5,000 titles: TMDB top-rated and popular across decades, plus
  complete filmographies for ~150 notable directors, plus ~200 complete franchises. This guarantees
  the Universe is dense on day one.
- **Lazy** — opening an unknown title enqueues `hydrate_title` _and_ does a synchronous minimal
  fetch so the page renders; full data arrives within seconds and the page revalidates.
- **Background** — cron, below.

## Job system

A `core.job` table plus `/api/cron/drain` — [ADR 0011](adr/0011-job-table-over-queue-service.md).
`claim_jobs(n)` uses `FOR UPDATE SKIP LOCKED`; up to 40 jobs per invocation against a wall-clock
budget; exponential `run_after`; `attempts` cap 5; failures visible in an admin view.

## Cron schedule

| Schedule    | Job                    | Purpose                                                         |
| ----------- | ---------------------- | --------------------------------------------------------------- |
| `* * * * *` | `drain`                | Process the queue                                               |
| `0 4 * * *` | `tmdb_changes`         | TMDB `/changes` deltas for tracked titles                       |
| `0 5 * * *` | `refresh_degree`       | `REFRESH MATERIALIZED VIEW CONCURRENTLY core.node_degree`       |
| `0 5 * * 0` | `recompute_similar`    | Rebuild `core.edge_derived`                                     |
| `0 6 * * 0` | `recompute_bacon`      | Bacon numbers (Phase 2)                                         |
| `0 7 * * *` | `refresh_availability` | Watch providers (Phase 2)                                       |
| `0 3 * * 1` | `wikidata_enrich`      | SPARQL pull for new titles                                      |
| `0 2 * * *` | `housekeeping`         | Prune `raw`, expire shares, data-quality checks, vacuum analyze |

Cron endpoints authenticate with `CRON_SECRET` compared in constant time.

## Caching

| Layer                   | What                                      | TTL / invalidation                                                                |
| ----------------------- | ----------------------------------------- | --------------------------------------------------------------------------------- |
| Next data cache         | TMDB responses                            | search 300s · detail 86400s · credits 86400s · trending 21600s · providers 43200s |
| `unstable_cache` + tags | `sem.title`, `sem.title_full`, `sem.node` | Tagged `title:<id>`, invalidated on ingest                                        |
| Route segment           | `/s/[slug]`, `/explore/**`                | `revalidate: 3600`, tag-invalidated                                               |
| **No cache**            | anything under `usr.*`                    | Per-request; `revalidateTag('user:<id>')` after mutations                         |
| CDN                     | OG images                                 | `immutable`, keyed by slug, purged on revoke                                      |
| Browser                 | TMDB images                               | Direct from `image.tmdb.org`                                                      |

## Images

TMDB images bypass the Next optimizer — [ADR 0012](adr/0012-tmdb-images-bypass-next-optimizer.md).
A custom loader maps requested width to the nearest TMDB bucket (`w92`/`w185`/`w342`/`w500`/`w780`).

## Errors, logging, observability

- Typed `Result<T, AppError>` at repository boundaries for expected failures (not found, forbidden,
  provider unavailable). Thrown exceptions only for programmer errors.
- `error.tsx` per route segment with a real recovery action.
- Structured JSON via `pino` to stdout: one line per mutation and per external call
  (`{ event, account_id, entity, duration_ms, status }`). Never log tokens, emails, or note bodies.
- Sentry (free tier) for exceptions, Vercel Analytics for Web Vitals. No third product.
- `/api/health` — see [deployment.md](deployment.md).
