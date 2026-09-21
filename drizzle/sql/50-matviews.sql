-- Node degree, refreshed nightly. Powers the hub penalty in path ranking:
-- without it, every "why are these connected?" answer is "both are Drama".
DROP MATERIALIZED VIEW IF EXISTS core.node_degree;
CREATE MATERIALIZED VIEW core.node_degree AS
  SELECT node_type, node_id, count(*)::int AS degree
  FROM (
    SELECT subject_type AS node_type, subject_id AS node_id FROM sem.edge
    UNION ALL
    SELECT object_type,  object_id  FROM sem.edge
  ) s
  GROUP BY node_type, node_id;

CREATE UNIQUE INDEX node_degree_pk ON core.node_degree (node_type, node_id);
CREATE INDEX node_degree_high ON core.node_degree (degree DESC);

COMMENT ON MATERIALIZED VIEW core.node_degree IS
  'Refresh CONCURRENTLY nightly. Nodes above path_ranking.hub_degree_ban are banned
   from intermediate positions in path finding. See docs/adr/0010.';
