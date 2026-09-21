# Deployment and operations

## Setup (one-time, needs Tommy's accounts)

Not yet done — Phase 0 is verified locally. Steps:

1. **Neon** — create project `throughline`, **Launch plan ($19/mo)**. Launch is chosen specifically
   for no auto-suspend (free-tier cold starts of 500ms-3s are very visible on a mobile tracker) and
   for **database branching**, which gives a real per-PR test database.
2. **Vercel** — import the repo, framework preset Next.js. Add the Neon integration so connection
   strings are injected.
3. **Env vars** — set everything in `.env.example` in the Vercel dashboard, Production and Preview.
   **Do not create `DATABASE_URL` by hand** — the Neon integration creates it and refuses to connect
   if the name is already taken. Let Neon own it.
4. **Upstash** — create a Redis database (free tier), add the two vars.
5. **Sentry** — create the project, add the DSN.
6. `pnpm check-env` locally to confirm parity.

## Environments

|            | Branch | Database                                |
| ---------- | ------ | --------------------------------------- |
| Production | `main` | Neon `main`                             |
| Preview    | any PR | Neon branch created per PR              |
| Local      | —      | Neon branch `dev`, or local Postgres 17 |

## Migrations run on deploy, not from a laptop

`package.json` defines `vercel-build` as `pnpm db:migrate && next build`. Vercel runs
`vercel-build` in preference to `build` when it exists, so every deployment migrates its own
database before the new code goes live. Local `pnpm build` is untouched and never connects to
anything.

**This is not just convenience.** Vercel marks environment variables as Sensitive, meaning their
values are write-only and cannot be pulled back — `vercel env pull` returns `[SENSITIVE]`
placeholders. That is the platform protecting the credentials correctly, and the right response is
to run migrations where the credentials already live rather than to weaken the protection so a
developer machine can hold them.

Consequences worth knowing:

- A failed migration **fails the deployment**, and the previous one keeps serving. That is the
  behavior you want: never ship code against a schema that did not apply.
- Preview deployments migrate their own Neon branch, so a schema change is exercised on a real
  database before it reaches production.
- Migrations must stay **idempotent** — they run on every deploy, not once. `scripts/db-migrate.ts`
  tracks applied files in `core.__migrations` and every hand-written SQL file is written to be
  re-runnable.
- **Expand-then-contract still applies**, and matters more here: the migration runs _before_ the
  new code is live, so the old code briefly runs against the new schema.

**Expand-then-contract is mandatory.** A rollback of application code must never meet a schema it
cannot read, so no destructive migration ships in the same deploy as the code that stops using the
column. Add the column, deploy the code that writes both, deploy the code that reads the new one,
then drop the old one in a later deploy.

## Cron on the Hobby plan — a real constraint, not a detail

**Vercel rejects any cron schedule more frequent than daily on Hobby**, at deploy
time, with `Hobby accounts are limited to daily Cron Jobs`. It is not a warning; the whole
deployment fails. Two of ours failed this way before `scripts/check-vercel.ts` existed.

`docs/api.md` describes a per-minute drain. That is the Pro-plan design and remains the target.
What actually ships on Hobby:

| Job              | Designed    | On Hobby    |
| ---------------- | ----------- | ----------- |
| `drain`          | `* * * * *` | `0 4 * * *` |
| `refresh-degree` | `0 5 * * *` | unchanged   |
| `housekeeping`   | `0 2 * * *` | unchanged   |

**Consequence for Phase 4.** A daily drain makes lazy ingest unusable: opening an untracked title
would enqueue a hydrate job that runs up to 24 hours later. Before lazy hydration ships, one of:

1. Upgrade to Pro and restore the per-minute drain (then set `VERCEL_PLAN=pro` so `check-vercel`
   stops enforcing the daily rule).
2. Run the synchronous minimal fetch inline and treat the queue as best-effort enrichment — which
   is roughly what [api.md](api.md) already describes for the lazy path.
3. Drive `/api/cron/drain` from an external scheduler. Vercel only limits its own scheduler, not
   inbound requests to the route.

Option 2 needs no money and no vendor, so it is the default unless the latency proves unacceptable.

`scripts/check-vercel.ts` runs in CI and in `pnpm verify`: it fails on a cron path with no route,
and on any sub-daily schedule while `VERCEL_PLAN` is unset or `hobby`.

## Post-deploy smoke test

Scripted, runs automatically after a production deploy, ~20s:

1. `GET /api/health` returns `ok`.
2. Unauthenticated `GET /s/<fixture-slug>` returns 200 containing the expected title.
3. Its `opengraph-image` returns a 1200x630 PNG.
4. A fixture account loads `/library` with the expected item count.
5. A fixed path query returns the expected top path.

Failure posts to the alert channel and the deploy is rolled back.

## Health, not liveness

`/api/health` asserts freshness **and** non-error state per job kind. A job that succeeds at doing
nothing is not healthy — that is precisely how a scheduled sync elsewhere stayed dead for 13 days
while recording success every 15 minutes.

```
{ db: ok,
  job_queue: { depth, oldest_queued_age_s, failed_last_24h },
  cron: { <kind>: { last_success_at, age_s, consecutive_failures } },
  tmdb: { circuit: closed|open, error_rate_1h },
  ingest_freshness: { pct_synced_48h } }
```

Degraded when any of: `oldest_queued_age_s > 900` · any cron kind with `age_s > 2x its interval` ·
`consecutive_failures >= 3` · `pct_synced_48h < 0.9`.

## SLOs

| SLO                                 | Target                         | Window      |
| ----------------------------------- | ------------------------------ | ----------- |
| Availability (authenticated routes) | 99.5%                          | 30d rolling |
| Title detail latency                | p95 < 800ms warm               | 7d          |
| Path finder latency                 | p95 < 150ms warm, < 400ms cold | 7d          |
| Share page TTFB                     | p95 < 400ms                    | 7d          |
| Ingest freshness                    | 95% of tracked titles < 48h    | 7d          |

**Error budget policy:** breaching an SLO in a 30-day window pauses feature work for the next
session in favor of the fix. On a personal project this is a norm, not a process — but writing it
down is what stops "I'll look at it later."

## Alerts — three, no more

1. Uptime check fails, or `/api/health` degraded twice in a row -> push notification.
2. Sentry: any new unhandled exception type -> email.
3. Cron kind with `consecutive_failures >= 3` -> included in degraded state above.

**A cron job must never exit 0 on a failed fetch.**

## Runbooks

**TMDB circuit open.** Check TMDB status page. Verify the key is valid (`curl` the configuration
endpoint). Confirm cached data is still serving (`/api/health` `tmdb.error_rate_1h`). If TMDB is up
and we are still failing, check whether the rate limiter is mis-tuned; raise the breaker threshold
only after confirming we are under 50 req/s.

**Job queue backing up.** `SELECT kind, status, count(*) FROM core.job GROUP BY 1,2`. Look for a
poison job at `attempts = 5` blocking a kind. Inspect `last_error`. Drain manually by hitting
`/api/cron/drain` with the secret. Requeue by setting `status='queued', attempts=0, run_after=now()`
for the affected rows once the cause is fixed.

**ER review queue > 200.** Triage by entity type. A sudden spike usually means a mapper change
caused a systematic mismatch rather than 200 genuinely ambiguous pairs — check recent commits to
`src/server/ingest/` first. Revert or bulk-resolve.

## Config drift

`scripts/check-env.ts` asserts the set of env var **names** in the environment matches
`.env.example` exactly. Missing vars break the app; **extra** vars are how dead config accumulates.
Both fail. Runs in CI and in `housekeeping`.

## Data pipeline quality

Checked nightly by `housekeeping`, surfaced on `/api/health`:

| Check                                               | Threshold                                        | On breach                                       |
| --------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------- |
| Provider schema drift                               | Any Zod failure on a previously-passing endpoint | Fail loudly, alert. Do not coerce               |
| Null rate `title.poster_path`                       | < 5%                                             | Log; investigate at > 10%                       |
| Null rate `title.release_date`                      | < 2%                                             | Log                                             |
| Orphan edges                                        | 0                                                | Hard failure (FK-enforced; the check proves it) |
| Duplicate canonicals (same `imdb_id`, two entities) | 0                                                | Alert, route to merge queue                     |
| `explores_theme` coverage                           | >= 80% of titles have >= 1 theme                 | Log; drives crosswalk work                      |
| Resolved-character coverage                         | Tracked, no threshold                            | Displayed publicly in the Universe panel        |
| Freshness                                           | 95% < 48h                                        | Degraded health                                 |

## Rollback

Vercel instant rollback to the previous deployment, **exercised once deliberately in Phase 10** so
it is known to work rather than assumed. Database rollback is Neon PITR (7 days on Launch); the
drill includes restoring a branch to 10 minutes prior and verifying `usr.*` integrity.

## Backups

Neon PITR covers 7 days. Plus a monthly `pg_dump` of `usr.*` to local encrypted storage — the
irreplaceable data is the user layer; `core` is re-derivable from `raw` and the providers.

## Visual regression

Playwright screenshot baselines at 390px and 1280px for Home, Library, title detail, share page,
and Focus mode. Captured in Phase 10, diffed on PRs. Scoped to five surfaces on purpose — a full
visual-regression suite on a solo project rots faster than it catches anything.
