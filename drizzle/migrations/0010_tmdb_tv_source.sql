-- TMDB numbers movies and TV in SEPARATE spaces. Movie 1402 is The Pursuit of
-- Happyness; TV 1402 is The Walking Dead. external_id's key is
-- (source, source_id, entity_type), so ('tmdb', '1402', 'title') could hold only
-- one of them -- and whichever was ingested second was merged into the first.
--
-- Shows move to their own source so both can exist. Movies stay on 'tmdb', so
-- the 4,683 movie rows and every reader of them are untouched; only shows move.
--
-- Why a separate source and not the `${kind}:${id}` prefix organizations use:
-- titles are read in ~15 places, many of which do Number(source_id) and then
-- skip anything non-finite. A prefix would turn every missed reader into a
-- silent skip -- refresh_stale quietly refreshing nothing. A separate source
-- keeps source_id a plain number everywhere, so a missed reader fails on shows
-- alone, and visibly, rather than on everything, quietly.
--
-- Idempotent and run once (core.__migrations), in a transaction.
UPDATE core.external_id x
SET source = 'tmdb_tv'
FROM core.title t
WHERE x.source = 'tmdb'
  AND x.entity_type = 'title'
  AND x.entity_id = t.id
  AND t.kind = 'show';
