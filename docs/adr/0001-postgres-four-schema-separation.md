# ADR 0001 — Four-schema separation: raw / core / sem / usr

**Date:** 2026-09-20 · **Status:** Accepted

## Context

A semantic layer that application code can bypass is decoration. Most "semantic layer" projects
erode within a few sprints because nothing physically stops a component from reaching for a raw
provider field when it is in a hurry.

## Decision

Four Postgres schemas with distinct responsibilities:

| Schema | Contains                                                                    | Written by               | App reads?      |
| ------ | --------------------------------------------------------------------------- | ------------------------ | --------------- |
| `raw`  | Verbatim provider payloads as `jsonb` plus fetch metadata                   | Ingest only              | Never           |
| `core` | Canonical entities, edges, external-id crosswalk, merge log, volatile facts | Ingest and curation only | Never directly  |
| `sem`  | Views expressing business concepts                                          | (views)                  | **Exclusively** |
| `usr`  | Accounts, state, events, ratings, notes, shares                             | App, RLS-scoped          | Via `sem.*`     |

Enforced three ways, because convention alone does not hold:

1. **DB grants.** `app_web` has `SELECT` on `sem.*`, DML on `usr.*`, **no grants on `raw`**, and
   `SELECT`-only on `core`. It cannot write the global model at all.
2. **ESLint** bans `core.`/`raw.` literals and schema imports in `src/app`, `src/components`,
   `src/actions`.
3. **`scripts/check-layers.sh`** greps as a backstop, catching raw SQL in template literals and
   file types ESLint does not parse.

## Why `raw` exists

Not purism. **Replayability** — when the keyword-to-theme crosswalk changes (and it will,
repeatedly), we re-derive themes for the whole corpus from stored payloads instead of re-crawling
TMDB. **Debuggability** — "why is the director wrong?" is answered by diffing the stored payload
against `core`. Cost is trivial: ~5k titles at ~40KB of jsonb is about 200MB, pruned to consumed
fields after 90 days.

## Consequences

Positive: the semantic layer is structurally real; provider schema changes are absorbed in ingest
without moving the app; account deletion drops `usr.*` and leaves `core.*` untouched, which is the
cleanest possible demonstration of the separation.

Negative: four schemas is more ceremony than one; every new user-facing field needs a view change as
well as a table change. Accepted — that friction is the point.
