# ADR 0002 — Person is an entity; Actor, Director, and Writer are roles

**Date:** 2026-09-20 · **Status:** Accepted

## Context

The brief listed Actor, Director, and Writer alongside Person as candidate entity types. Modeling
them as separate entities is the classic novice ontology error.

## Decision

`core.person` is the only entity. Roles are **predicates** (`acted_in`, `directed`, `wrote`,
`composed_for`, `shot`) with `department`/`job` attributes on the credit row.

Three concrete harms avoided:

1. Denis Villeneuve would exist as both a Director and a Writer with no guarantee they are the same
   human, fragmenting his filmography and breaking entity resolution.
2. Path finding across "acted in, later directed" would become a cross-type join.
3. Every new role — composer, cinematographer, showrunner — would need a schema migration instead of
   a vocabulary addition.

The same reasoning applies twice more: `core.organization` unifies studio, network, distributor, and
streamer (Warner Bros. is all of them, under one corporate parent), with the role on the edge; and
`core.title` unifies movie and show, since they share ~90% of attributes and 100% of their edges.

## Guard

`tests/ontology/ontology.test.ts` asserts no entity type named `actor`, `director`, or `writer`
exists, and that the corresponding predicates have `person` in their domain. The test is the
regression guard.
