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

Better Auth — [ADR 0009](adr/0009-better-auth.md). Passkey > email OTP > Google OAuth. Sessions are
httpOnly / Secure / SameSite=Lax, 30-day rolling with 7-day refresh, stored server-side so
"sign out everywhere" is three lines.

Invite-only is enforced in a server-side `before` hook, not the UI.

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

Upstash Redis sliding window: auth 5/min/IP · search proxy 30/min/account · share creation
20/hour/account · public share page 120/min/IP · **path finder 20/min/account** (the expensive one).
Postgres fallback counter if Redis is unavailable; fail-open on search, **fail-closed on auth**.

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
