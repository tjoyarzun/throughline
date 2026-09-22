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

## JustWatch — LIVE as of 2026-09-22

Availability data reached through TMDB's `watch/providers` endpoint carries JustWatch's terms, and
**TMDB revokes API access for non-compliance.** Required on every surface showing provider data:

1. The JustWatch logo, gold preferred (black or white acceptable depending on background).
2. A **region-specific JustWatch link** for the title.
3. Attribution of the data source as JustWatch.

TMDB does not provide deep links to the providers themselves.

**If we cannot do this attribution properly, we ship no availability at all.** That is the decision,
not a preference — see [ADR 0006](adr/0006-tmdb-spine-wikidata-enrichment.md).

### How it is satisfied, and why it cannot drift

| Requirement               | Where                                                  |
| ------------------------- | ------------------------------------------------------ |
| JustWatch logo            | `public/justwatch.svg`, rendered by `WhereToWatch`     |
| Region-specific link      | the `link` TMDB returns per region, on the logo itself |
| Source named as JustWatch | "Streaming data by" beside the mark                    |

Three things make this hard to break rather than merely done once:

- **The logo and the offers are the same component.** There is no code path that renders a provider
  without the footer, because rendering one renders the other. Splitting them would be a deliberate
  edit, not an oversight.
- **No link, no section.** `WhereToWatch` returns `null` when the region link is absent rather than
  showing offers bare. Missing attribution degrades to showing nothing, which is the behavior the
  rule above demands.
- **A Playwright test asserts it against a seeded provider**, so it cannot pass by finding an empty
  section. Mutation-tested: stripping the mark while leaving the offers fails the test.

The logo is committed rather than hotlinked because the CSP allows `img-src 'self'` and would
silently block the same file from JustWatch's CDN — a compliance failure that would show up as a
missing image and nothing else. Its `viewBox` was corrected on import: JustWatch's export carries
`viewBox="0px 0px 66px 10px"`, and units make the attribute invalid, so browsers discard it and the
mark stops scaling.

### Not yet claimed

Theatrical availability is **not** shown. `watch/providers` does not carry it, and the release date
on a title page is TMDB's primary date, not a per-territory theatrical one — that needs
`/movie/{id}/release_dates`. Labeling what we have as a "US release date" would be a claim we
cannot support, so we do not.

## Wikidata

CC0. No attribution legally required. We credit it anyway in the provenance footer, because
provenance is a product feature here.

## Fonts

Instrument Serif, Inter, and Geist Mono are all open-licensed (SIL OFL). License files ship in
`public/fonts/` when self-hosted.
