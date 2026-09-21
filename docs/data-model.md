# Data model

Four schemas — see [ADR 0001](adr/0001-postgres-four-schema-separation.md). UUIDv7 for all entity
IDs (time-sortable, index-friendly, no coordination). Slugs are separate, stable, human-readable,
unique per type (`arrival-2016`, `denis-villeneuve`).

## `core` — nine node tables

```
core.title        id, slug, kind('movie'|'show'), title, original_title, sort_title,
                  release_date, end_date, runtime_minutes, status, overview,
                  original_language, certification, poster_path, backdrop_path,
                  accent_color, blur_hash, popularity, popularity_as_of,
                  vote_average, vote_count, budget, revenue, homepage, adult,
                  created_at, updated_at, synced_at
core.season       id, title_id FK, season_number, name, overview, air_date,
                  episode_count, poster_path      UNIQUE(title_id, season_number)
core.episode      id, season_id FK, title_id FK (denormalized for query speed),
                  episode_number, absolute_number, name, overview, air_date,
                  runtime_minutes, still_path     UNIQUE(season_id, episode_number)
core.person       id, slug, name, sort_name, also_known_as text[], birthday, deathday,
                  place_of_birth, biography, known_for_department, gender,
                  profile_path, popularity, popularity_as_of
core.character    id, slug, name, canonical_name, description, collection_id FK NULL
core.concept      id, slug, scheme, label, description, parent_id FK NULL, is_curated
                  UNIQUE(scheme, slug)
core.collection   id, slug, kind, name, overview, poster_path
core.organization id, slug, name, kind, country, logo_path, parent_org_id FK NULL
core.work         id, slug, kind, title, author_person_id FK NULL, first_published, isbn
```

`title` unifies movie and show: they share ~90% of attributes and **100% of their edges**. Splitting
would double every join in the graph layer and force `UNION ALL` into every traversal. Seasons and
episodes attach only to `kind='show'`, enforced by trigger.

`organization` unifies studio/network/distributor/streamer — the role is on the edge. See
[ADR 0002](adr/0002-person-entity-roles-as-predicates.md).

## `core` — relationships

Hybrid, per [ADR 0004](adr/0004-credit-table-vs-generic-edge.md):

```
core.credit        id, person_id, title_id, episode_id NULL, predicate, department, job,
                   character_id NULL, character_name_raw, billing_order, episode_count,
                   source, source_credit_id, confidence
core.edge          id, subject_type, subject_id, predicate, object_type, object_id,
                   attributes jsonb, provenance('asserted'|'curated'), source, source_ref,
                   confidence, valid_from, valid_to, created_at, created_by
                   UNIQUE(subject_type, subject_id, predicate, object_type, object_id)
                   CHECK (predicate IN (...))        <- GENERATED
core.edge_derived  ...same..., method, score, computed_at        <- TRUNCATE-safe
```

`sem.edge` unions all three. `sem.edge_bidirectional` adds the inverse of every edge using the
declared inverse predicate, so traversal SQL stays readable.

## `core` — supporting

```
core.external_id    (source, source_id, entity_type) PK -> entity_id, is_primary, last_verified
core.entity_alias   entity_type, entity_id, alias, alias_type, lang
core.merge_log      surviving_id, merged_id, reason, evidence jsonb, merged_at, reverted_at
core.availability   (title_id, organization_id, region, offer_type) PK, link, observed_at, valid_to
core.node_degree    MATVIEW: node_type, node_id, degree, degree_by_predicate   (nightly)
core.person_bacon   person_id PK, bacon_number, via_person_id, via_title_id     (Phase 2)
core.job            id, kind, payload, status, attempts, run_after, locked_at, last_error
core.path_cache     pair key, paths jsonb, computed_at
core.crosswalk_keyword_theme   keyword_source_id, keyword_label, concept_id, salience, decided_by
core.er_review      candidate pair, evidence jsonb, status
```

## Indexes (load-bearing, not incidental)

```
core.credit   (title_id, predicate, billing_order)    ordered cast list
              (person_id, predicate)                  filmography
              (character_id) WHERE character_id IS NOT NULL
core.edge     (subject_type, subject_id, predicate)
              (object_type, object_id, predicate)     reverse traversal
core.title    GIN to_tsvector('simple', title || ' ' || original_title)
              GIN (sort_title gin_trgm_ops)           fuzzy ER matching
              (popularity DESC) WHERE kind = 'movie'
```

## `usr` — user-owned

```
usr.account          id, email CITEXT UNIQUE, email_verified_at, display_name, avatar_url,
                     region, locale, theme_pref, created_at, deleted_at
usr.invite           id, code, email NULL, created_by, redeemed_by, expires_at, redeemed_at
usr.title_state      (account_id, title_id) PK, status, is_favorite, favorited_at,
                     added_at, started_at, completed_at, updated_at
usr.state_event      id, account_id, title_id, event_kind, from_status, to_status,
                     occurred_at, source        <- APPEND ONLY
usr.rating           id, account_id, title_id, value smallint CHECK (1..10),
                     rated_at, superseded_at NULL, viewing_id NULL
usr.viewing          id, account_id, title_id, episode_id NULL, watched_on,
                     date_precision('exact'|'day'|'month'|'year'|'unknown'),
                     companions text[], location, medium, is_rewatch, note
usr.episode_progress (account_id, episode_id) PK, title_id, watched_at, viewing_id
usr.note             id, account_id, subject_type, subject_id, body, is_private
usr.share            id, slug UNIQUE, account_id, title_id, include_rating,
                     rating_snapshot, note_snapshot, message, created_at, revoked_at, view_count
```

Ratings are **half-stars stored as `smallint` 1..10** (displayed 0.5-5.0). The brief said "1-5
stars" but its own example showed 4.5.

## The three-way distinction

- **`usr.title_state`** — the standing relationship. One row. "Do I care about this, and where am I
  with it?"
- **`usr.viewing`** — a discrete event. Zero-to-many. "When did I watch it, with whom, where?"
- **`usr.rating`** — a judgment, versioned, optionally linked to a viewing, so "3 stars in 2019,
  5 on rewatch in 2026" is representable and is an interesting analytics signal.

Watching a film three times is 1 `title_state`, 3 `viewing`, 1-3 `rating` rows. MVP UI exposes
one-tap watched, an optional details sheet, and "log another viewing". The rest is model capability
held in reserve.

## Status state machine

```
(new) -> watchlist -> watching -> watched
              \          \-> abandoned (shows only)
               \-> watched (direct: "I saw this years ago")
```

- Any transition is legal (users correct mistakes); all are logged.
- Shows: first episode marked auto-transitions `watchlist -> watching`; the finale auto-transitions
  to `watched` **with a confirmation toast**, never silently.
- `watched` with zero viewings is legal; the UI creates a viewing with `date_precision='unknown'`
  so analytics can distinguish "watched, date unknown" from "watched on 2026-03-14". That
  nullability modeling is what separates a real data model from a toy.
