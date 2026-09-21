# ADR 0006 — TMDB as spine, Wikidata as ontology enricher

**Date:** 2026-09-20 · **Status:** Accepted

## Decision

**TMDB** is the canonical spine for titles, people, credits, seasons, episodes, and images. Free for
non-commercial use with mandatory attribution; ~50 req/s; carries `imdb_id`, which gives a free
second key for crosswalking.

**Wikidata** is the ontology enricher. CC0, no key. It supplies exactly what TMDB lacks:
`based_on` links to books with authors, franchise/series membership, `influenced_by`, and awards.
The two join through the IMDb ID both carry.

## Why the pairing is the actual insight

TMDB has excellent _catalog_ data and a weak _ontology_ — its "keywords" are a ~40k-term folksonomy,
its collections are inconsistent, and it has no notion of adaptation source or influence. Sourcing
on _what a provider models_ rather than on popularity is the decision worth defending.

## Rejected

- **IMDb datasets** — non-commercial bulk TSV, 1GB+, no images, blends poorly with lazy ingest.
- **JustWatch direct API** — unofficial, licensing risk, no upside over the TMDB route.
- **OMDb as a primary** — 1,000 req/day cap makes it unsuitable for bulk; fine as a lazy Phase 2
  enrichment for external ratings.
- **TVmaze** — good episode air-date data, but TMDB is usually sufficient. Optional Phase 2.

## Obligations

TMDB attribution is ship-blocking and test-asserted. Availability data (via TMDB `watch/providers`)
additionally requires JustWatch attribution, logo, and a region-specific link on every surface that
shows it — TMDB revokes API access for non-compliance. If we cannot do the attribution properly, we
ship no availability at all. Tracked in [attribution.md](../attribution.md).
