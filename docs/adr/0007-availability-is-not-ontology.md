# ADR 0007 — Streaming availability is not an ontology edge

**Date:** 2026-09-20 · **Status:** Accepted

## Context

"Available on Netflix" looks like a relationship and is tempting to model as
`title --available_on--> organization`.

## Decision

It lives in `core.availability` with `(title_id, organization_id, region, offer_type)`,
`observed_at`, and `valid_to`. It is **not** in the edge store.

## Why

Availability is regional and changes weekly. As an edge it would make the graph change shape by
territory and by week, which destroys path-finding determinism — the same two films would be
"connected" in the US and not in the UK, and differently next Tuesday.

The general principle, applied across the model: **the ontology holds facts that are true
independent of time and territory.** Volatile scalars follow the same rule — `popularity` sits on
the entity with a `popularity_as_of` stamp rather than pretending to be stable.

## Consequences

Where-to-watch queries do not traverse the graph; they hit one indexed table with a region filter.
Path finding stays deterministic and cacheable.
