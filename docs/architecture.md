# Architecture

## The stack in one layer diagram

```
TMDB / Wikidata                raw.*        immutable provider payloads, replayable
      |  ingest + entity resolution
canonical entities             core.*       UUIDv7 identity, external_id crosswalk, merge log
      |  ontology/ontology.yaml (compiled to DDL constraints)
typed graph of nodes + edges   core.edge    predicate/domain/range enforced, 3 provenance tiers
      |  views
semantic layer                 sem.*        business concepts; the ONLY surface the app may query
      |  RLS + session account
user context                   usr.*        state machine + append-only event log, row-isolated
      |
application                    Next.js      tracker + Universe
      |
future AI / agents             tools/       parameterized semantic queries, never text-to-SQL
```

Each arrow is a real boundary with a real enforcement mechanism, not a diagram convention. See
[ADR 0001](adr/0001-postgres-four-schema-separation.md).

## The seven commitments

1. One Postgres, no graph database — [ADR 0003](adr/0003-no-graph-database.md)
2. `ontology/ontology.yaml` is the single source of truth
3. Four-schema separation, app queries `sem.*` only — [ADR 0001](adr/0001-postgres-four-schema-separation.md)
4. Person is an entity; roles are predicates — [ADR 0002](adr/0002-person-entity-roles-as-predicates.md)
5. Three provenance tiers, derived edges separately truncatable — [ADR 0004](adr/0004-credit-table-vs-generic-edge.md)
6. Hub-penalized, predicate-weighted path ranking — [ADR 0010](adr/0010-hub-penalized-path-ranking.md)
7. Volatile facts are not ontology — [ADR 0007](adr/0007-availability-is-not-ontology.md)

## Runtime shape

- **Next.js 16 App Router on Vercel.** RSC-first; server components call repository functions
  directly with no HTTP hop for our own data.
- **Mutations are Server Actions** in `src/actions/`, each: `auth()` -> Zod parse -> repo call ->
  `revalidateTag()`. Optimistic UI for status changes and episode ticks.
- **Route handlers only for** the TMDB search proxy, OG image generation, cron, and the future AI
  endpoint.
- **Neon Postgres.** HTTP driver for global reads; **pooled WebSocket connection for anything
  touching `usr.*`**, because RLS needs a real transaction. See [security.md](security.md).
- **Background work** is a `core.job` table drained by Vercel Cron — [ADR 0011](adr/0011-job-table-over-queue-service.md).

## Directory map

```
ontology/     ontology.yaml (source of truth), themes.yaml, metrics.yaml, codegen.ts
drizzle/      schema/{raw,core,sem,usr}.ts · views/ (hand-written SQL) · generated/ (do not edit)
src/app/      routes
src/actions/  server actions, one file per domain
src/server/   repos/ providers/ ingest/ jobs/ db/   <- the only place core/sem/usr are touched
src/lib/      ontology/ (generated) · graph/ · metrics/ · design/
src/components/ ui/ media/ graph/ charts/
scripts/      check-locale.sh · check-layers.sh · check-env.ts · seed.ts
tests/        unit/ ontology/ integration/ authz/ e2e/
```

## Generated artifacts

`pnpm codegen` compiles `ontology/ontology.yaml` into:

| Artifact                         | Purpose                                                        |
| -------------------------------- | -------------------------------------------------------------- |
| `src/lib/ontology/generated.ts`  | TS types, domain/range maps, path weights, narration templates |
| `drizzle/generated/ontology.sql` | `CHECK` constraints + `core.assert_edge_valid()` trigger       |
| `docs/ontology-reference.md`     | Human-readable predicate table                                 |

All three are committed. CI runs `pnpm codegen && git diff --exit-code`, so the ontology and the
database cannot drift. Output must stay deterministic — never write a timestamp into a generated
file.

## Silent vs. loud failure

| Condition                                           | Behavior                                                    | User sees                            |
| --------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------ |
| Zod parse failure on a provider response            | Throw, log the field path, count toward the circuit breaker | No — degrade to cached               |
| Edge violating domain/range                         | Raise at the DB level. Never coerce, never skip             | No — job fails and retries           |
| Entity resolution lands in the ambiguous band       | Route to `core.er_review`. Never guess                      | No                                   |
| Partial hydration                                   | Render what exists, re-enqueue the rest                     | Provenance footer shows partial sync |
| Job exceeds 5 attempts                              | Mark failed, surface in admin, count toward health          | No                                   |
| **Zero-row read where a row was asserted to exist** | **Throw**                                                   | Yes — error boundary                 |
| Circuit breaker open                                | Serve cache                                                 | Yes — banner on search only          |
| Mutation fails after optimistic update              | Revert + toast with retry                                   | Yes                                  |

The sixth row is the dangerous one in this architecture: a misconfigured `withUser` yields empty
results rather than an error. Treating "expected a row, got none" as an exception makes that loud.
