# Decisions log

Choices too small for an ADR but annoying to rediscover. Append freely, newest first.

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
