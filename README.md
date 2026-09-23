# Throughline

A mobile-first media tracker built on an explicit ontology and a SQL semantic layer.

Two faces: a fast, cinematic tracker for movies and TV, and **The Universe** — an ontology explorer
whose headline capability is answering _"why are these two things connected?"_ with ranked,
narrated paths through a knowledge graph.

> _Arrival_ was **directed by** Denis Villeneuve, who **also directed** _Blade Runner 2049_.

Personal project. Invite-only. Next.js 16 on Vercel, one Postgres on Neon.

**Live:** <https://throughline-ontology.vercel.app> — the tracker needs an invite, but
[**/explore**](https://throughline-ontology.vercel.app/explore) is public and needs no account.

## Status

**Shipped and in production.** Phases 0–10 are complete; the backlog is now Phase 2 work, tracked
in [docs/backlog.md](docs/backlog.md).

What a signed-in account gets: search, canonical ingest, the status lifecycle with half-star
ratings and viewing events, TV episode progress, availability (where to watch, region-aware),
Library with genre filters, share pages with dynamic OG images, suggestions that show their
reasoning, a shareable persona card, and The Universe — a force-directed constellation with your
own library marked inside it, plus the path finder.

The corpus, as deployed:

|                          |         |
| ------------------------ | ------: |
| titles                   |   5,012 |
| people                   |  59,027 |
| credits                  | 112,283 |
| asserted + curated edges |  39,037 |
| derived edges            |  69,372 |
| concepts                 |     145 |
| collections              |     741 |
| organizations            |   4,818 |
| source works             |     891 |

Seven graph node types, 21 declared predicates, 120 curated themes across 17 clusters.

## Quick start

```bash
pnpm install
cp .env.example .env.local        # fill in DATABASE_URL and TMDB_READ_ACCESS_TOKEN
pnpm db:migrate                   # schemas, generated constraints, views, RLS, roles
pnpm db:test-role                 # a non-superuser role, so RLS tests are not vacuous
pnpm seed                         # a corpus to work against
pnpm dev
```

Then `pnpm verify` runs everything CI does: codegen drift, typecheck, lint, locale, spelling,
layer boundaries, cron config, and the unit/integration suites. `pnpm e2e` runs Playwright against
Chromium and WebKit.

Scripts worth knowing about:

|                        |                                                                  |
| ---------------------- | ---------------------------------------------------------------- |
| `pnpm codegen`         | compile `ontology.yaml` → types, Zod, SQL constraints, docs      |
| `pnpm hydrate:people`  | bulk-fill person detail; pass `--url` to name the database       |
| `pnpm derive:themes`   | re-derive `explores_theme` edges from the keyword crosswalk      |
| `pnpm derive:similar`  | rebuild `core.edge_derived`                                      |
| `pnpm enrich:wikidata` | `based_on`, franchises, influence — the edges TMDB does not have |
| `pnpm invite`          | mint an invite code                                              |

## What makes this more than a tracker

- **`ontology/ontology.yaml` is a build input, not a diagram.** It compiles to TypeScript types,
  Postgres `CHECK` constraints, a domain/range validation trigger, path weights, and narration
  templates. CI fails if the database and the ontology drift.
- **Four schemas, one direction.** `raw` → `core` → `sem` → `usr`. Application code can query
  `sem.*` and nothing else — enforced by database grants, an ESLint rule, and a CI grep.
- **Person is an entity; Actor and Director are roles.** Villeneuve directs _and_ writes.
- **Path finding is a ranking problem.** Naive BFS says "both are Drama", which is true and
  useless. Paths are hub-penalized, predicate-weighted, and diversity-filtered.
- **Recommendations are ranked by the ontology, not by the query.** `core.predicate_meta` is
  generated from `ontology.yaml`, so a shared director outranks a shared actor because `directed`
  is 1.0 and `acted_in` is 1.4 _in the file_ — and every suggestion shows the edge it came from.
- **A curated theme vocabulary, not a folksonomy.** 120 themes across 17 clusters, mapped from TMDB
  keywords through a reviewed crosswalk. Most keywords map to nothing, which is correct.

Start with [CLAUDE.md](CLAUDE.md), then [docs/architecture.md](docs/architecture.md).

## Documentation

|                                                     |                                                              |
| --------------------------------------------------- | ------------------------------------------------------------ |
| [architecture.md](docs/architecture.md)             | System shape, boundaries, failure policy                     |
| [product.md](docs/product.md)                       | Personas, jobs, routes, flows, MVP boundary                  |
| [ontology.md](docs/ontology.md)                     | The reasoning. Entity vs. role vs. concept; what we left out |
| [ontology-reference.md](docs/ontology-reference.md) | Generated predicate tables                                   |
| [data-model.md](docs/data-model.md)                 | Schemas, indexes, state machine                              |
| [semantic-layer.md](docs/semantic-layer.md)         | View catalog, metric contract                                |
| [graph.md](docs/graph.md)                           | Modes, path algorithm, accessibility                         |
| [security.md](docs/security.md)                     | Threat model, RLS, the serverless-driver gotcha              |
| [ui.md](docs/ui.md)                                 | Design system, WCAG 2.2 AA criteria                          |
| [api.md](docs/api.md)                               | Actions vs. routes, job queue, cron, caching                 |
| [testing.md](docs/testing.md)                       | Strategy, fixtures, what each suite is for                   |
| [deployment.md](docs/deployment.md)                 | Vercel/Neon setup, migrations, runbooks, rotation            |
| [backlog.md](docs/backlog.md)                       | What is next, what was declined, and why                     |
| [decisions-log.md](docs/decisions-log.md)           | Small choices too minor for an ADR                           |
| [performance-log.md](docs/performance-log.md)       | Measured budgets and regressions                             |
| [future-ai.md](docs/future-ai.md)                   | Tool registry design, embeddings, grounding rules            |
| [attribution.md](docs/attribution.md)               | TMDB and JustWatch obligations, per surface                  |
| [adr/](docs/adr/)                                   | 13 architecture decision records                             |

## Attribution

This product uses the TMDB API but is not endorsed or certified by TMDB.
See [docs/attribution.md](docs/attribution.md).
