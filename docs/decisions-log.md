# Decisions log

Choices too small for an ADR but annoying to rediscover. Append freely, newest first.

## 2026-09-20 — The ER review queue holds ambiguity, not every collision

The first version queued every identical-name person collision and filled with 206 items that were
all correct refusals: Steve McQueen the actor and Steve McQueen the director, Graham Greene the
novelist and Graham Greene the actor, John Williams the composer and several John Williams who
act. Zero filmography overlap is _evidence of different people_, not ambiguity. Only overlap == 1,
or a matching birthday with no shared work, is queued now. A queue nobody reads is worse than no
queue: it buries the cases that need a decision.

## 2026-09-20 — NULL != NULL in a unique index

`crosswalk_keyword_theme` has `UNIQUE (keyword_source_id, concept_id)`. Exclusions have
`concept_id IS NULL`, and two NULLs are not equal, so `ON CONFLICT DO NOTHING` never fired and
every reload inserted another copy. The coverage metric reported **114% adjudicated** — an
impossible number that revealed it. Fixed with a partial unique index on `keyword_source_id WHERE
concept_id IS NULL`, plus `count(DISTINCT ...)` because multi-theme keywords also double-counted.

## 2026-09-20 — Measure coverage against what is achievable

9.8% of titles have no TMDB keywords at all, so no crosswalk can ever theme them. Reporting
themed-against-all-titles made the metric look like a crosswalk failure when it was a data
ceiling. The report and `/api/health` now use themed-of-keyworded and state the ceiling separately.

## 2026-09-20 — TMDB movie credits and TV aggregate_credits have different shapes

Movie `credits.crew[]` has a flat `job`. TV `aggregate_credits.crew[]` has
`jobs: [{job, credit_id, episode_count}]`, because a person can hold several roles across a series
run. Caught by Zod at the provider boundary on the first live show ingest, and diagnosed from the
captured raw payload without a refetch — which is the argument for capturing raw BEFORE parsing.

## 2026-09-20 — pgrep will not find a tsx script by its script name

`tsx scripts/seed.ts` runs as `node --require .../tsx/dist/preflight.cjs --import ... scripts/seed.ts`.
`pgrep -f "tsx scripts/seed.ts"` finds nothing and you conclude the job died. Match on the script
path alone.

## 2026-09-20 — All sem.* views need security_invoker = true

Postgres views execute with the privileges and RLS context of the view OWNER unless
`security_invoker` is set (PG15+). Ours are owned by the migration role, which bypasses RLS, so
`sem.user_title` returned one user's rows to another while every base-table policy test passed.
`drizzle/sql/20-views.sql` sets it on all nine views. Add the ALTER when you add a view.

## 2026-09-20 — Authorization tests must not run as a superuser

Superusers and `BYPASSRLS` roles ignore RLS even with `FORCE ROW LEVEL SECURITY`. The first version
of the authz suite connected as the migration owner and passed vacuously. `pnpm db:test-role`
creates `throughline_app` (NOSUPERUSER, NOBYPASSRLS, member of `app_web`), the suite connects as it
via `TEST_DATABASE_URL`, and the first assertion is that the role cannot bypass.

## 2026-09-20 — The edge-validation trigger is data-driven, not generated branches

The first version generated a 14-branch `CASE` from ontology.yaml. It could not tell "undeclared
predicate" from "valid predicate, wrong table", so inserting `directed` into `core.edge_derived`
reported "predicate directed is not declared in ontology.yaml" — actively misleading in an ingest
log. `core.predicate_meta` now carries domain, range, and subtype arrays, and the trigger is ~30
lines of generic logic over it. Adding a predicate changes data, never code.

## 2026-09-20 — `symmetric` is a reserved word in Postgres

`BETWEEN SYMMETRIC`. Column renamed `is_symmetric` rather than quoting it everywhere.

## 2026-09-20 — drizzle-kit cannot introspect namespace re-exports

`export * as core from './core'` yields "0 tables". `drizzle.config.ts` lists the schema files
explicitly. `drizzle/schema/index.ts` stays a namespace barrel for application imports.

## 2026-09-20 — drizzle-kit emits bare CREATE SCHEMA

Which collides with `00-bootstrap.sql`, and bootstrap must run first because
`core.uuid_generate_v7()` is a column default on every table. `scripts/db-migrate.ts` rewrites that
one statement form to `IF NOT EXISTS` and wraps each migration file in a transaction.

## 2026-09-20 — ESLint pinned to 9.x, not 10

`@typescript-eslint/scope-manager@8.70.0` does not implement ESLint 10's `SourceCode` API, despite
typescript-eslint's peer range advertising `^10.0.0`. Symptom:
`TypeError: scopeManager.addGlobals is not a function` on every file. Pinned `eslint` and
`@eslint/js` to `9.39.5`. Revisit when typescript-eslint ships ESLint 10 support.

## 2026-09-20 — TypeScript pinned to ~6.0.3, not 7.x

TypeScript 7.0.2 is latest, but `typescript-eslint@8.70.0` declares
`peerDependencies.typescript: >=4.8.4 <6.1.0`. Using TS 7 breaks typed linting. Pinned to `~6.0.3`.
**Do not "helpfully" upgrade to TS 7** until typescript-eslint supports it.

## 2026-09-20 — Typed linting is scoped to `**/*.{ts,tsx}` with an explicit parser

`eslint-config-next` installs its own parser and does not forward `parserOptions.project`, so
`@typescript-eslint/consistent-type-imports` fails with "you have used a rule which requires type
information". Fixed by a config block after `...next` that sets `parser: tseslint.parser` and
`parserOptions: { projectService: true }`, scoped to TS files only.

## 2026-09-20 — pnpm build approval lives in `pnpm-workspace.yaml` as `allowBuilds`

`pnpm.onlyBuiltDependencies` in `package.json` is **silently ignored** by pnpm 11. The current home
is `allowBuilds` (a map) in `pnpm-workspace.yaml`, even with no workspace. Already documented in
`~/personal/projects/claude-code-starter-kit/template/agent-docs/pnpm-build-scripts.md`.

## 2026-09-20 — `themes.yaml` uses block style, never flow mappings

The first draft used `slug: { label: X, definition: Y }`. In a YAML flow mapping an unquoted comma
**terminates the value**, so five definitions were silently truncated and the remainders became
null-valued keys ("Being watched" instead of "Being watched, and what that does to conduct"). Block
style throughout, definitions double-quoted. `tests/ontology` has a permanent guard asserting no
theme carries a key other than `label` and `definition`.

## 2026-09-20 — Generated files must contain no timestamps

CI runs `pnpm codegen && git diff --exit-code`. Any nondeterminism — a generated-at stamp, map
iteration order — breaks the build. `codegen.ts` sorts all key lists explicitly.

## 2026-09-20 — 21 predicates, not the 20 in the original spec

`composed_for` and `shot` were included in v1 rather than deferred; `adapted_from` was dropped as a
duplicate of `based_on`. Counts in prose should reference `ontology-reference.md`, which is
generated, rather than hardcoding a number.
