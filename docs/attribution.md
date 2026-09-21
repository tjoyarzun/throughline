# Attribution obligations

Ship-blocking. Tracked here with the surface each appears on, and test-asserted.

## TMDB — required now

> This product uses the TMDB API but is not endorsed or certified by TMDB.

Plus the TMDB logo. Must appear on:

| Surface                                 | Status             |
| --------------------------------------- | ------------------ |
| App footer / `AttributionFooter`        | Phase 4            |
| `/me` about panel                       | Phase 3            |
| **Every public share page `/s/[slug]`** | Phase 7            |
| Public ontology pages `/explore/**`     | Phase 2 (deferred) |

Test: a Playwright assertion that the string is present on `/` and `/s/[slug]`.

TMDB is free for non-commercial use with attribution. A commercial license is $149/mo for companies
under $1M revenue. A personal portfolio project with no monetization is non-commercial.

## JustWatch — required if and when availability ships

Availability data reached through TMDB's `watch/providers` endpoint carries JustWatch's terms, and
**TMDB revokes API access for non-compliance.** Required on every surface showing provider data:

1. The JustWatch logo, gold preferred (black or white acceptable depending on background).
2. A **region-specific JustWatch link** for the title.
3. Attribution of the data source as JustWatch.

TMDB does not provide deep links to the providers themselves.

**If we cannot do this attribution properly, we ship no availability at all.** That is the decision,
not a preference — see [ADR 0006](adr/0006-tmdb-spine-wikidata-enrichment.md).

## Wikidata

CC0. No attribution legally required. We credit it anyway in the provenance footer, because
provenance is a product feature here.

## Fonts

Instrument Serif, Inter, and Geist Mono are all open-licensed (SIL OFL). License files ship in
`public/fonts/` when self-hosted.
