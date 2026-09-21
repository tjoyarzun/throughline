# ADR 0004 — Hybrid edge storage: typed `core.credit` plus generic `core.edge`

**Date:** 2026-09-20 · **Status:** Accepted

## Context

A pure triple store is elegant and slow for the hottest query in the app (ordered cast list). A
fully normalized per-predicate table set is fast and makes generic traversal impossible.

## Decision

Two physical shapes, one logical surface.

- **`core.credit`** — the ~85% of edges that are cast and crew. Gets its own table because it needs
  `billing_order`, character linkage, department/job strings, and episode granularity. Putting that
  in `attributes jsonb` would make the cast-list query an unindexable jsonb sort.
- **`core.edge`** — the long tail: franchise membership, themes, genres, `based_on`, `produced_by`,
  `features_character`, `portrayed_by`, `broader_than`, `sequel_to`, `remake_of`, `influenced_by`.
- **`core.edge_derived`** — same shape, separately truncatable. Holds `similar_to` and future
  inference. `TRUNCATE` and recompute is always safe; provider facts and human curation cannot be
  destroyed by a bad inference run.
- **`sem.edge`** — a view unioning all three, so traversal sees one uniform surface.

## Consequences

The cast list is a single indexed scan. The graph layer never knows there are three tables. Cost is
one extra union in a view and the discipline of keeping the projection in sync with the credit
columns — covered by the ontology conformance tests.
