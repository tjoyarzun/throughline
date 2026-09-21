-- The semantic layer. Application code reads these and nothing else.
-- Provider schema changes are absorbed in core ingest; these contracts do not move.
--
-- EVERY view here is created WITH (security_invoker = true). This is not optional.
--
-- Postgres views execute with the privileges and RLS context of the view OWNER by
-- default. Our views are owned by the migration role, which bypasses RLS. Without
-- security_invoker, sem.user_title happily returned one user's ratings, history and
-- notes to any other user — while every base-table RLS test passed, because the
-- base tables were never the problem. The authz suite caught it; nothing else would
-- have. Requires Postgres 15+.

-- ── Recreate from scratch, every time ───────────────────────────────────────
--
-- CREATE OR REPLACE VIEW cannot rename a column, change its type, or insert a
-- column anywhere but the end. Adding `canonical_predicate` to
-- sem.edge_bidirectional failed with:
--
--   cannot change name of view column "path_weight" to "canonical_predicate"
--
-- Views hold no data, so dropping and recreating them costs nothing — and
-- because migrations now run on EVERY deploy (see docs/deployment.md), a view
-- change that only works against an empty database would have failed the next
-- production deploy rather than the first.
--
-- CASCADE also drops core.node_degree, which reads sem.edge. 50-matviews.sql
-- runs after this file and rebuilds it.
DROP VIEW IF EXISTS sem.title_full CASCADE;
DROP VIEW IF EXISTS sem.title_credit CASCADE;
DROP VIEW IF EXISTS sem.user_viewing CASCADE;
DROP VIEW IF EXISTS sem.user_title CASCADE;
DROP VIEW IF EXISTS sem.availability CASCADE;
DROP VIEW IF EXISTS sem.node CASCADE;
DROP VIEW IF EXISTS sem.concept CASCADE;
DROP VIEW IF EXISTS sem.person CASCADE;
DROP VIEW IF EXISTS sem.title CASCADE;
DROP VIEW IF EXISTS sem.edge_bidirectional CASCADE;
DROP VIEW IF EXISTS sem.edge CASCADE;

-- ── Unified edge surface ─────────────────────────────────────────────────────
-- Three physical shapes (typed credit, generic edge, derived edge), one logical
-- graph. The traversal layer never knows there is more than one table.
CREATE OR REPLACE VIEW sem.edge AS
  SELECT
    c.id,
    'person'::text                                          AS subject_type,
    c.person_id                                             AS subject_id,
    c.predicate,
    CASE WHEN c.episode_id IS NOT NULL THEN 'episode' ELSE 'title' END AS object_type,
    COALESCE(c.episode_id, c.title_id)                      AS object_id,
    jsonb_strip_nulls(jsonb_build_object(
      'billing_order', c.billing_order,
      'character_id',  c.character_id,
      'character',     c.character_name_raw,
      'job',           c.job
    ))                                                      AS attributes,
    'asserted'::text                                        AS provenance,
    c.confidence
  FROM core.credit c
  UNION ALL
  SELECT e.id, e.subject_type, e.subject_id, e.predicate, e.object_type, e.object_id,
         e.attributes, e.provenance, e.confidence
  FROM core.edge e
  UNION ALL
  SELECT d.id, d.subject_type, d.subject_id, d.predicate, d.object_type, d.object_id,
         d.attributes, 'derived'::text, d.confidence
  FROM core.edge_derived d;

-- Traversal has to walk edges in both directions. Doing it here rather than in
-- every query is what keeps the path-finding SQL readable.
--
-- CRITICAL: inverse rows carry an inverse predicate name (`directed_by`) that
-- does NOT exist in core.predicate_meta, which is keyed on canonical names
-- (`directed`). Any query that joins predicate_meta on `predicate` therefore
-- silently drops every inverse edge — half the graph — and returns nothing,
-- with no error. The first real path query hit exactly that.
--
-- So this view carries everything the path finder needs: the canonical
-- predicate for joining back when necessary, the weight, the label for
-- narration, and the intermediate-exclusion flag. Traversal never has to join
-- predicate_meta at all.
CREATE OR REPLACE VIEW sem.edge_bidirectional AS
  SELECT e.subject_type, e.subject_id, e.predicate, e.object_type, e.object_id,
         e.attributes, e.provenance, e.confidence,
         false AS is_inverse,
         e.predicate AS canonical_predicate,
         m.path_weight,
         m.label AS predicate_label,
         m.excluded_from_path_intermediates
  FROM sem.edge e
  JOIN core.predicate_meta m ON m.predicate = e.predicate
  WHERE NOT m.is_structural
  UNION ALL
  SELECT e.object_type, e.object_id, m.inverse, e.subject_type, e.subject_id,
         e.attributes, e.provenance, e.confidence,
         true AS is_inverse,
         e.predicate AS canonical_predicate,
         m.path_weight,
         m.inverse_label,
         m.excluded_from_path_intermediates
  FROM sem.edge e
  JOIN core.predicate_meta m ON m.predicate = e.predicate
  WHERE NOT m.is_structural AND NOT m.is_symmetric;

-- ── Node surfaces ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW sem.title AS
  SELECT
    t.id, t.slug, t.kind, t.title, t.original_title, t.release_date, t.end_date,
    t.runtime_minutes, t.status, t.overview, t.original_language, t.certification,
    t.poster_path, t.backdrop_path, t.accent_color, t.blur_hash,
    t.popularity, t.popularity_as_of, t.vote_average, t.vote_count,
    t.budget, t.revenue, t.homepage, t.synced_at,
    EXTRACT(YEAR FROM t.release_date)::int AS release_year,
    COALESCE((
      SELECT array_agg(c.label ORDER BY c.label)
      FROM core.edge e JOIN core.concept c ON c.id = e.object_id
      WHERE e.subject_type = 'title' AND e.subject_id = t.id
        AND e.predicate = 'belongs_to_genre' AND c.scheme = 'genre'
    ), '{}') AS genres,
    COALESCE((
      SELECT array_agg(c.label ORDER BY (e.attributes->>'salience')::numeric DESC NULLS LAST, c.label)
      FROM core.edge e JOIN core.concept c ON c.id = e.object_id
      WHERE e.subject_type = 'title' AND e.subject_id = t.id
        AND e.predicate = 'explores_theme' AND c.scheme = 'theme'
    ), '{}') AS themes,
    (SELECT p.name FROM core.credit cr JOIN core.person p ON p.id = cr.person_id
      WHERE cr.title_id = t.id AND cr.predicate = 'directed' AND cr.episode_id IS NULL
      ORDER BY p.popularity DESC NULLS LAST LIMIT 1) AS primary_director,
    (SELECT col.name FROM core.edge e JOIN core.collection col ON col.id = e.object_id
      WHERE e.subject_type = 'title' AND e.subject_id = t.id
        AND e.predicate = 'part_of_franchise' LIMIT 1) AS franchise,
    -- sort_title backs trigram search; tmdb_id lets the search repo dedup local
    -- against provider hits without reaching into core.external_id itself.
    t.sort_title,
    (SELECT x.source_id FROM core.external_id x
      WHERE x.entity_type = 'title' AND x.entity_id = t.id AND x.source = 'tmdb'
      LIMIT 1) AS tmdb_id
  FROM core.title t;

CREATE OR REPLACE VIEW sem.person AS
  SELECT
    p.id, p.slug, p.name, p.birthday, p.deathday, p.place_of_birth, p.biography,
    p.known_for_department, p.gender, p.profile_path, p.popularity, p.also_known_as,
    COALESCE((
      SELECT jsonb_object_agg(predicate, n)
      FROM (SELECT cr.predicate, count(DISTINCT cr.title_id) AS n
            FROM core.credit cr WHERE cr.person_id = p.id GROUP BY cr.predicate) s
    ), '{}'::jsonb) AS role_summary
  FROM core.person p;

CREATE OR REPLACE VIEW sem.concept AS
  SELECT c.id, c.scheme, c.slug, c.label, c.description, c.parent_id, c.is_curated,
    (SELECT count(*) FROM core.edge e
      WHERE e.object_type = 'concept' AND e.object_id = c.id) AS title_count
  FROM core.concept c;

-- Polymorphic node surface: graph rendering and typeahead read this one view
-- instead of a UNION written by hand at each call site.
CREATE OR REPLACE VIEW sem.node AS
  SELECT 'title'::text AS node_type, t.id, t.slug, t.title AS label,
         CASE WHEN t.release_date IS NOT NULL
              THEN EXTRACT(YEAR FROM t.release_date)::text ELSE NULL END AS sublabel,
         t.poster_path AS image_path, t.popularity
  FROM core.title t
  UNION ALL
  SELECT 'person', p.id, p.slug, p.name, p.known_for_department, p.profile_path, p.popularity
  FROM core.person p
  UNION ALL
  SELECT 'concept', c.id, c.slug, c.label, c.scheme, NULL, NULL FROM core.concept c
  UNION ALL
  SELECT 'collection', col.id, col.slug, col.name, col.kind, col.poster_path, NULL
  FROM core.collection col
  UNION ALL
  SELECT 'organization', o.id, o.slug, o.name, o.kind, o.logo_path, NULL
  FROM core.organization o
  UNION ALL
  SELECT 'character', ch.id, ch.slug, ch.name, NULL, NULL, NULL FROM core.character ch
  UNION ALL
  SELECT 'work', w.id, w.slug, w.title, w.kind, NULL, NULL FROM core.work w;

CREATE OR REPLACE VIEW sem.availability AS
  SELECT a.title_id, a.region, a.offer_type, a.link, a.observed_at,
         o.id AS organization_id, o.name AS provider_name, o.logo_path AS provider_logo
  FROM core.availability a
  JOIN core.organization o ON o.id = a.organization_id
  WHERE a.valid_to IS NULL OR a.valid_to > now();

-- Credits with the person and character resolved. One view for the cast list,
-- the crew highlight and a filmography, so none of them hand-roll the join.
CREATE OR REPLACE VIEW sem.title_credit AS
  SELECT
    c.id, c.title_id, c.person_id, c.predicate, c.department, c.job,
    c.billing_order, c.episode_count,
    p.name  AS person_name,
    p.slug  AS person_slug,
    p.profile_path,
    p.popularity AS person_popularity,
    coalesce(ch.name, c.character_name_raw) AS character_name,
    c.character_id
  FROM core.credit c
  JOIN core.person p ON p.id = c.person_id
  LEFT JOIN core.character ch ON ch.id = c.character_id
  WHERE c.episode_id IS NULL;

/**
 * Everything the detail page needs above the fold, in ONE query.
 *
 * The alternative is six round trips per page view — title, genres, themes,
 * cast, crew, franchise — which is the single biggest latency risk in the app
 * (docs/performance-log.md, bottleneck 2). Nesting them as jsonb costs one
 * scan and keeps the page under the 3-round-trip budget.
 */
CREATE OR REPLACE VIEW sem.title_full AS
  SELECT
    t.*,
    COALESCE((
      SELECT jsonb_agg(x ORDER BY x.billing_order NULLS LAST, x.person_name)
      FROM (
        SELECT person_id, person_slug, person_name, profile_path,
               character_name, billing_order
        FROM sem.title_credit
        WHERE title_id = t.id AND predicate = 'acted_in'
        ORDER BY billing_order NULLS LAST
        LIMIT 20
      ) x
    ), '[]'::jsonb) AS cast_members,
    COALESCE((
      SELECT jsonb_agg(x ORDER BY x.rank, x.person_name)
      FROM (
        SELECT person_id, person_slug, person_name, profile_path, job, predicate,
               CASE predicate WHEN 'directed' THEN 1 WHEN 'wrote' THEN 2
                              WHEN 'composed_for' THEN 3 ELSE 4 END AS rank
        FROM sem.title_credit
        WHERE title_id = t.id AND predicate <> 'acted_in'
      ) x
    ), '[]'::jsonb) AS crew,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('slug', w.slug, 'title', w.title, 'kind', w.kind,
                                          'author', ap.name))
      FROM core.edge e
      JOIN core.work w ON w.id = e.object_id
      LEFT JOIN core.person ap ON ap.id = w.author_person_id
      WHERE e.subject_type = 'title' AND e.subject_id = t.id AND e.predicate = 'based_on'
    ), '[]'::jsonb) AS based_on,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', col.id, 'slug', col.slug, 'name', col.name))
      FROM core.edge e
      JOIN core.collection col ON col.id = e.object_id
      WHERE e.subject_type = 'title' AND e.subject_id = t.id
        AND e.predicate = 'part_of_franchise'
    ), '[]'::jsonb) AS franchises
  FROM sem.title t;

-- ── User surface (RLS-scoped) ────────────────────────────────────────────────
-- Every list screen, card, and status chip reads this one view. Without it,
-- "the watchlist with progress and ratings" is a four-table join repeated in a
-- dozen components.
CREATE OR REPLACE VIEW sem.user_title AS
  SELECT
    ts.account_id,
    ts.title_id,
    t.kind,
    ts.status,
    ts.is_favorite,
    ts.favorited_at,
    ts.added_at,
    ts.started_at,
    ts.completed_at,
    (r.value::numeric / 2) AS rating,           -- 1..10 half-stars -> 0.5..5.0
    r.rated_at,
    (SELECT count(*) FROM usr.viewing v
      WHERE v.account_id = ts.account_id AND v.title_id = ts.title_id
        AND v.episode_id IS NULL)                                    AS view_count,
    (SELECT min(v.watched_on) FROM usr.viewing v
      WHERE v.account_id = ts.account_id AND v.title_id = ts.title_id) AS first_watched_on,
    (SELECT max(v.watched_on) FROM usr.viewing v
      WHERE v.account_id = ts.account_id AND v.title_id = ts.title_id) AS last_watched_on,
    GREATEST(0, (now()::date - ts.added_at::date))                   AS days_on_watchlist,
    prog.episodes_watched,
    prog.episodes_aired,
    -- Aired, not total: a show mid-season must not read 40% when you are caught up.
    CASE WHEN prog.episodes_aired > 0
         THEN round(100.0 * prog.episodes_watched / prog.episodes_aired)::int
         ELSE NULL END                                               AS progress_pct,
    nxt.id           AS next_episode_id,
    nxt.season_number,
    nxt.episode_number,
    nxt.name         AS next_episode_name,
    nxt.air_date     AS next_episode_air_date
  FROM usr.title_state ts
  JOIN core.title t ON t.id = ts.title_id
  LEFT JOIN usr.rating r
    ON r.account_id = ts.account_id AND r.title_id = ts.title_id AND r.superseded_at IS NULL
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE ep.air_date IS NOT NULL AND ep.air_date <= now()::date) AS episodes_aired,
      count(*) FILTER (WHERE pr.episode_id IS NOT NULL)                              AS episodes_watched
    FROM core.episode ep
    LEFT JOIN usr.episode_progress pr
      ON pr.episode_id = ep.id AND pr.account_id = ts.account_id
    WHERE ep.title_id = ts.title_id
  ) prog ON true
  LEFT JOIN LATERAL (
    SELECT ep.id, s.season_number, ep.episode_number, ep.name, ep.air_date
    FROM core.episode ep
    JOIN core.season s ON s.id = ep.season_id
    WHERE ep.title_id = ts.title_id
      AND NOT EXISTS (SELECT 1 FROM usr.episode_progress pr
                      WHERE pr.episode_id = ep.id AND pr.account_id = ts.account_id)
    ORDER BY s.season_number, ep.episode_number
    LIMIT 1
  ) nxt ON true;

CREATE OR REPLACE VIEW sem.user_viewing AS
  SELECT v.id, v.account_id, v.title_id, v.episode_id, v.watched_on, v.date_precision,
         v.companions, v.location, v.medium, v.is_rewatch, v.note, v.created_at,
         t.title, t.kind, t.poster_path
  FROM usr.viewing v JOIN core.title t ON t.id = v.title_id;

-- ── Security ────────────────────────────────────────────────────────────────
-- Set explicitly rather than at CREATE time: CREATE OR REPLACE VIEW cannot carry
-- WITH options, and these files are re-run on every migration.
ALTER VIEW sem.edge SET (security_invoker = true);
ALTER VIEW sem.edge_bidirectional SET (security_invoker = true);
ALTER VIEW sem.title SET (security_invoker = true);
ALTER VIEW sem.person SET (security_invoker = true);
ALTER VIEW sem.concept SET (security_invoker = true);
ALTER VIEW sem.node SET (security_invoker = true);
ALTER VIEW sem.availability SET (security_invoker = true);
ALTER VIEW sem.user_title SET (security_invoker = true);
ALTER VIEW sem.title_credit SET (security_invoker = true);
ALTER VIEW sem.title_full SET (security_invoker = true);
ALTER VIEW sem.user_viewing SET (security_invoker = true);
