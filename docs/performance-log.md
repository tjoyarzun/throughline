# Performance log

A running record of measured budgets and regressions. Updated as part of each phase's definition of
done, including a `pg_stat_statements` top-10-by-total-time review once the database exists.

## Budgets (CI-enforced from Phase 10)

| Metric                             | Budget          |
| ---------------------------------- | --------------- |
| LCP (4G, mid-tier Android)         | < 2.0s          |
| INP                                | < 200ms         |
| CLS                                | < 0.05          |
| First-load JS, non-Universe routes | < 130KB gzipped |
| Universe route JS (lazy chunk)     | < 250KB gzipped |
| Title detail TTFB (warm)           | < 250ms         |
| Path finder p95 (warm)             | < 150ms         |

## Known bottlenecks and mitigations

| #   | Bottleneck                                 | Mitigation                                                                                                                                |
| --- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Poster loading — dozens of images per grid | Direct TMDB CDN at the right size bucket; lazy below fold, `priority` on the first 6; blur-up; SW cache-first; `content-visibility: auto` |
| 2   | Title detail fan-out                       | One `sem.title_full` query above the fold; below-fold streams via Suspense. Target <= 3 DB round-trips                                    |
| 3   | Search latency                             | 250ms debounce, 2-char minimum, abort in-flight, 300s cache, **local results render instantly** before TMDB merges in                     |
| 4   | Path finding                               | Depth 3+3, frontier cap 4000, hub ban, covering indexes, 7-day path cache, rate limited                                                   |
| 5   | Graph rendering on mobile                  | Focus caps at 32 SVG nodes; Constellation is desktop-default, lazy-chunked, worker layout with a fixed iteration budget                   |
| 6   | Cold starts                                | Neon Launch has no auto-suspend — this is what the $19 buys. HTTP driver avoids connection setup for reads                                |
| 7   | `user_taste_affinity` recomputation        | Plain view in MVP; materialized per-account in Phase 2                                                                                    |
| 8   | Bundle growth from the Universe            | Dynamic import + CI assertion the graph chunk is absent from the shared bundle                                                            |

## Measurements

### Phase 0 — 2026-09-20

Baseline, no database, static routes only.

| Route                                          | Rendering            |
| ---------------------------------------------- | -------------------- |
| `/`, `/search`, `/library`, `/me`, `/universe` | Static (prerendered) |

`pnpm build` completes in ~2s. No client JS beyond the Next runtime and `BottomNav`. Real
Web Vitals measurement begins once Vercel is connected and there is content to measure.
