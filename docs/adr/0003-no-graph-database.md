# ADR 0003 — No graph database; Postgres behind a swappable engine interface

**Date:** 2026-09-20 · **Status:** Accepted

## Context

The product is built on a knowledge graph, which creates an obvious pull toward Neo4j or similar.
Reaching for a graph database because the domain has a graph is a bad reason.

## Sizing

|                       | MVP (5k titles) | 10x (50k titles) |
| --------------------- | --------------- | ---------------- |
| `core.credit`         | ~150,000        | ~1,500,000       |
| `core.edge` + derived | ~110,000        | ~1,100,000       |
| **Total edges**       | **~260,000**    | **~2,600,000**   |

2.6M edges is a small graph. A 3-hop bounded expansion with a covering index on
`(subject_type, subject_id, predicate)` is single-digit milliseconds. Graph databases earn their
keep at 10^8 edges, or when unbounded variable-length pattern matching is in the hot path.

## Decision

One PostgreSQL 17 database on Neon. No second store.

Four decisive arguments:

1. **The user layer must join to the graph.** "My watched films by director", "themes I rate
   highest", "how much of this franchise have I seen" — each is a join between `usr.title_state` and
   the graph. In one database that is a query the planner optimizes; across two stores it is
   application-level join code, and it is the code we would write most often.
2. **Entity resolution would run twice,** or need a sync pipeline with its own consistency failures.
   The worst possible outcome is a demo where the graph and the tracker disagree about a movie.
3. **Operational cost.** AuraDB Professional is ~$65/mo against a ~$20/mo total budget, for a second
   backup story, migration tool, connection pool, and credential set.
4. **Serverless fit.** Neon's HTTP/WebSocket driver is built for ephemeral functions; bolt drivers
   are a known friction point.

## The counter-argument, fairly

"I used Neo4j" is more legible at a glance on a portfolio. I think that is backwards for this
audience: a senior data architect is more impressed by a well-indexed reified-edge model, a
hub-penalized path ranker in SQL, an ontology compiled to DDL constraints, and a written rationale
for _not_ over-engineering. Choosing correctly and saying why is the senior signal.

## Escape hatch

All traversal goes through `src/lib/graph/engine.ts` exposing `neighbors`, `expand`, `findPaths`,
`shortestPath`, backed by `PostgresGraphEngine`. Swapping the implementation is a one-file change.

**Revisit when any of:** p95 `findPaths` > 250ms · total edges > 5M · a required feature needs
unbounded variable-length pattern matching. Note Neon does not ship Apache AGE; wanting AGE means
changing host, not just extension.
