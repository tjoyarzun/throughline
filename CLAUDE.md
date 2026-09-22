# Throughline — agent context

A mobile-first PWA for tracking movies and TV, built on an explicit media ontology and a SQL
semantic layer. Two faces: a fast cinematic tracker (search → status → rate → share), and **The
Universe**, an ontology exploration surface whose headline capability is answering _"why are these
two things connected?"_ with ranked, narrated paths through a knowledge graph.

Personal project. Invite-only multi-user (Tommy + family). Next.js on Vercel, one Postgres on Neon.

## Current phase: 10 — PWA, polish, hardening

Phases 0-9 are complete. A corpus of **4,989 titles** with 58,693 people, 111,570 credits
and 108,261 edges, identical in local and production. Tracking works end to end: status,
favorites, half-star ratings with history, viewing events, episode progress. Sharing ships
`usr.share` snapshots, the public `/s/[slug]` page and dynamic OG images. The Universe has
its hub, Focus mode, the path finder, and `/universe/me` with five metrics resolved from
`ontology/metrics.yaml`. `/me` carries the admin panel, invites, data export and account
deletion.

**Phase 10 is what is left**, in this order:

|     | Item                                                                     | State                                                                                                                                                               |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Verify a Resend domain and move `EMAIL_FROM` off `onboarding@resend.dev` | **Blocking.** Until it is done, sign-in codes reach only the Resend account owner, so nobody else can be invited. `/api/health` reports `degraded` with the reason. |
| 2   | Data export + account deletion                                           | Done                                                                                                                                                                |
| 3   | Rate limiting on the auth endpoints and the path finder                  | Not started                                                                                                                                                         |
| 4   | axe-core accessibility pass (AC-31…36)                                   | Not started                                                                                                                                                         |

**Two entity tables are legitimately sparse or empty, in both environments** — the code that
fills them does not exist yet, so this is not a seeding gap. Do not "fix" it by re-running
ingest:

| Table            | Why                                                                    |
| ---------------- | ---------------------------------------------------------------------- |
| `core.character` | Character resolution is deliberately partial and not yet begun.        |
| `core.episode`   | 72 rows. Episodes are hydrated per show on demand, not seeded in bulk. |

### Production

|                |                                                   |
| -------------- | ------------------------------------------------- |
| App            | https://throughline-ontology.vercel.app           |
| Vercel project | `throughline-ontology` (team `agora-innovations`) |

The former `throughline-mu-seven.vercel.app` 308-redirects here, preserving
path and method, so links handed out before the rename still resolve. The
origin lives in `NEXT_PUBLIC_SITE_URL`, which is also what `metadataBase` and
Better Auth's `trustedOrigins` read — change it in one place, not four.

### Running maintenance against production

There is no local path to the production database — Vercel keeps the connection string
write-only, correctly. Maintenance therefore runs as a **job**, and `/api/admin/enqueue-job`
is how work gets into the queue:

```bash
curl -X POST "$SITE/api/admin/enqueue-job" -H "Authorization: Bearer $CRON_SECRET" \
  -H 'content-type: application/json' -d '{"kind":"derive_themes"}'
curl -H "Authorization: Bearer $CRON_SECRET" "$SITE/api/cron/drain"
```

Kinds must be registered in `HANDLERS`; anything else is refused. A job that needs more than
one function's wall clock chains itself (see `enrich_wikidata`) rather than running long — a
single job that outlives the function takes the whole invocation down with it, and the drain's
45s budget does not help, because it is checked _between_ jobs.

### Local databases

| Database           | Purpose                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `throughline_dev`  | The seeded corpus. `DATABASE_URL`.                                                            |
| `throughline_test` | Test fixtures only. `TEST_ADMIN_DATABASE_URL`; `tests/setup.ts` redirects every DB test here. |

Tests MUST NOT run against `throughline_dev` — entity-resolution fixtures collide with the real
corpus (there is an actual _The Office_ in there) and the failures look like resolver bugs.

```bash
pnpm db:migrate      # idempotent, safe to re-run
pnpm db:test-role    # the non-superuser role the authz suite requires
pnpm seed            # resumable; already-ingested titles resolve cheaply
pnpm derive:themes   # replays the crosswalk with no re-crawl
pnpm enrich:wikidata # based_on, franchises, influence
```

## Read before you work

| Doing this                | Read first                                                                                                      |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Anything touching data    | [architecture.md](docs/architecture.md) → [ontology.md](docs/ontology.md) → [data-model.md](docs/data-model.md) |
| Anything touching queries | [semantic-layer.md](docs/semantic-layer.md)                                                                     |
| Anything touching UI      | [ui.md](docs/ui.md)                                                                                             |
| Graph or path finding     | [graph.md](docs/graph.md)                                                                                       |
| Auth, RLS, secrets        | [security.md](docs/security.md)                                                                                 |

## The seven commitments

These are decided. Do not relitigate them without writing an ADR.

1. **One Postgres, no graph database.** ~260k edges at target corpus; the user layer must join to
   the graph. [ADR 0003](docs/adr/0003-no-graph-database.md)
2. **`ontology/ontology.yaml` is the single source of truth.** TS types, Zod schemas, DB CHECK
   constraints, path weights, and narration are _generated_ from it.
3. **Four schemas: `raw` → `core` → `sem` → `usr`.** Application code queries **`sem.*` only**.
4. **Person is an entity; Actor/Director/Writer are roles** realized as predicates. [ADR 0002](docs/adr/0002-person-entity-roles-as-predicates.md)
5. **Three provenance tiers: `asserted` / `curated` / `derived`.** Derived edges live in a separately
   truncatable table.
6. **Path ranking is hub-penalized and predicate-weighted.** Naive BFS returns "both are Drama".
7. **Volatile facts are not ontology.** Availability has its own table with validity windows. [ADR 0007](docs/adr/0007-availability-is-not-ontology.md)

## Hard rules

- **Query `sem.*` only** from `src/app`, `src/components`, `src/actions`. Never `core.*`, never
  `raw.*`, never a provider directly. Go through `src/server/repos/`. Enforced by ESLint and
  `scripts/check-layers.sh`.
- **Never add a predicate** without editing `ontology/ontology.yaml` and running `pnpm codegen`.
- **Never hand-edit** `src/lib/ontology/generated.ts`, `drizzle/generated/**`, or
  `docs/ontology-reference.md`. They are build output and CI compares them.
- **All `usr.*` access goes through `withUser(accountId, …)`** — an explicit transaction on the
  pooled connection. Two independent reasons, either sufficient: Neon's HTTP driver runs each query
  in its own implicit transaction, so a separate `SET LOCAL` evaporates and RLS returns zero rows;
  and pgbouncer hands the backend to the next request at commit, so a plain `SET` would leak the
  account id across tenants. [security.md](docs/security.md)
- **Every `sem.*` view must be `ALTER VIEW … SET (security_invoker = true)`.** Postgres views run as
  their OWNER by default, which bypasses RLS. Without this, `sem.user_title` returns every user's
  ratings to every user while all base-table RLS tests pass. `drizzle/sql/20-views.sql` sets it for
  each view; add the line when you add a view.
- **Never test authorization as a superuser.** Superusers and `BYPASSRLS` roles ignore RLS even with
  `FORCE`, so the suite passes vacuously. Tests connect via `TEST_DATABASE_URL` as
  `throughline_app`, and assert they cannot bypass before asserting anything else.
- **Every repository function touching user data takes `accountId` as its first parameter.** Never
  read it from ambient context. `requireAccountId()` throws rather than returning null, so a
  forgotten check cannot become an unscoped query.
- **Authentication connects as `app_auth`, not `app_web`.** Sign-in must read `usr.account` before
  a session exists, and that table has FORCE RLS. Never "solve" this with a policy that permits
  access when no account is set — that hands every account to any query that forgot `withUser()`.
  [security.md](docs/security.md)
- **A zero-row read where a row was asserted to exist is a bug, not an empty state.** Throw.
- **The graph library is dynamically imported on `/universe/*` only.** It must never enter the
  shared bundle.
- **TMDB images never go through the Next image optimizer.** [ADR 0012](docs/adr/0012-tmdb-images-bypass-next-optimizer.md)
- **New user-facing metric → `ontology/metrics.yaml`**, not SQL in a component.
- **Raw provider keywords go to `core.title_keyword`** — never `core.concept`, never `core.edge`.
  A folksonomy is provider input to the crosswalk, not ontological fact. The ontology trigger
  rejects it as an edge, correctly.
- **The entity-resolution review queue holds AMBIGUITY, not every collision.** Zero filmography
  overlap is evidence of two different people (Steve McQueen the actor and Steve McQueen the
  director), not a case for a human. A queue nobody reads is worse than no queue.
- **Ingest must stay idempotent.** Re-running produces identical `core` state apart from
  `synced_at`, asserted by `tests/integration/idempotency.test.ts`. Without it the seed cannot be
  resumed and the nightly delta corrupts the corpus a little every night.
- **American English (en-US)** in all copy, docs, comments, commit messages, and identifiers we
  author. Enforced by `scripts/check-locale.sh` + cspell in CI and pre-commit. Exceptions (provider
  field names, quoted material, proper nouns) go in `.localeignore` with a reason. Do not
  relitigate. [ADR 0013](docs/adr/0013-en-us-locale-enforcement.md)
- **The Domo design playbook does not apply here.** This is a personal project with its own visual
  identity ([ui.md](docs/ui.md)). Do not push the palette toward Domo brand colors.

## Commands

```bash
pnpm dev              # dev server
pnpm codegen          # ontology.yaml -> types, SQL constraints, reference docs
pnpm verify           # codegen drift + typecheck + lint + locale + spelling + tests
pnpm test             # vitest (unit + ontology conformance)
pnpm check-locale     # en-US denylist
pnpm check-layers     # sem-only boundary
pnpm check-env        # env parity with .env.example
```

`pnpm verify` is what CI runs. Run it before you claim something works.

## ADR index

| #                                                             | Decision                                                       |
| ------------------------------------------------------------- | -------------------------------------------------------------- |
| [0001](docs/adr/0001-postgres-four-schema-separation.md)      | Four-schema separation: raw / core / sem / usr                 |
| [0002](docs/adr/0002-person-entity-roles-as-predicates.md)    | Person is an entity; roles are predicates                      |
| [0003](docs/adr/0003-no-graph-database.md)                    | No graph database; Postgres with a swappable engine interface  |
| [0004](docs/adr/0004-credit-table-vs-generic-edge.md)         | Hybrid edge storage: typed `core.credit` + generic `core.edge` |
| [0005](docs/adr/0005-favorites-as-relationship-not-status.md) | Favorites is an orthogonal relationship, not a status          |
| [0006](docs/adr/0006-tmdb-spine-wikidata-enrichment.md)       | TMDB as spine, Wikidata as ontology enricher                   |
| [0007](docs/adr/0007-availability-is-not-ontology.md)         | Streaming availability is not an ontology edge                 |
| [0008](docs/adr/0008-share-snapshot-not-live.md)              | Shares snapshot rating and note at creation                    |
| [0009](docs/adr/0009-better-auth.md)                          | Better Auth over Auth.js v5 and Clerk                          |
| [0010](docs/adr/0010-hub-penalized-path-ranking.md)           | Hub-penalized, diversity-filtered path ranking                 |
| [0011](docs/adr/0011-job-table-over-queue-service.md)         | A `core.job` table and cron drain, not a queue vendor          |
| [0012](docs/adr/0012-tmdb-images-bypass-next-optimizer.md)    | TMDB images bypass the Next image optimizer                    |
| [0013](docs/adr/0013-en-us-locale-enforcement.md)             | en-US enforced by a denylist, not by convention                |

Small choices too minor for an ADR but annoying to rediscover live in
[docs/decisions-log.md](docs/decisions-log.md). Add to it freely.

## Conventions

- One phase per branch, one PR per phase; the PR body restates the phase definition of done.
- Architectural choices made during implementation get an ADR **before** the code merges.
- Generated artifacts are committed and CI-verified — a session cannot drift the ontology from the
  database without failing the build.
- Docs updates are part of each phase's definition of done, not a follow-up.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
