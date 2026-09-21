# ADR 0010 — Hub-penalized, diversity-filtered path ranking

**Date:** 2026-09-20 · **Status:** Accepted

## The problem

The shortest path between almost any two films is length 2 through a hub: both are `Drama`, both
were distributed by Warner Bros., both feature a prolific character actor. These paths are _true_
and _useless_. Meaningful path finding is a **ranking** problem, not a search problem. Getting this
wrong makes the product's headline feature worthless while appearing to work.

## Decision

```
cost(path) = sum of cost(edge_i)
cost(edge) = predicate_weight(p)
           x hub_penalty(intermediate_node)
           x (1 / confidence)
           x attribute_modifier          # billing_order <= 3 -> 0.85

hub_penalty(n) = 1 + 0.45 * ln(1 + degree(n))     # degree from core.node_degree

hard rules:
  - nodes with degree > 2000 are BANNED from intermediate positions
  - belongs_to_genre edges are excluded from intermediate positions outright
  - endpoints are never subject to hub rules
```

Weights live in `ontology/ontology.yaml` and are compiled into `PATH_WEIGHTS`. `directed` is 1.0;
`belongs_to_genre` is 4.5.

**Search:** bidirectional expansion, depth <= 3 per side, implemented as explicit depth-1/2/3 joins
unioned together — **not** a generic recursive CTE. Fixed-depth joins let Postgres use the covering
index and are far easier to `EXPLAIN` than recursive CTEs with array-based cycle detection.
Frontiers capped at 4,000 nodes per side with cost-ordered truncation.

**Diversity:** emit the top 3 after rejecting any path whose intermediate node set overlaps an
already-emitted path by more than 50%. Without this you get three near-identical paths through the
same director.

**Narration** is composed from per-predicate templates in the ontology. No model involved.

## Verification

A fixture set of 20 curated pairs records the expected top path. `Arrival` + `Blade Runner 2049`
must return the Villeneuve path first, and no returned path may use a genre edge as an intermediate.
