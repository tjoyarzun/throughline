# Development plan

Dependency-ordered. **The ontology and semantic layer are Phase 1-2, not Phase 9.** Tracking
features are built on top of canonical entities; building them first against provider IDs
guarantees a retrofit. What genuinely comes late is the ontology _experience_ — the graph UI —
which depends on a populated graph, which depends on ingest.

Every phase ends deployable and useful. Stopping after Phase 7 yields a genuinely good tracker;
stopping after 8 yields the full thesis.

---

## Phase 0 — Foundation ✅ COMPLETE (2026-09-20)

**Goal:** a deployable skeleton with the contracts in place.

Delivered: Next.js 16 + React 19 + TS strict + Tailwind v4 · ESLint (layer-boundary and
`dangerouslySetInnerHTML` rules) · Prettier · lefthook · `ontology.yaml` v1 (21 predicates, 9 entity
types) · `themes.yaml` (98 themes, 14 clusters) · `metrics.yaml` (9 metrics) · `codegen.ts`
producing 3 artifacts deterministically · design tokens with a tested usage matrix ·
`check-locale.sh` + cspell · `check-layers.sh` · `check-env.ts` · app shell with bottom nav ·
`PosterCard` / `Chip` / `Skeleton` · Universe page rendering live ontology stats · 115 tests · CI.

**Definition of done:** met. `pnpm verify` green; `pnpm build` succeeds; locale and contrast checks
fail against their fixtures and pass against the repo.

**Not done:** Vercel and Neon accounts are not yet provisioned — see [deployment.md](deployment.md).

---

## Phase 1 — Canonical data model ✅ COMPLETE (2026-09-20)

**Goal:** four schemas exist; generated constraints enforce the ontology.
**Depends on:** 0.

Delivered: 24 tables across `raw`/`core`/`usr` with all indexes · 9 `sem.*` views, every one
`security_invoker` · `core.predicate_meta` generated from the ontology, carrying domain, range,
subtype constraints, inverses and path weights · a generic `assert_edge_valid()` trigger driven by
that table · `uuid_generate_v7()` and `normalize_title()` · RLS with `FORCE` on all eight user
tables · `app_web` / `app_ingest` roles · `core.node_degree` matview · `withUser()` · an idempotent
migration runner · 144 tests.

Three findings, each caught by a test rather than by review:

- **`sem.user_title` leaked across users.** Views run as their owner, which bypasses RLS. Every
  user's ratings and history were readable by every other user _through the semantic layer_ while
  base-table RLS tests passed. Fixed with `security_invoker = true` on all nine views.
- **The authz suite was passing vacuously.** The local role was a superuser, and superusers ignore
  RLS even with `FORCE`. Tests now connect as a restricted role and assert they cannot bypass.
- **`symmetric` is a reserved word** in Postgres (`BETWEEN SYMMETRIC`); renamed `is_symmetric`.

**Tasks:** Drizzle schemas for `raw`/`core`/`usr` · all indexes from [data-model.md](data-model.md) ·
`sem.*` views (title, node, edge, edge_bidirectional, person, concept) · apply generated `CHECK` +
`assert_edge_valid()` · DB roles and grants · RLS policies · `withUser()` · `core.node_degree`
matview.

**Testing:** ontology conformance against a real database · authz suite (RLS-on proof, `app_web`
cannot write `core`) · migration up/down.

**DoD:** inserting an edge with an invalid domain raises at the DB level; `SELECT` on
`usr.title_state` outside `withUser` returns zero rows; every conformance rule passes against both
an empty and a seeded database.

---

## Phase 2 — Ingest and entity resolution

**Goal:** 5,000 real titles and their graph are in `core`, correctly resolved.
**Depends on:** 1. **Gated on:** editorial review of `themes.yaml`.

**Tasks:** TMDB client (rate limiter, retry, circuit breaker, Zod parsing, raw capture) · mappers ·
the ER cascade · `core.job` + `claim_jobs` + drain + Vercel Cron · seed script · keyword-to-theme
crosswalk draft, review pass, and `explores_theme` derivation · Wikidata SPARQL enricher · admin
views for jobs and the ER queue.

**Testing:** the full ER fixture suite · idempotency · merge/revert · job-queue concurrency ·
crosswalk coverage >= 70% of keyword assignments mapped or explicitly excluded.

**DoD:** ~5,000 titles / ~60k people / ~260k edges loaded; re-running the seed changes nothing but
`synced_at`; zero conformance violations; the ER review queue has < 100 items and each is genuinely
ambiguous.

---

## Phase 3 — Auth and shell

**Goal:** real accounts, real isolation.
**Depends on:** 1 — **can run in parallel with Phase 2.**

**Tasks:** Better Auth + Drizzle adapter · passkey, email OTP, Google · invite table and
server-side gate · middleware · session management with global revoke · `/me`.

**DoD:** two real accounts on the deployed app; every authz test passes; passkey sign-in works on a
physical iPhone.

---

## Phase 4 — Search and title detail

**Goal:** find anything, see it beautifully, lazy-ingest on demand.
**Depends on:** 2, 3.

**Tasks:** search proxy + debounce + abort · local-first result merging · `sem.title_full` · the
detail page · lazy hydration · person detail · season/episode pages · image loader, blur-up, accent
extraction.

**DoD:** searching an untracked title and opening it renders a complete page in < 2s on 4G with
full data within 5s; LCP < 2.0s on the detail route.

---

## Phase 5 — Personal tracking

**Goal:** the product becomes useful daily.
**Depends on:** 4.

**Tasks:** status machine + event log · favorites · half-star ratings with history · viewing events
· optimistic mutations · Library with segments, sort, filter · Home · swipe actions with undo ·
`sem.user_title`.

**DoD:** the 10-second capture flow measured at <= 10s on a phone; every transition appears in
`usr.state_event`; rating history survives a re-rate.

---

## Phase 6 — TV episode tracking

**Depends on:** 5.

**Tasks:** episode ingest for tracked shows · `usr.episode_progress` · episode rows · "mark watched
through here" · progress derivation (aired, not total) · auto-transitions with confirmation ·
Continue Watching wired to `next_episode`.

**DoD:** a real in-progress show shows the correct next episode and remaining count; marking the
finale prompts rather than forces the transition.

---

## Phase 7 — Sharing

**Depends on:** 5.

**Tasks:** `usr.share` with snapshots · `/s/[slug]` SSR · `opengraph-image` via Satori · Web Share
API with user-activation-safe ordering · revocation · rate limits · bot-filtered view counting.

**DoD:** a link sent to a real iPhone in Messages unfurls with poster, title, and stars; a second
person can open it; revoking kills it within one revalidation cycle.

---

## Phase 8 — Universe: Focus and Path

**Goal:** the thesis becomes visible and interactive.
**Depends on:** 2 (graph data), 5 (personal overlay).

**Tasks:** `graph/engine.ts` + `PostgresGraphEngine` · cost function, hub ban, bidirectional
fixed-depth SQL, diversity filter · narration from ontology templates · `core.path_cache` · SVG
`OrbitGraph` with spring re-center and breadcrumb · `PathChain` · Universe hub with live counts ·
the Connections module on title detail · list-equivalent accessible views.

**DoD:** _Arrival_ and _Blade Runner 2049_ return the Villeneuve path first with a readable
sentence; three structurally distinct paths for a well-connected pair; p95 < 150ms; the orbit
animates at 60fps on a mid-tier phone.

---

## Phase 9 — Personal universe and analytics

**Depends on:** 8.

**Tasks:** `sem.user_taste_affinity` · metric resolver · the five Phase-1 metrics · SVG charts ·
personal orbit with the global-coverage overlay · generated interpretation sentences.

**DoD:** five correct metrics plus the personal graph; adding a sixth needs only a `metrics.yaml`
entry and a chart binding.

---

## Phase 10 — PWA, polish, hardening

**Depends on:** all.

**Tasks:** manifest + Serwist + offline Library · install hint · empty/loading/error states across
every route · View Transitions · reduced-motion pass · CSP and security headers · rate limiting ·
Sentry · `/api/health` · performance budgets in CI · axe-core in E2E · visual-regression baselines ·
rollback drill · real-device pass · attribution audit · data export and account deletion.

**DoD:** installs and launches from the home screen on iOS and Android; all budgets met; zero
high-severity security findings; a family member completes onboarding to first tracked title with
no assistance.

---

## Phase 2+ backlog

Streaming availability (with full JustWatch attribution) · public ontology pages · Constellation
WebGL mode · Kevin Bacon · full metric set · households · awards · external ratings · custom lists ·
Letterboxd/Trakt import · expanded character resolution · rich viewing-diary UI.

## Future

AI companion on the tool layer · pgvector hybrid retrieval · taste-graph diffing between household
members · temporal ontology for studio acquisitions · offline-first writes · community curation ·
native share extension · graph embeddings as a second similarity signal.
