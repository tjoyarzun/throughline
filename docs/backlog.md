# Backlog

Imported from Asana (project `throughline-ontology`, exported 2026-09-22) and ordered here.
Asana task ids are kept so the two can be reconciled; this file is the one that gets read at the
start of a session.

Ordering weighs four things, in this order: **daily utility for the two real users**, **whether it
demonstrates the ontology is load-bearing** (the portfolio thesis), **effort**, and **what unblocks
what**. Phase 10 shipped; everything here is Phase 2 in the spec's numbering.

## Already done — close it in Asana

| Asana            | Item                        | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1217468989312582 | Availability + release date | Shipped 2026-09-22. Stream/Free/Rent/Buy on the title page in the account's region, a Streaming sort in Library, full JustWatch attribution. Theatrical is explicitly not claimed — see docs/attribution.md.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 1217468989312579 | Popular right now is frozen | Shipped 2026-09-22. Live TMDB trending (daily window, 6h cache), merged with the corpus so held titles link to their real page and the rest hydrate on open. Falls back to the old stored ranking when the provider is unreachable.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 1217468989312584 | Enhance explore the graph   | Shipped 2026-09-22, completed 2026-09-23. Seeds come from your own library first, then trending intersected with the corpus, with stored popularity as the floor. The constellation half is now done too — see the three rows below.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 1217468989312590 | Public explore, no login    | Shipped 2026-09-23. `/explore/[type]/[slug]` for six node types, server-rendered and indexable, reading `sem` only. A constellation canvas draws the neighborhood OVER the list rather than instead of it, so a crawler and a screen reader get the same facts.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 1217469158076975 | Admin panel                 | Shipped 2026-09-22. `/me` shows every user with watched / rated / episode counts, last sign-in and login-day streak; expands to active devices with revoke; mints invites and a share link carrying the code. All four sub-bullets are covered.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 1217469158076976 | The constellation           | Shipped 2026-09-23. A force-directed neighborhood, now the DEFAULT view of `/universe` and the opening view of `/explore`. **Not Sigma + graphology** — Canvas 2D with a Fruchterman-Reingold pass run to a fixed iteration budget and then stopped. One renderer for both surfaces; `orbit.tsx` deleted rather than left to drift.                                                                                                                                                                                                                                                                                                                                                       |
| 1217469158076978 | Your universe inside it     | Shipped 2026-09-23. Titles you track carry a gold ring — a ring, never a different fill, because fill already means entity type — with a "Yours · N of M" toggle that dims the rest. The signed-in view centers on the best-connected title in YOUR library; a cold account falls back to the curated opener.                                                                                                                                                                                                                                                                                                                                                                             |
| 1218746925860053 | Dark mode toggle            | Shipped 2026-09-23. System / Light / Dark on `/me`, per device in a cookie, applied server-side so the first paint is correct with no flash and it works before hydration. `themeColor` follows the choice, so the iOS status bar matches.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 1217468989312585 | Better back button          | Shipped 2026-09-23. Resolved server-side from `Referer`, so it NAMES the destination ("← Library") and returns to the exact screen including its query string. Added to title and person, which had none at all; replaced the three hardcoded "← Universe" links.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 1217468989312578 | Better mobile app icon      | **REOPENED — the ask is a better, cleaner, higher-quality DESIGN.** What shipped was a correctness fix: the manifest served one PNG as both `any` and `maskable`, the mark reached 0.406 of the canvas against a 0.4 safe radius, and circular launchers were clipping it. Four files now, a generator that refuses an unsafe maskable, plus 16/32px favicons. The plumbing is right; **the mark is untouched and is the actual work.** Whatever replaces it inherits that plumbing — the generator takes one SVG and the safe-zone check is automatic.                                                                                                                                   |
| 1217468989312581 | Share a card image          | **REOPENED, on two counts.** (1) The card should be SHOWN BEFORE a link is generated — today you tap Share, a share row is created, and only then does a Send card button appear; the image is never previewed. (2) The card's design should be cleaner and cooler. The mechanism is sound and stays: the PNG is prefetched with the share row so the tap calls `navigator.share` synchronously, because fetching at tap time is an await before `share()` and that kills the sheet on iOS. Previewing first means rendering the image WITHOUT committing a permanent public URL, which is a real change — the OG route is keyed on a share slug. Worth resolving before the design work. |

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

### 4. The constellation — SHIPPED 2026-09-23

Asana 1217469158076976, 1217468989312584, 1217469158076978 · **These were one project, not three**

Shipped, with one deliberate departure from the plan above worth recording: **it is not Sigma +
graphology.** It is Canvas 2D with a Fruchterman-Reingold pass run to a fixed iteration budget and
then stopped, which turned out to be the smaller and better answer — no 250KB dependency to keep
out of the shared bundle, no worker to coordinate, and the thing that actually made it look like a
network was a query change rather than a renderer change. One hop from any node reaches people,
concepts and studios, and this ontology has no edge joining those to each other, so the first
version drew a wheel: measured on Paris, Texas, 40 neighbors and exactly ZERO edges among them. Two
hops is what produces structure. No layout algorithm invents structure that is not there.

The personal layer landed with it — tracked titles ringed in gold, a "Yours · N of M" toggle — and
the hub now opens on the graph rather than on three cards describing it.

What did NOT ship is touch: on a phone the first contact with a node is a navigation, and there is
no pan or zoom. That is **item 8**, filed separately, because it is a different piece of work from
drawing the thing.

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

**Five of six shipped 2026-09-23** (`bdd0b62`). Two were then REOPENED on the design rather than the
engineering, which is the right outcome: the defects found were real and are fixed, and they were not
what was being asked for.

Small, independent, good filler between the larger items.

| Asana            | Item                                | Note                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1217468989312587 | Genre filters on Search and Library | **Half done, left open.** Library shipped: chips built from the reader's own rows, so no chip is ever a dead end. **Search is NOT done** — results there are name matches, where a genre filter does little; the browsing rails on the idle screen are the part worth filtering, and that is a separate decision.                                                                                                          |
| 1218746925860053 | Dark mode toggle                    | **Shipped — moved to the done table above.** System / Light / Dark on `/me`, stored per device in a cookie and applied server-side, so the first paint is correct with no flash and it works before hydration. `themeColor` follows the choice, so the iOS status bar matches.                                                                                                                                             |
| 1217468989312585 | Better back button                  | **Shipped.** Resolved server-side from `Referer`, so it names the destination ("← Library") and returns to the exact screen including its query string. Added to title and person, which had none; replaced the three hardcoded "← Universe" links.                                                                                                                                                                        |
| 1217468989312578 | Better mobile app icon              | **Shipped, as a correctness fix rather than a redesign.** The manifest served one PNG as both `any` and `maskable`; the mark reached 0.406 of the canvas against a 0.4 safe radius and was clipped by circular launchers. Four files now, a generator that refuses an unsafe maskable, plus 16/32px favicons. **The mark itself is unchanged** — if the complaint was the design rather than the crop, that is still open. |
| 1217468989312581 | Share a card image, not a link      | **Shipped, beside the link rather than replacing it** — a link unfurls richly AND stays tappable, so it stays the default. The PNG is prefetched with the share row so the second tap calls `navigator.share` synchronously; fetching at tap time is an await before `share()`, which kills the sheet on iOS.                                                                                                              |
| 1217468989312580 | Top-of-screen blur bug              | **Needs a repro.** The status-bar/safe-area issue was fixed in Phase 6; this is either a regression or a different thing, and which one changes the fix. Screenshot plus route and device.                                                                                                                                                                                                                                 |

### 8. The constellation, on a phone

Asana: not yet filed · Ontology & Data Model

Added 2026-09-23, after the constellation became the DEFAULT view of `/universe` rather than one
card among three. That change raised the bar for it: a thing you have to seek out can be
desktop-shaped, and a thing that opens on every visit cannot. Three defects, in the order they
cost you something.

**The loading skeleton draws the old page.** `(app)/universe/loading.tsx` still renders three nav
cards over an expanded ontology panel with eight predicate rows — the layout that was replaced.
What actually arrives is a header, a canvas, two cards, the neighbor lists and a COLLAPSED
footer, so every visit shows a promise of one shape and then snaps to another. That is a
straightforward CLS regression against AC-27 (< 0.05) on the app's most-visited portfolio
surface, and it is the cheapest of the three to fix.

**A tap goes straight through.** The canvas resolves labels on `onMouseMove` and navigates on
`onClick` (`constellation-canvas.tsx`) — which means on a touch screen there is no hover, so the
first contact with a node is a navigation. You cannot find out what something is without
committing to leaving the page. The fix is a two-stage touch interaction: first tap selects and
labels, second tap follows — with finger-sized hit targets, which is its own problem, because the
node radii are 3.5–11.5px and 44pt is the floor everywhere else in this app. That gap between the
DRAWN size and the TOUCHABLE size is the actual work; a hit-test radius independent of the render
radius is probably the shape of it.

**No pan or zoom.** The layout is fitted to the frame once and is then fixed, so a dense
neighborhood — Nolan is 80 nodes and 329 edges — is legible only at whatever scale happens to fit.
Pinch-to-zoom and drag-to-pan, touch first, on a canvas that already owns its own transform. Two
things to get right: the page must not scroll while a gesture is on the canvas
(`touch-action: none` on the element, not the document), and the existing `prefers-reduced-motion`
respect must survive — a gesture is direct manipulation, not an animation, so it should stay, but
any inertia or easing added along with it should not.

Sequencing: the skeleton is minutes and should not wait for the rest. The tap and the gesture work
share a hit-test and a transform, so they are one piece of work rather than two.

### 9. Letterboxd

Asana: filed 2026-09-23 · Ontology & Data Model

"Sync, upload, import — whatever makes sense." What makes sense is probably narrower than it
sounds, and the shape should be settled before any code.

**Verify first: Letterboxd has no public write API.** Their API has been in closed beta for years,
so continuous two-way sync is almost certainly not available to us, and anything that claims to do
it is scraping a logged-in session. Confirm current status before scoping — if it has opened up,
this item gets much larger and much better.

That leaves two halves, both real:

**Import, from their CSV export.** Letterboxd exports `watched.csv`, `ratings.csv`,
`diary.csv`, `watchlist.csv` and `reviews.csv`. The interesting part is what those files do NOT
contain: **no TMDB id.** Only a name, a year and a letterboxd.com URI. So every row has to be
resolved against the corpus by title and year — which is precisely the entity-resolution cascade
in docs/data-model.md, pointed at user-supplied data for the first time. It is the best stress
test that machinery will ever get, and the place where its honesty shows: rows that land in the
ambiguous band belong in a review queue the importer surfaces, not in a silent best guess. Confirm
the exact column set against a real export rather than trusting this list.

Ratings need a scale decision recorded: Letterboxd is 0.5-5.0 in half-stars, which happens to be
exactly this app's 1-10 smallint, so it maps without loss. Diary entries map to `usr.viewing` with
`is_rewatch`; watched-without-a-date maps to `date_precision = 'unknown'`, which is why that column
exists.

**Export, to their import format.** Cheap, and the honest counterpart: if someone's history can
come in, it should be able to leave. We already export JSON and CSV from `/me`; this is one more
shape of the same query, matching the columns their importer accepts.

Sequencing note: import makes the analytics and the Universe meaningful for a NEW user instantly,
which makes it worth more than its size suggests — a fresh account currently has to watch things
before it has a shape to look at.

### 10. Larger, or not yet specified

| Asana            | Item                           | Why it sits here                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1217468989312591 | Instagram-style navigation     | The current five-tab bar is a deliberate decision — five tabs over four-plus-FAB, because the create action here is always search-then-add, and everything primary sits in the bottom third for one-handed use. Worth doing if the current nav is actually failing in use, but it should start from what is wrong with it rather than from another app's shape.                                                                                                            |
| 1217468989312583 | International films and people | **Half done.** Person detail coverage is finished: the backfill completed 2026-09-23 at **59,026 of 59,027 (100%)**, up from 1.8% — weeks of queue-walk throughput collapsed into one run, because the walk was capped by Hobby's single daily drain window rather than by the work. What remains is the other half: **seed more Portuguese/Brazilian titles** (26 in the corpus), a script run, cheap. Neither half is "add international support" — that already worked. |

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
