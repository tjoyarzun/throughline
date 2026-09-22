# Security

## Threat model (STRIDE, scoped to what exists)

| Threat              | Vector                                                 | Control                                                                                                         |
| ------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **Spoofing**        | Credential stuffing, invite-code guessing              | Passkeys (phishing-resistant); OTP rate-limited 5/min/IP; invite codes are 16-char nanoid, single-use, expiring |
| **Tampering**       | A user writing to `core`                               | `app_web` has **no write grant on `core`**; ingest runs as `app_ingest` from server jobs only                   |
| **Repudiation**     | "I didn't rate that"                                   | Append-only `usr.state_event` and versioned `usr.rating`                                                        |
| **Info disclosure** | Cross-tenant read; share-link enumeration              | RLS + explicit `accountId` + middleware; 126-bit share slugs; generic error boundaries                          |
| **DoS**             | Path-finder abuse; ingest abuse as a free TMDB scraper | 20/min/account on paths; per-account daily ingest cap; invite-only signup is the primary control                |
| **EoP**             | Cron invocation; admin routes                          | `CRON_SECRET` with `timingSafeEqual`; admin gated on a server-checked flag                                      |

**Attacker model:** an opportunistic internet scanner, plus a curious recipient of a share link.
Not a targeted adversary — this is a private family app, and controls are sized accordingly. That
sizing is a documented decision, not an oversight.

## Authentication

Better Auth — [ADR 0009](adr/0009-better-auth.md). Email OTP today; passkeys are the intended
primary method. Sessions are httpOnly / Secure / SameSite=Lax, 30-day rolling with 7-day refresh,
stored server-side so "sign out everywhere" is a delete.

A six-digit code rather than a magic link: on a phone a link opens in whichever browser handles
mail, which is frequently not the one the person started in, and the session lands where they are
not looking.

**Better Auth's user model IS `usr.account`.** Its own `account` model means OAuth links — a
different thing from ours, which is the human being — so that one moved to `usr.oauth_account`. The
payoff is that the session user id and the account id are the same value, so `app.account_id` for
RLS needs no lookup and the two can never drift apart. Do not also set `modelName` overrides: naming
the user model `account` collides with Better Auth's own, and the failure is opaque
(`Field email not found in model account`).

### The authentication bootstrap

**Sign-in has to read `usr.account` before a session exists.** Looking a user up by email happens
when there is no `app.account_id` to filter by — and `usr.account` has `FORCE ROW LEVEL SECURITY`,
which binds the table owner too, and the owner is what the application connects as in production.
Without a way in, Better Auth simply cannot work.

The tempting fix is a policy like `USING (usr.current_account_id() IS NULL)`. **That is a
disaster**: it means any query that forgets `withUser()` reads every account, which is precisely the
leak this design exists to prevent.

The fix is a separate role:

| Role       | On `usr.account`                         | On ratings, viewing, notes, shares | On `core` |
| ---------- | ---------------------------------------- | ---------------------------------- | --------- |
| `app_web`  | own row only, via RLS                    | own rows only, via RLS             | SELECT    |
| `app_auth` | unrestricted, via a role-targeted policy | **no grant at all**                | no grant  |

`AUTH_DATABASE_URL` points Better Auth at `app_auth`. It falls back to the main URL when unset,
which is fine locally (a superuser bypasses RLS) but **not in production** — set it.

`tests/authz/auth-bootstrap.test.ts` proves both halves: `app_auth` can find and create users with
no session, and is refused on every table holding viewing history.

### Invite-only

Enforced in a Better Auth `before` hook on `/email-otp/send-verification-otp`, so an uninvited
person is refused **before a code is ever sent** rather than receiving an email they cannot use. A
direct POST hits the same check; the UI is not the gate.

Redemption is one statement with `RETURNING`, not select-then-update. The obvious version is racy:
two sessions both see an unredeemed invite, and even with `redeemed_at IS NULL` in the UPDATE's
WHERE the second affects zero rows — which still reports success unless the caller checks. One
invite would admit two people. `tests/authz/invite-gate.test.ts` runs both redemptions concurrently
and asserts exactly one succeeds.

Create invites with `pnpm invite [email]`; list them with `pnpm invite --list`.

## Authorization — three concentric layers

1. **Middleware** — route level. Everything except `/s/*`, `/explore/*`, `/auth/*`, `/api/cron/*`
   and static assets requires a session.
2. **Repository** — every `usr.*` function takes explicit `accountId` as its first parameter. Never
   ambient. This makes "did we scope this?" visible at the call site and greppable in review.
3. **Row-Level Security** — the layer that makes accidental leakage structurally impossible.

```sql
ALTER TABLE usr.title_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_rows ON usr.title_state
  USING      (account_id = current_setting('app.account_id', true)::uuid)
  WITH CHECK (account_id = current_setting('app.account_id', true)::uuid);
```

## The serverless-driver gotcha — read this before touching `usr.*`

`SET LOCAL` only persists **within a transaction**. Neon's HTTP driver issues each query as its own
implicit transaction, so `SET LOCAL app.account_id` followed by a separate `SELECT` silently loses
the setting and **RLS returns zero rows**.

Therefore:

- All `usr.*` access goes through `withUser(accountId, fn)`, which opens an explicit transaction on
  the **pooled WebSocket connection**, runs `SET LOCAL app.account_id`, executes, and commits.
- `core`/`sem` global reads may use the fast HTTP driver; they need no RLS.
- A test asserts that querying `usr.title_state` _outside_ `withUser` returns zero rows.
- A zero-row read where a row was asserted to exist **throws**. Silent empties are how this failure
  mode hides.

This will cost a day if rediscovered. It is in `CLAUDE.md` as a hard rule for that reason.

**Second, independent reason `withUser()` must own every path: connection pooling.** `DATABASE_URL`
is a pgbouncer pooled connection in transaction mode, so a backend connection is handed to a
different request the moment a transaction ends. `SET LOCAL` is transaction-scoped and therefore
safe. A plain `SET app.account_id` would persist on that backend and be inherited by **the next
request that borrows it** — a cross-tenant data leak that would pass every test written against a
single user. Never use plain `SET` for the account id.

## Database roles

| Role          | Grants                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------- |
| `app_web`     | `SELECT` on `sem.*`; DML on `usr.*` (RLS on); **no grants on `raw`**; `SELECT`-only on `core` |
| `app_ingest`  | Full DML on `raw.*` and `core.*`; no access to `usr.*`                                        |
| `app_migrate` | DDL; used only by migrations in CI                                                            |

## Application security

- **Input validation** — Zod at every boundary: server actions, route handlers, provider responses,
  cron payloads. Never trust a provider's shape.
- **SQL injection** — Drizzle parameterization throughout. Dynamic graph SQL validates predicate and
  column identifiers against the generated ontology allowlist; never interpolates user input.
- **XSS** — React escaping; `dangerouslySetInnerHTML` is banned by ESLint. User notes render as
  plain text, not markdown, in MVP.
- **CSP** — strict, nonce-based. `script-src 'self' 'nonce-…'`; `img-src 'self' data:
https://image.tmdb.org`; `connect-src 'self'`; `frame-ancestors 'none'`; `object-src 'none'`.
  Plus HSTS, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, and a
  restrictive `Permissions-Policy`.
- **CSRF** — Server Actions carry framework protection; SameSite=Lax; origin check in middleware for
  mutating route handlers.

## Rate limiting

**Postgres, not Upstash.** The spec named Upstash Redis and also required a Postgres fallback for
when Redis is unavailable. If the fallback has to exist anyway, the second system buys only latency
at family-app volume — Neon Launch has no auto-suspend and a check is one indexed upsert measured in
single-digit milliseconds. Product principle 9 says a vendor must justify itself against a Postgres
table that would do 80% of the job; this one does 100%. Revisit if a check exceeds ~10ms at p95, or
if the app ever runs in more than one region.

`core.rate_limit_hit(bucket, limit, window)` is a **sliding** window, not a fixed one. A fixed window
lets a caller spend the whole budget at 0:59 and again at 1:01, so a stated limit of 5 is really 10
and the number in this document would be a lie. It weights the previous window by how much of it is
still in view — the standard two-counter approximation — for one extra read. A test asserts this, and
fails against a fixed-window implementation.

It is `SECURITY DEFINER` so `app_web` keeps **zero write grants anywhere in `core`**: a counters table
is not a good enough reason to punch the first hole in product principle 4.

| Surface             | Budget    | Key       | On limiter failure |
| ------------------- | --------- | --------- | ------------------ |
| Sign-in code send   | 3 / 60s   | IP + path | **fail-closed**    |
| Sign-in code verify | 3 / 10s   | IP + path | **fail-closed**    |
| Search proxy (TMDB) | 30 / 60s  | account   | fail-open          |
| Graph typeahead     | 30 / 60s  | account   | fail-open          |
| Path finder         | 20 / 60s  | account   | fail-open          |
| Share creation      | 20 / hour | account   | fail-open          |

The two authentication rows are **Better Auth's own rules**, not ours. It ships them, they are
stricter than anything worth hand-writing, and a limiter added in a `before` hook was dead code —
theirs runs first and always refused before ours was reached. What Better Auth does _not_ ship is
durable storage: the default is an in-process `Map`, so on Vercel the budget is per lambda and is
discarded whenever an instance recycles, giving an attacker 3/min times however many instances they
can reach. `rateLimit.customStorage` points it at `core.rate_limit`, which makes one shared, durable
counter and leaves its rules in charge. `enabled` is forced on so development behaves like production
rather than exercising the path for the first time in production.

Fail-open is the default because the limiter protects TMDB's quota and our own CPU, not a secret —
turning a database hiccup into a dead search box is the worse outcome. Authentication is the
exception: unlimited attempts at a six-digit code is the one case where an outage wins an attacker
something, and refusing sign-in during a database outage costs nothing, because sign-in needs the
database anyway.

Refused attempts are still counted. Otherwise hammering a blocked endpoint holds the estimate at
exactly the limit and the caller is never told to back off for longer.

The public share page is **not** limited: it is served from the route cache and does not reach the
database on a hit, so a counter write would be the most expensive thing about it.

Counters are pruned by `housekeeping` after a day; only the current and previous windows are ever
read.

## Secrets and rotation

| Secret                     | Rotation                                                             |
| -------------------------- | -------------------------------------------------------------------- |
| `TMDB_READ_ACCESS_TOKEN`   | On suspicion only                                                    |
| `DATABASE_URL`             | 180 days, or immediately on exposure                                 |
| `BETTER_AUTH_SECRET`       | 365 days (rotating invalidates all sessions — schedule deliberately) |
| `CRON_SECRET`              | 180 days                                                             |
| `UPSTASH_*`                | 180 days                                                             |
| Google OAuth client secret | 365 days                                                             |

No secret is committed. `.env.example` documents names only. CI greps for
`NEXT_PUBLIC_.*(KEY|SECRET|TOKEN)`. The TMDB key never reaches the client because all TMDB traffic
is proxied server-side.

**TMDB auth uses the v4 Read Access Token as a Bearer header, never the v3 `api_key` query
parameter.** The v3 key travels in the URL, and `src/server/providers/` logs request paths — a
query-string credential would be written into our own logs and into any intermediary's. This is a
one-line difference at the call site and removes an entire credential-leak class.

## Privacy

| Data                                     | Visibility                               |
| ---------------------------------------- | ---------------------------------------- |
| Ratings, statuses, viewings, notes       | Owner only                               |
| A snapshot of rating + note on one title | Anyone with the share URL, until revoked |
| Display name                             | On share pages the user created          |
| Email                                    | Never exposed anywhere                   |
| Canonical media and ontology             | Public                                   |

Email is the only PII stored. Notes may contain personal content — never logged, never in error
reports (Sentry `beforeSend` scrubs `note`, `message`, `email`). Full JSON+CSV export and hard
account deletion in `/me`; deletion drops `usr.*` and leaves `core.*` untouched.

Both halves are `withUser`-scoped, so an unscoped query returns zero rows rather than everyone's.
Three details are not obvious from that sentence and are load-bearing:

- **Deletion runs as `usr.delete_account`, a SECURITY DEFINER function, own account only.** Not
  even an admin may delete someone else — an admin can revoke a session, which is reversible,
  where this is not. It has to be a definer function because `app_web` deliberately holds no
  `DELETE` on `usr.state_event`; the append-only log has exactly one legitimate exception, and
  that exception is a whole account leaving, not a grant that would also permit erasing a single
  inconvenient event.
- **`usr.invite` is `ON DELETE NO ACTION`**, so an account that created or redeemed an invite
  cannot be deleted until those references are released. They are set to `NULL`, not deleted: a
  spent code has to stay spent, or dropping the row hands a used invite back to whoever still
  holds it.
- **The export omits sessions and verification tokens.** They are credentials, not data — a copy
  of a live session in a file the person then emails to themselves is a worse outcome than the
  convenience is worth.

Deletion returns a per-table receipt, which is what `/me` renders, and what the authz suite
asserts against — including that `core.title` has the same row count afterwards.

Not SOC 2 or HIPAA scope. No automated decision-making with legal effect, so GDPR Art. 22 is not
engaged.

## Phase 3 AI controls — pre-committed

- **LLM06 excessive agency / ASI02 tool misuse** — the agent gets a fixed registry of parameterized,
  account-scoped semantic queries. No free-form SQL, no write tools, no cross-account reads. This is
  already the design; see [future-ai.md](future-ai.md).
- **LLM01 prompt injection** — user notes and provider overview text are untrusted; passed as data
  in a delimited block, never concatenated into instructions.
- **LLM02 disclosure** — tool results are account-scoped by construction.
- **LLM09 misinformation** — every numeric claim comes from a tool result; answers cite the entities
  and edges used.
- **MCP** — no MCP server is in scope at any phase.
