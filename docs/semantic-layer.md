# Semantic layer

Not a metrics catalog in a BI tool. Three concrete things:

1. **A vocabulary boundary.** Application code cannot express a query in provider terms. There is no
   `tmdb_id` anywhere in `src/app`. Enforced by ESLint and `scripts/check-layers.sh`.
2. **SQL views that speak the ontology.** Stable contracts; provider changes are absorbed in `core`
   ingest and the views do not move.
3. **A declarative metric layer** so "genre distribution" is a definition, not a query hardcoded in
   a React component.

## View catalog

```
sem.title               canonical title + genre/theme label arrays, franchise, primary_director,
                        fully-qualified image URLs, accent_color, provenance summary
sem.title_full          sem.title + nested cast/crew jsonb, for single-query detail hydration
sem.season, sem.episode
sem.person              + role_summary jsonb {director: 12, actor: 3}, known_for
sem.character           + portrayers
sem.concept             + scheme, parent path, title_count
sem.collection, sem.organization, sem.work
sem.node                POLYMORPHIC (type, id, label, sublabel, image_url, degree)
                        the unified node surface for graph rendering and typeahead
sem.edge                unified edge surface (credit ∪ edge ∪ edge_derived)
sem.edge_bidirectional  + inverse rows
sem.availability        region-filtered, current only

-- RLS-scoped:
sem.user_title          status, is_favorite, rating (0.5-5.0), view_count, first/last_watched_at,
                        days_on_watchlist, progress_episodes_watched/total/pct,
                        next_episode_id, next_episode_label
sem.user_viewing
sem.user_taste_affinity account_id, node_type, node_id, affinity_score, n_titles, avg_rating
sem.user_timeline       viewing + state events unioned, for the activity feed
```

## `sem.user_title` is where the architecture pays off

It joins `usr.title_state`, current `usr.rating`, aggregated `usr.viewing`, and derived episode
progress into one row per user x title. Every list screen, card, and status chip reads from this one
view. Without it, "show the watchlist with progress and ratings" is a four-table join repeated in a
dozen components.

`progress_pct` uses `episodes_watched / episodes_aired`, **not** `episodes_total` — a show mid-season
should not read 40% when you are caught up. `next_episode_id` is the lowest-numbered aired,
unwatched episode. Both computed in SQL, never in TypeScript.

## `sem.user_taste_affinity` — the bridge to analytics and AI

```sql
SELECT account_id, e.object_type AS node_type, e.object_id AS node_id,
       count(*) FILTER (WHERE ut.status = 'watched')            AS n_titles,
       avg(ut.rating) FILTER (WHERE ut.rating IS NOT NULL)      AS avg_rating,
       (ln(1 + count(*))
         * (1 + coalesce(avg(ut.rating) - um.mean_rating, 0) / 2)
         * recency_decay(max(ut.last_watched_at)))              AS affinity_score
FROM sem.user_title ut
JOIN sem.edge_bidirectional e
  ON e.subject_type = 'title' AND e.subject_id = ut.title_id
JOIN usr.user_mean um USING (account_id)
WHERE ut.status = 'watched'
  AND e.predicate IN ('directed_by','features_actor','belongs_to_genre',
                      'explores_theme','part_of_franchise')
GROUP BY 1, 2, 3;
```

One view answers favorite directors, most-watched actors, genre distribution, theme distribution,
and supplies recommendation seeds. Five product features, one definition. Plain view in MVP (the
data is tiny); materialized per-account in Phase 2 with refresh queued on write.

## `ontology/metrics.yaml`

Metrics are defined declaratively and compiled by `src/lib/metrics/` to parameterized SQL with the
account filter injected server-side.

**Deliberate scope limit: the resolver is ~200 lines and supports six transforms
(`none`, `share_of_total`, `rank`, `bucket`, `rate`, `time_series`). This is not dbt and must not
grow into one.** If a metric needs something outside that vocabulary, write a dedicated `sem.*`
view — do not extend the resolver. Overbuilding this is the trap; the value is that metrics are
defined once, declaratively, next to the ontology.

A test asserts every metric sources from `sem.*` and uses a declared transform.

## Query conventions

- Application code imports from `src/server/repos/`, never from `drizzle/schema/core*`.
- Repository functions touching user data take `accountId` as the **first parameter**.
- Raw SQL via `drizzle-orm/sql` is fine and expected for graph traversal. There is no attempt to
  express recursive traversal in an ORM DSL.
- Predicate names and column identifiers in dynamic graph SQL are validated against the generated
  ontology allowlist — **never string-interpolated from user input**.
