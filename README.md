# Throughline

A mobile-first media tracker built on an explicit ontology and a SQL semantic layer.

Two faces: a fast, cinematic tracker for movies and TV, and **The Universe** — an ontology explorer
whose headline capability is answering _"why are these two things connected?"_ with ranked,
narrated paths through a knowledge graph.

> _Arrival_ was **directed by** Denis Villeneuve, who **also directed** _Blade Runner 2049_.

Personal project. Invite-only. Next.js 16 on Vercel, one Postgres on Neon.

## Status

**Phase 0 complete** — the ontology compiles, the design tokens are contrast-tested, the app shell
renders, and CI is green. No database yet. See [docs/development-plan.md](docs/development-plan.md).

## Quick start

```bash
pnpm install
pnpm codegen      # compile ontology.yaml -> types, SQL constraints, reference docs
pnpm verify       # everything CI runs
pnpm dev
```

## What makes this more than a tracker

- **`ontology/ontology.yaml` is a build input, not a diagram.** It compiles to TypeScript types,
  Postgres `CHECK` constraints, a domain/range validation trigger, path weights, and narration
  templates. CI fails if the database and the ontology drift.
- **Four schemas, one direction.** `raw` -> `core` -> `sem` -> `usr`. Application code can query
  `sem.*` and nothing else — enforced by database grants, an ESLint rule, and a CI grep.
- **Person is an entity; Actor and Director are roles.** Villeneuve directs _and_ writes.
- **Path finding is a ranking problem.** Naive BFS says "both are Drama", which is true and
  useless. Paths are hub-penalized, predicate-weighted, and diversity-filtered.
- **A curated theme vocabulary, not a folksonomy.** 98 themes across 14 clusters, mapped from TMDB
  keywords through a reviewed crosswalk. Most keywords map to nothing, which is correct.

Start with [CLAUDE.md](CLAUDE.md), then [docs/architecture.md](docs/architecture.md).

## Documentation

|                                                                                             |                                                              |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [architecture.md](docs/architecture.md)                                                     | System shape, boundaries, failure policy                     |
| [product.md](docs/product.md)                                                               | Personas, jobs, routes, flows, MVP boundary                  |
| [ontology.md](docs/ontology.md)                                                             | The reasoning. Entity vs. role vs. concept; what we left out |
| [ontology-reference.md](docs/ontology-reference.md)                                         | Generated predicate tables                                   |
| [data-model.md](docs/data-model.md)                                                         | Schemas, indexes, state machine                              |
| [semantic-layer.md](docs/semantic-layer.md)                                                 | View catalog, metric contract                                |
| [graph.md](docs/graph.md)                                                                   | Three modes, path algorithm, accessibility                   |
| [security.md](docs/security.md)                                                             | Threat model, RLS, the serverless-driver gotcha              |
| [ui.md](docs/ui.md)                                                                         | Design system, WCAG 2.2 AA criteria                          |
| [api.md](docs/api.md) · [testing.md](docs/testing.md) · [deployment.md](docs/deployment.md) |                                                              |
| [adr/](docs/adr/)                                                                           | 13 architecture decision records                             |

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.
See [docs/attribution.md](docs/attribution.md).
