# Testing

Weighted toward what is actually risky here: authorization, entity resolution, and ontology
integrity. UI tests are deliberately thin.

**Coverage stance:** no global percentage target. Required: 100% of authorization paths, 100% of
ontology conformance rules, and every ER fixture case. Everything else is judgment.

## Unit (Vitest, no DB) — `tests/unit/`

- **Contrast** (`contrast.test.ts`, _implemented_) — every declared token usage meets its WCAG 2.2
  AA threshold, plus guards asserting the known-bad pairings stay classified as non-text.
- **Title normalization** — `"The Matrix (1999)"` -> `matrix`; `"L'Etranger"` -> `letranger`;
  `"WALL-E"` -> `walle`.
- **Path cost and ranking** — on a fixture graph, the director path outranks the genre path; a
  degree-3000 node is never an intermediate; diversity filtering rejects a >50% overlap duplicate.
- **Narration** — every predicate produces a grammatical sentence in both directions. A loop over
  the ontology, so it cannot go stale.
- **Progress** — aired-vs-total; a show with 6 of 8 aired episodes watched shows 100%, not 75%.
- **Rating conversion** — half-star int <-> decimal, boundaries.
- **Metric resolver** — each `metrics.yaml` entry compiles to valid SQL with the account filter.

## Ontology conformance — `tests/ontology/` (_implemented_, 83 tests)

The distinctive suite. Asserts: generated artifacts match the YAML; every predicate has a valid
domain, range, inverse, and narration; symmetric predicates are their own inverse; only derived
predicates live in `core.edge_derived`; structural predicates are excluded from traversal; credit
predicates outrank classification predicates; genre is excluded from intermediates; every theme has
a definition and **no stray keys**; every metric sources from `sem.*`; and **no entity type named
`actor`, `director`, or `writer` exists**.

Plus in CI: `pnpm codegen && git diff --exit-code`, which makes "the DB is generated from the
ontology" true rather than aspirational.

## Integration (Vitest + a Neon branch per CI run) — `tests/integration/`

- **Entity resolution, table-driven** — hard real cases: _The Office_ 2001 UK vs 2005 US; the six
  _Pinocchio_ films; _Dune_ 1984 vs 2021; identical person names; a TMDB record with a known
  duplicate person. Assert correct merges, correct **non**-merges, and correct routing to the review
  queue.
- **Idempotency** — ingest the same fixture twice; identical row counts and edge set, only
  `synced_at` differs.
- **Merge/revert** — edges repointed, duplicates collapsed, revert restores.
- **Job queue** — concurrent `claim_jobs` from two connections never returns the same job.

## Authorization — `tests/authz/` (highest value)

These are the tests whose absence would be embarrassing.

- User B cannot read A's `title_state` / `rating` / `viewing` / `note` through any repository
  function, with A's IDs supplied directly.
- Querying `usr.*` **outside** `withUser()` returns zero rows — proves RLS is on, not merely that
  the app is well-behaved.
- `app_web` cannot `INSERT` into `core.edge` — proves the global-model guarantee structurally.
- A share page renders A's snapshot but no live A data; changing A's rating does not change it.
- A revoked share 404s.
- Sign-up without a valid invite fails at the API, not just the UI.
- Every `auth`-classed route redirects when unauthenticated.

## E2E (Playwright: iPhone 14 Pro, Pixel 7, desktop) — `tests/e2e/`

1. Sign in with invite -> search -> detail -> mark watched -> rate 4.5 -> appears in Watched.
2. Swipe to add -> undo -> not added; redo -> added.
3. Mark episodes through S2E5 -> Home shows S2E6 and the right remaining count.
4. Share: create -> `/s/[slug]` renders in a fresh unauthenticated context -> OG image is 200,
   `image/png`, 1200x630, < 300KB.
5. Path finder: _Arrival_ + _Blade Runner 2049_ -> Villeneuve in path 1, no genre intermediates.
6. Offline: load Library, go offline, reload -> renders, mutations disabled.
7. Attribution: the TMDB string is present on `/` and `/s/[slug]`.

Plus **axe-core** on `/`, `/library`, `/title/[slug]`, `/s/[slug]`, `/universe/connect` — zero
violations gates CI.

## Manual mobile pass (per-phase DoD)

Real iPhone: one-handed reachability of primary actions; safe-area with the home indicator; keyboard
does not occlude search results; PWA install and launch; native share sheet opens; no horizontal
overflow at 360px; VoiceOver traversal of the Library grid and the Path chain.

## CI gating and flake policy

Blocks merge: typecheck, lint, locale, spelling, codegen drift, unit, ontology conformance, authz,
integration. E2E and Lighthouse run on PRs to `main` only.

**Flake policy: a test that fails intermittently is quarantined with `test.fixme` and an issue
within one day — never retried into green.** Retries mask exactly the race conditions this app is
most likely to have (optimistic updates, job-queue concurrency).
