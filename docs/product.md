# Product

> Most trackers answer _"what have I watched?"_ Throughline answers _"what is the shape of what
> I've watched, and how does it connect to everything else?"_

## Personas

- **P1 Tommy** — builder and primary user. Highest-frequency job: _"I just finished this, mark it
  and rate it in under 10 seconds, one-handed, in the dark."_
- **P2 Family member** — non-technical. Wants the shared watchlist, episode progress, and a
  good-looking link to send a friend. Will never open the Universe. Must never see P1's notes.
- **P3 Portfolio reviewer** — unauthenticated, arrives from a resume or a shared link. **Must reach
  something impressive without an account.** This is a hard requirement shaping the public routes.

## Jobs, ranked by frequency

| #   | Job                                  | Target cost                         |
| --- | ------------------------------------ | ----------------------------------- |
| 1   | Log and rate something just finished | <= 3 taps, <= 10s, thumb-reachable  |
| 2   | Scan the watchlist ("what tonight?") | <= 1 tap from launch                |
| 3   | Add something heard about            | <= 4 taps including search          |
| 4   | Resume a show — what episode am I on | <= 1 tap, visible on Home           |
| 5   | Send a recommendation                | <= 3 taps to the native share sheet |
| 6   | Explore a connection                 | 2 taps from any detail page         |
| 7   | Review my own taste                  | Secondary nav, monthly              |

Jobs 1-5 are the product; 6-7 are the portfolio. Navigation is optimized for 1-5, with 6-7 one level
deeper and deliberately more experimental in tone.

## Principles

1. The consumer surface never looks like a database. The Universe may use technical language; the
   tracker speaks English.
2. Capture beats completeness. Marking watched must never open a form.
3. Nothing is destroyed. State transitions append to an event log; ratings keep history; merges are
   reversible.
4. The global model is never contaminated by a user. Structural, via DB grants.
5. Every screen works one-handed. Primary actions live in the bottom third.
6. The graph must be legible before it is pretty. Narration ships before WebGL.
7. Volatile facts are quarantined.
8. Provenance is always recoverable.
9. Prefer deletion to configuration. Every vendor must beat a Postgres table doing 80% of the job.

## Navigation

Five tabs: **Home · Search · Library · Universe · Me**.

Universe is in primary navigation deliberately — the ontology is a destination, not an Easter egg.
The risk is that P2 never taps it; that is acceptable, and Home never depends on it.

## Routes

```
/                           Home                          auth
/search                     Search                        auth
/library[?list=]            Library (4 segments)          auth
/title/[slug]               Title detail                  auth
/title/[slug]/s/[n]         Season + episodes             auth
/person/[slug]              Person / filmography          auth
/universe                   Universe hub                  auth
/universe/explore[?focus=]  Focus + Constellation         auth
/universe/connect[?a=&b=]   Path finder                   auth
/universe/me                Personal graph + analytics    auth
/me                         Profile / settings            auth
/s/[slug]                   PUBLIC share page             none
/s/[slug]/opengraph-image   PUBLIC dynamic OG image       none
/explore/[type]/[slug]      PUBLIC ontology page (Ph. 2)  none
```

The two public families are how P3 gets value without an account. They render from `core`/`sem`
only, with the single exception of one `usr.share` row fetched by slug.

## Core flows

**F1 Capture (the 10-second flow).** Search -> 4 chars -> tap result -> detail -> tap `Watched` ->
rating sheet auto-presents -> drag to 4.5 -> dismiss. Behind it: canonical ingest fires on detail
open; `usr.title_state` upserts; `usr.state_event` appends; `usr.viewing` created with today's date
at `day` precision; `usr.rating` inserts.

**F2 Resume.** Home -> Continue Watching card -> long-press -> "Mark S2E5 watched". Two taps, no
navigation.

**F3 Add by swipe.** Search -> swipe right on the row -> toast with undo. Ingest is queued, not
blocking.

**F4 Share.** Detail -> share icon -> "with your rating" / "without" / "copy link". Creates a
`usr.share` row snapshotting rating and note, then calls `navigator.share()`.

**F5 Why are these connected.** Universe -> Connect -> pick A and B -> ranked, narrated paths.

**F6 Receive a share (P3).** Tap link in Messages -> unfurl already showed poster and stars ->
`/s/[slug]` renders in ~400ms from edge cache -> "Open in Throughline".

## MVP boundary

**In:** invite auth · search · canonical ingest · status lifecycle + favorites + half-star ratings ·
TV episode progress · viewing events · share pages with dynamic OG images · Universe Focus and Path
modes · five metrics · installable PWA with offline-read Library · health endpoint and admin views.

**Out:** streaming availability · Constellation WebGL mode · Kevin Bacon · households · custom
lists · external ratings · awards · AI · offline writes · public ontology pages · imports ·
notifications · native app.
