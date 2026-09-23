# Backlog

Imported from Asana (project `throughline-ontology`, exported 2026-09-22) and ordered here.
Asana task ids are kept so the two can be reconciled; this file is the one that gets read at the
start of a session.

Ordering weighs four things, in this order: **daily utility for the two real users**, **whether it
demonstrates the ontology is load-bearing** (the portfolio thesis), **effort**, and **what unblocks
what**. Phase 10 shipped; everything here is Phase 2 in the spec's numbering.

## Already done — close it in Asana

| Asana            | Item                        | Evidence                                                                                                                                                                                                                                                        |
| ---------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1217468989312582 | Availability + release date | Shipped 2026-09-22. Stream/Free/Rent/Buy on the title page in the account's region, a Streaming sort in Library, full JustWatch attribution. Theatrical is explicitly not claimed — see docs/attribution.md.                                                    |
| 1217468989312579 | Popular right now is frozen | Shipped 2026-09-22. Live TMDB trending (daily window, 6h cache), merged with the corpus so held titles link to their real page and the rest hydrate on open. Falls back to the old stored ranking when the provider is unreachable.                             |
| 1217468989312584 | Enhance explore the graph   | Shipped 2026-09-22 — the "does this list ever update" half. Seeds now come from your own library first, then trending intersected with the corpus, with stored popularity as the floor. The constellation half remains, grouped under item 4.                   |
| 1217468989312590 | Public explore, no login    | Shipped 2026-09-23. `/explore/[type]/[slug]` for six node types, server-rendered and indexable, reading `sem` only. A constellation canvas draws the neighborhood OVER the list rather than instead of it, so a crawler and a screen reader get the same facts. |
| 1217469158076975 | Admin panel                 | Shipped 2026-09-22. `/me` shows every user with watched / rated / episode counts, last sign-in and login-day streak; expands to active devices with revoke; mints invites and a share link carrying the code. All four sub-bullets are covered.                 |

## Verified before ordering

Three items were questions rather than work. The answers changed where they sit.

- **"Popular right now — is this updating?"** No. It is `ORDER BY sem.title.popularity DESC LIMIT 18`
  over the local corpus, and `popularity_as_of` is a seed snapshot: **4,969 titles stamped
  2026-09-20, 3 stamped 09-21**. `refresh_stale` touches a handful per run, so the ranking is
  frozen and deterministic — the same 18 posters forever. The instinct was right; this is a real
  defect, and a cheap one.
- **"Add international films and people — Sonia Braga is my test."** She is already in the corpus
  with 3 credits (_Bacurau_, _The First Omen_, _From Dusk Till Dawn 3_). The corpus is **30.4%
  non-English** — ja 497, fr 282, it 142, es 132, ko 123 — so this is not an ingest-capability gap.
  It is two narrower things: **Portuguese is 26 titles**, i.e. a seed-composition gap; and her page
  reads thin because person _detail_ (bio, birthday, place of birth) waits on the `hydrate_people`
  walk, which is at **1.8%** and advances ~350/day under Hobby's single daily drain window.
- **"Enhance explore the graph — does this list ever update?"** Not yet checked. Worth answering
  before building, the same way the two above were.

## Order

### 1. Availability — where to watch, and US release date

Asana 1217468989312582 · Discovery & Library

The highest daily utility of anything left, and the first question a second real user hits. Already
designed: TMDB `watch/providers`, region-aware, stored in `core.availability` with validity windows
— **not** as ontology edges, because availability is regional and weekly and would otherwise make
the graph change shape by territory (ADR 0007).

Ship-blocking condition: complete JustWatch attribution — logo plus a region-specific link on every
surface showing provider data. The spec is explicit that if the attribution cannot be done properly,
no availability ships at all.

### 2. "Popular right now" is frozen

Asana 1217468989312579 · Discovery & Library

Confirmed above. Small. Two candidate fixes, and they are not the same product:

- Rank by a **live TMDB trending** call, cached a few hours. Genuinely "right now", one API call,
  but the rail then shows titles the corpus may not hold.
- Keep it local and make `refresh_stale` actually refresh popularity broadly. Honest to the corpus,
  no new call, but "popular" then means "popular among the 4,990 we hold".

Worth deciding deliberately rather than by whichever is easier.

### 3. Public explore, no login

Asana 1217468989312590 · Ontology & Data Model

`/explore/[type]/[slug]`, server-rendered, indexable, reading `core`/`sem` only and never `usr`. The
only deep surface a reviewer reaches without an invite, and the spec flags it as arguably belonging
in MVP if portfolio timing demands it. Pairs with item 6 — a persona card is worth far more when the
link behind it opens something.

### 4. The constellation

Asana 1217469158076976, 1217468989312584, 1217469158076978 · **These are one project, not three**

Nodes and relationships as a full WebGL constellation, the user's own universe highlighted inside
the global graph, reached from a My Universe hub with explicit buttons to Throughline and Graph.
Sigma + graphology, dynamically imported, worker layout with a fixed iteration budget, node cap 600
— and CI already asserts the graph chunk stays out of the shared bundle.

This is the visual payoff of the whole thesis: "you have seen 4 of Villeneuve's 11" rendered rather
than stated. It is also the largest item here, which is why it sits below three cheaper ones.

### 5. Suggest what to watch

Asana 1217468989312588 · Ontology & Data Model

Recommendations from `sem.user_taste_affinity`, which already exists and already powers the five
metrics on `/universe/me`. Strong demonstration that the semantic layer is load-bearing: one view,
another feature, no new model. Constraint worth keeping — recommend only from titles the corpus
holds and the user has not marked watched, and say _why_ each one ("shares a director with 3 you
rated 4★+"), because the reason is the product.

### 6. Shareable watcher persona card

Asana 1217468989312589 · Ontology & Data Model

A short narrative persona built from the same affinity view, rendered through the `ImageResponse`
machinery already built for share cards. High delight per unit of work, and the most likely thing
anyone actually posts. Do it after 5 — the persona is a sentence about the taste graph, so the taste
graph should be able to speak first.

### 7. Cheap quality of life

**Five of six shipped 2026-09-23** (`bdd0b62`). The sixth still needs a repro.

Small, independent, good filler between the larger items.

| Asana            | Item                                | Note                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1217468989312587 | Genre filters on Search and Library | **Library shipped.** Chips built from the reader's own rows, so no chip is ever a dead end. **Search is NOT done** and is deliberately left open — results there are name matches, where a genre filter is of marginal use; the browsing rails are the part worth filtering, and that is a separate decision.                                                                                                              |
| 1218746925860053 | Dark mode toggle                    | **Shipped.** System / Light / Dark on `/me`, stored per device in a cookie and applied server-side, so the first paint is correct with no flash and it works before hydration. `themeColor` follows the choice, so the iOS status bar matches.                                                                                                                                                                             |
| 1217468989312585 | Better back button                  | **Shipped.** Resolved server-side from `Referer`, so it names the destination ("← Library") and returns to the exact screen including its query string. Added to title and person, which had none; replaced the three hardcoded "← Universe" links.                                                                                                                                                                        |
| 1217468989312578 | Better mobile app icon              | **Shipped, as a correctness fix rather than a redesign.** The manifest served one PNG as both `any` and `maskable`; the mark reached 0.406 of the canvas against a 0.4 safe radius and was clipped by circular launchers. Four files now, a generator that refuses an unsafe maskable, plus 16/32px favicons. **The mark itself is unchanged** — if the complaint was the design rather than the crop, that is still open. |
| 1217468989312581 | Share a card image, not a link      | **Shipped, beside the link rather than replacing it** — a link unfurls richly AND stays tappable, so it stays the default. The PNG is prefetched with the share row so the second tap calls `navigator.share` synchronously; fetching at tap time is an await before `share()`, which kills the sheet on iOS.                                                                                                              |
| 1217468989312580 | Top-of-screen blur bug              | **Needs a repro.** The status-bar/safe-area issue was fixed in Phase 6; this is either a regression or a different thing, and which one changes the fix. Screenshot plus route and device.                                                                                                                                                                                                                                 |

### 8. Larger, or not yet specified

| Asana            | Item                           | Why it sits here                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1217468989312591 | Instagram-style navigation     | The current five-tab bar is a deliberate decision — five tabs over four-plus-FAB, because the create action here is always search-then-add, and everything primary sits in the bottom third for one-handed use. Worth doing if the current nav is actually failing in use, but it should start from what is wrong with it rather than from another app's shape. |
| 1217468989312583 | International films and people | Split per the finding above: **seed more Portuguese/Brazilian titles** (a script run, cheap) is separate from **person detail coverage** (a throughput problem, months at the current drain). Neither is "add international support" — that already works.                                                                                                      |

## Known limit: search covers only people in the corpus

A person enters `core` through a **credit**, so someone with no credits on any title we hold has an
empty filmography. TMDB's multi-search returns such people, and surfacing them would promise a page
we cannot fill — so the provider's people are deliberately discarded and search answers from the
58,714 people already in the corpus. Anyone worth searching for is almost certainly among them.

Lifting this means ingesting a person's own filmography on open (TMDB `person/{id}/movie_credits`),
which pulls titles into the corpus as a side effect of a search. That is a real feature with real
scope, not a one-line change, and it belongs in its own item.

## Runbook: backfilling person detail

`scripts/hydrate-people.ts` does in ~35 minutes what the queue walk does in weeks, because the
walk is capped at one 45-second drain window a day by the Hobby plan, not by anything about the
work. Measured: 22.8 people/second against the client's 30/s token bucket.

```bash
# Name the database explicitly. --url beats every environment variable,
# including one left exported in the shell from an earlier command. Prefix the
# line with a space to keep the connection string out of your history.
 pnpm hydrate:people --url 'postgresql://…neon.tech/…'

pnpm hydrate:people                      # whatever .env.local names
pnpm hydrate:people --limit 500          # try it small first
pnpm hydrate:people --concurrency 4      # gentler on TMDB
```

**Check the first line says the database you meant.** A run launched with
`DATABASE_URL` set inline to a Neon string once wrote 59,809 rows to localhost,
because a `DATABASE_URL_UNPOOLED` left exported in that shell took precedence.
The script now refuses to guess when the environment names two different
databases — but `--url` is what makes the choice unambiguous.

It writes **straight to whichever database `DATABASE_URL` names**, with no local staging and no
export file, and that is the important part. Person ids are UUIDv7 generated at insert time in each
database independently, so local and production do not share them — local Scarlett Johansson has a
different uuid from production's. Dumping `core.person` from one and restoring into the other would
attach biographies to the wrong people. The only key the two environments agree on is the TMDB id,
which is what the script already fetches by. Resumable: it selects only `detail_synced_at IS NULL`,
so interrupting it loses nothing.

## Not in Asana, still owed

- Manual keyboard and VoiceOver pass on a physical iPhone (AC-32, AC-33). axe covers about a third
  of WCAG and cannot judge focus order.
- A deliberate rollback drill, exercised once so it is known to work rather than assumed.
- Rotate the Resend API key.
- RLS on `usr.auth_session` — currently covered by a revoked grant, the same way `usr.invite` is.
- **Genre filters on Search** — the other half of Asana 1217468989312587. Worth deciding what it
  should filter before building it: search results are name matches, so the meaningful target is
  the browsing rails on the idle screen, not the result list.
