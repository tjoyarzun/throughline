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

Reconciled with Asana 2026-09-25 (project `throughline-ontology`, 14 open / 14 shipped) and each
item commented there with its priority, size and the specific thing I need. Sizes: XS under an
hour, S half a session, M a session or two, L multiple.

Ordering weighs the same four things as before: **daily utility for the two real users**, **whether
it demonstrates the ontology is load-bearing**, **effort**, and **what unblocks what**. Bugs come
first regardless, because a wrong number on screen costs trust that features have to earn back.

### P1 — Wrong now

| Asana            | Item                   | Size | State                           |
| ---------------- | ---------------------- | ---- | ------------------------------- |
| 1217468989312593 | Streak count is wrong  | S    | **Diagnosed.** Needs a decision |
| 1217468989312580 | Top-of-screen blur bug | XS   | **Blocked** on a repro          |

**The streak counts sessions, not days.** It reads `usr.auth_session.created_at`, so it measures
consecutive days on which you CREATED a session. Sessions are 30-day rolling with a 7-day refresh,
so somebody who stays signed in and opens the app daily has one row and a permanent streak of 1.
Measured: `local@test.local` has 25 session rows across 2 distinct days. The fix needs a decision
about what the number should mean — days opened (new table), days you did something (derivable
from `usr.state_event`, no new writes, and the better metric), or delete it.

### P2 — Small and used daily

| Asana            | Item                                     | Size | Note                                                 |
| ---------------- | ---------------------------------------- | ---- | ---------------------------------------------------- |
| 1217468948408874 | Movie / TV toggle                        | S    | `core.title.kind` already exists; this is a chip row |
| 1217468948408871 | Persona card: don't render until sharing | S    | Design half shipped; the eager PNG remains           |
| 1217468989312594 | Admin sections collapsible               | XS   | Same `<details>` device as the ontology panel        |

The Movie/TV toggle is the first feature that spends the unified `title` table (ADR 0004), and it
wants to live in the same chip row as the genre filter — build one control, not two.

### P3 — The constellation, as one project

| Asana            | Item                                    | Size                     |
| ---------------- | --------------------------------------- | ------------------------ |
| 1218792854089672 | The constellation on a phone            | M (one of three shipped) |
| 1217468948408873 | Minimize the jump when clicking through | M                        |

**These are one piece of work.** Both need a camera — a transform the canvas does not currently
own — and building it twice would be the waste. The loading-skeleton third of the first card
shipped 2026-09-23. What remains: a hit-test radius decoupled from the drawn radius (nodes are
3.5–11.5px against this app's own 44pt floor), pan and zoom, and position continuity for nodes
present in both views.

### P4 — Blocked on a direction from you

| Asana            | Item                           | Size | What is missing                          |
| ---------------- | ------------------------------ | ---- | ---------------------------------------- |
| 1217468948408872 | Enhance find the throughline   | ?    | Which part disappoints                   |
| 1217468989312578 | Better mobile app icon         | M    | A design direction; the plumbing is done |
| 1217468989312581 | Share a card image, not a link | S–M  | Same preview blocker as the persona card |

The share-card and persona-card items share one blocker: `/s/[slug]/opengraph-image` is keyed on a
share slug, so a card cannot be rendered without first committing a permanent public URL. The
persona card already solved this by rendering from the session instead. Deciding it once settles
both.

### P5 — Real features, not urgent

| Asana            | Item                            | Size | Note                                                    |
| ---------------- | ------------------------------- | ---- | ------------------------------------------------------- |
| 1217468989312587 | Genre filters — Search half     | S    | Library shipped; the rails are the part worth filtering |
| 1217468989312583 | International films — seed half | S    | Person detail done; Portuguese is 26 titles             |
| 1217468989312592 | Letterboxd                      | L    | Import only; their API has no public write              |

### P6 — Argued against as written

| Asana            | Item                       | Size |
| ---------------- | -------------------------- | ---- |
| 1217468989312591 | Instagram-style navigation | L    |

The five-tab bar is a decision (five over four-plus-FAB, because create is always search-then-add).
Worth revisiting if it is failing in use, but the item should start from what is wrong rather than
from another app's shape.

## Decided against: an iOS splash screen

Raised 2026-09-23 because a cold launch showed black on mobile, and **declined after the cause was
fixed instead.** Do not re-propose it.

The black screen was the symptom; the cause was the service worker, which was network-first for
navigations and so reached for its page cache only when `fetch` threw — meaning every launch
blocked on a server round trip (measured: 1.0–1.9s cold, 0.36–0.7s warm) while the cache sat
unused except offline. Navigations are stale-while-revalidate now.

A splash screen would not have made anything faster; it would have made the wait look deliberate.
It is also fragile: iOS matches `apple-touch-startup-image` by exact per-device media query, and a
size you miss falls back to the blank screen anyway, for ten to fourteen generated PNGs of upkeep.

If launch ever feels slow again, the next lever is the bundle line above — not a splash screen.

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

These have no card. They are engineering debt and operational chores rather than product asks, so
they live here — but "not in Asana" has historically meant "forgotten", which is why each one names
what it costs.

- Manual keyboard and VoiceOver pass on a physical iPhone (AC-32, AC-33). axe covers about a third
  of WCAG and cannot judge focus order.
- A deliberate rollback drill, exercised once so it is known to work rather than assumed.
- **`enrich_wikidata` sweeps the whole corpus instead of enriching new titles.** The spec
  (docs/api.md, cron table) says "SPARQL pull for **new titles since last run**"; what was built
  pages through every title holding an IMDb id — 4,831 of them — by offset from zero, chaining to
  the end. It cannot do otherwise: `core.title` has `synced_at` for TMDB and **no marker for
  Wikidata**, so there is no way to ask which titles still need it. The fix is the shape
  `hydrate-people` already uses: add the marker, select `WHERE marker IS NULL`, and enqueue on
  ingest so it becomes trigger-based rather than a sweep somebody remembers to start. Wikidata
  facts are per-title and near-static (`based_on`, franchise, influence), so a clock was always the
  wrong instrument. Note this does not change how health judges it — queued-work is the right
  question whether the trigger is a person or an ingest.
- **First-load JS is 182 KB, against this project's own 130 KB budget (AC-27).** Measured against
  production on `/auth/signin` — eleven chunks in the initial HTML of a page that is a form with an
  input and a button. Being 40% over on the lightest route suggests something is reaching the
  shared chunk that should not be. An investigation before a fix: find out what is in there first.
- ~~Confirm the offline/cached paint on a real iPhone.~~ **Done 2026-09-25** — two launches on a
  device, reported good. That was the one claim the stale-while-revalidate change rested on and
  the one Playwright's WebKit cannot make: it refuses a navigation whose request is aborted while
  a worker is active. The Chromium test still stands; Safari is now confirmed by hand.
- Rotate the Resend API key.
- RLS on `usr.auth_session` — currently covered by a revoked grant, the same way `usr.invite` is.
- **Genre filters on Search** — the other half of Asana 1217468989312587. Worth deciding what it
  should filter before building it: search results are name matches, so the meaningful target is
  the browsing rails on the idle screen, not the result list.
