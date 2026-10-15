# Handoff — sessions of 2026-10-11 and 2026-10-12

What happened, what it cost, and what is still open. Written for whoever picks this up next,
including me.

Five commits:

| Commit    | What                                                   |
| --------- | ------------------------------------------------------ |
| `4aec44a` | Stop crawlers walking all 70,000 `/explore` pages      |
| `3b28ba3` | Pin the OTP attempt cap instead of inheriting it       |
| `61a078a` | Run `refresh-stale` hourly while the corpus catches up |
| `a1cb6b1` | Redraw the app icon as the constellation               |
| `62764ae` | Give the halos their edge back                         |

---

## 1. The Vercel bill was a crawler, not the app

**The finding.** Production logs for a 3.5-hour window: 1,000 requests, **972 of them
`/explore/[type]/[slug]` across 969 distinct slugs**, every one a cache miss. 808 were
`/explore/person/*`, walking the 58,714-person corpus. That is 97% of all production traffic, and
it is a crawler, not people.

Each request runs `nodeBySlug` + `neighbors()` + `neighborhood()` — two multi-CTE graph traversals
against `sem.edge_bidirectional` with joins to `core.node_degree`. `unstable_cache` with
`revalidate: 3600` never helps, because a crawler does not ask for the same slug twice. At the
observed rate the crawl had roughly **72 days and 1.6M requests** left to run.

**The cause had two halves, and the second is the interesting one.** There was no `robots.txt`
_and_ `/robots.txt` was not exempt from the session gate — so middleware answered all 14 requests
for it in that window with a **307 to the sign-in page**. Crawlers asked permission, got a login
form, and crawled everything.

The fix needed both: `public/robots.txt` disallowing `/explore/`, and the path exempted in
`src/middleware.ts` **and** `src/lib/route-access.ts`, exactly as `sw.js` already was. The comment
in `route-access.ts` had predicted this failure mode for a different file.

`/s/` is deliberately **not** disallowed: unfurl bots have to fetch share pages to build an iMessage
or Slack preview, and some honor robots.txt.

**Lesson worth keeping.** The crons were never the problem and I nearly spent the session tuning
them. The diagnosis came from `vercel logs --environment production --since 7d --json` piped into
a path histogram — about two minutes of work that replaced an hour of plausible theorizing.

---

## 2. Security review of the login path

Asked for a critical read. The honest verdict: **it is in better shape than most production auth.**
Verified sound, not assumed:

- Invite gate runs server-side in a `before` hook on the send endpoint, so a direct POST hits it too
- **Three guesses per OTP**, tracked on the verification record — identity-scoped, so rotating IPs
  buys no extra guesses. This is the control that makes six digits survivable
- Rate limiting is durable in Postgres, not per-lambda memory, and **fail-closed on auth**
- Cookies `httpOnly` + `sameSite=lax` + `secure` with the `__Secure-` prefix in production
- Auth connects as least-privilege `app_auth` — confirmed in the production env and live health
- All six `usr.admin_*` functions call `assert_admin`, which is `SECURITY DEFINER` with
  `SET search_path = usr, pg_temp`
- Invite codes: 40 bits, CSPRNG, 32-char alphabet, **no modulo bias** (256 % 32 == 0)

**Four findings. Two fixed, two are documented tradeoffs:**

1. **Resend key unrotated** — fixed. Rotated 2026-10-11, replacement scoped to **sending only**, so
   a future leak cannot read back sent OTP codes. Old key revoked, and a send _after_ revocation
   returned 200, which is what proves the old key was not still load-bearing somewhere.
2. **`allowedAttempts` was an implicit library default** — fixed in `3b28ba3`. The number was
   already 3 and still is; what changed is that a `better-auth` upgrade can no longer alter the
   single most important control in the sign-in path without a diff.
3. **Account enumeration oracle** — not fixed, deliberately. `auth.ts` returns early for an existing
   account (OTP sent, 200) and throws 403 for an unknown one. Anyone can test whether an address has
   an account. Rate-limited to 3/min/IP. Making the responses identical means an invited friend who
   typos their email gets silence instead of a useful error — worse for the five real users than the
   leak is.
4. **OTP in the email subject line** — readable from a lock-screen notification without unlocking.
   Deliberate, probably right for family, worth knowing.

**Unverified and worth a look someday.** No `advanced.ipAddress.ipAddressHeaders` or
`trustedProxies` is configured. Better Auth's default resolves an IP only when `x-forwarded-for`
holds **exactly one** address (`ip.mjs:190`); otherwise everyone collapses into one shared bucket.
I could not determine Vercel's behavior from the code. If it triggers, the effect is a degraded
limiter rather than a bypass — the per-OTP cap still holds.

---

## 3. Corpus freshness, and why the threshold may be the bug

Freshness was 36% against an 80% floor, so `/api/health` returns **503**. The crons were running
fine — `refresh_stale` had succeeded 13 hours earlier with zero failures. They were outrun, not
broken.

The arithmetic: 5,024 titles on a 7-day window needs ~570 refreshed per day. One 40-second drain
in the nightly cron does not come close. One manual trigger moved 36% → 38%, so roughly **100
titles per drain window**.

Hourly gives 24 windows instead of 1 — about 2,400/day against a ~3,100 backlog, so **roughly a day
and a half** to clear.

**If it does not clear, the threshold is wrong, not the cadence.** `MIN_FRESH_PCT = 80` escaped the
sweep that already corrected `QUEUE_STALL_S` and the on-demand job kinds, and by this codebase's own
standard — _"a threshold that can never be met is noise, not a signal"_ — that makes it the defect.
I deliberately did **not** preemptively lower it, because if hourly closes the gap then the
threshold was right all along.

---

## 4. The app icon

Shipped as **Aurora** — a six-node constellation in the real `graphPalette` hues, gold majority with
concept-purple and title-blue, hard-edged halo discs behind the three largest nodes, over a warm
vignette. Picked from three directions, then three treatments of the winner.

Mockups: https://claude.ai/artifact/Xv4K4xeUG2R7eJhJzs1iWG

`scripts/make-icons.py` holds the geometry and is the only source for it; `public/*.png` are output.
Everything renders at 2048px and downsamples with LANCZOS, so the 16px favicon is supersampled 128x.

**16 and 32 are a different drawing, not a downscale** — three nodes, no halos, no vignette. Six
nodes and seven edges at 16px is mud, and soft gradients band there. This follows the precedent
already documented in `layout.tsx`.

**Two bugs, both found by measuring rather than looking.** Worth remembering because the first is a
general PIL trap:

1. The halos first shipped **invisible**. They were drawn onto a transparent RGBA layer which was
   then pasted using its own alpha — compositing a color onto a transparent (so black) pixel blends
   it toward black by the mask, and the second paste applies the mask _again_. The color arrives at
   **alpha squared**. Measured +4 red over background where the mockup computes +34. Fix: paste
   straight onto the ground in one blend.
2. Fixing that, I replaced the ramp with a feathered rim — right in weight, wrong in kind. A disc of
   color became a blur. The mockup drew plain SVG circles at flat opacity and **the crispness is the
   design**. Now hard-edged, built the way the nodes are: oversampled, downsampled, antialiased at
   the rim and nothing more.

With the compositing fixed, the mockup's original values were correct as written: 0.16 gold, 0.18
purple and blue, radii 16/14/14. The inflated numbers I reached for while the output looked weak
are gone.

---

## 5. Things that will bite the next session

**`vercel link` rewrites `.gitignore`.** It appends a broad `.env*`, which the file's own comment
predicted verbatim — _"`vercel link` appends exactly that; if it comes back, delete it rather than
reordering."_ Delete line, do not reorder. `.env.example` is currently tracked so it survives today
either way, which makes this a latent trap rather than a live one.

**Vitest never reads `.env.local`.** `vitest run` takes no `--env-file` and `vitest.config.ts` loads
no dotenv; CI supplies `DATABASE_URL` as a job-level env. Three integration tests fail locally and
that is expected. Do not "fix" the config.

**`.py` is invisible to every guard in this repo.** `check-locale`, `cspell` and prettier all match
only `.ts/.tsx/.md/.css/.yaml/.yml/.sh/.json`. `scripts/make-icons.py` is the only file in
`scripts/` nothing checks — I caught two British spellings in it by hand that no check would have
flagged.

**Env changes need a redeploy.** A running deployment holds its env snapshot. This bit the Neon
rotation earlier in the project and again with Resend. Change the variable, redeploy, _then_ verify.

**`vercel env add <name> <env> <value>` does not do what it looks like.** The third positional is a
**gitBranch**, so passing the value there fails with _"Environment Variables with `gitBranch` can
only be used with `target=preview`"_ — after the `rm` has already succeeded, leaving the variable
absent and the crons 401ing. Use `openssl rand -hex 32 | tr -d '\n' | pbcopy` and paste at the
masked prompt; nothing then renders to a terminal to be screenshotted.

**Secrets leaked twice this session**, both recovered, both the same way: a generator printed to
screen, then the value went into a CLI argument. Neither reached production. The `pbcopy` pattern
above is the habit worth keeping.

---

## 6. Open, in the order I would do it

1. ~~Revert `refresh-stale` to daily and drop back to Hobby~~ — **done 2026-10-15.** Freshness
   reached **100%** (from 36%), `/api/health` returns `ok`, and both `vercel.json` and
   `scripts/check-vercel.ts` are back on daily/hobby. See section 7 for what the traffic check
   actually found, which was not what the percentage suggested.
2. **Check the icon on a real device.** Delete and re-add to the Home Screen to beat the iOS cache,
   and look at it against your actual wallpaper. The hard halo rims are more visible on a light
   wallpaper than the soft version was.
3. **Populate the concept hierarchy** — the highest value-to-effort item from the data-model review.
   `themes.yaml` declares 120 themes in 17 clusters; `deriveThemes` discards every cluster.
   `parent_id` and `broader_than` both exist and are both empty, so **the ontology has no working
   hierarchy**. Half a day.
4. **`/explore` reports the declared predicate count, not the in-use one.** 13 of 21 predicates
   carry data; the public page says 21. `universeStats()` already computes `predicatesInUse` —
   `ontologyStats()` needs the same field. ~15 lines.
5. **Re-ingest never propagates corrected TMDB metadata.** The `else` branch refreshes only
   popularity, votes and `synced_at`. A corrected title or runtime never lands. Decide which fields
   are safe to refresh before coding — `title` has a slug relationship to think through.
6. **Character resolution** — the largest declared-and-empty surface. `core.character` has no
   `INSERT` anywhere, `credit.character_id` is never set, and `portrayed_by` / `features_character`
   are declared and never written. 2–3 days, and genuinely hard: TMDB's character field is free
   text. Do the conservative version.

Full backlog and sizing live in Asana project `1217469158076973`. The two review documents —
[ARCHITECTURE.md](ARCHITECTURE.md) and [DATA_MODEL.md](DATA_MODEL.md) — carry the complete
discrepancy lists in their final sections.

---

## 7. Follow-up, 2026-10-15 — reading the crawler numbers correctly

**Freshness closed.** 36% → **100%**, `/api/health` back to `ok` from a 503. Hourly `refresh-stale`
ran for three days and cleared the ~3,100-title backlog, so the 80% threshold was right all along
and only the cadence was wrong. Reverted to daily; plan goes back to Hobby.

**The traffic number is a trap, and I nearly fell in it.** `/explore` is still **96% of all
production traffic** — essentially unchanged from the 97% that forced the upgrade. Read as a
percentage, the robots.txt fix did nothing.

Read as a rate, it did almost everything:

|                     | Before       | After        |
| ------------------- | ------------ | ------------ |
| `/explore` requests | **278/hour** | **~30/hour** |
| Projected per month | ~200,000     | **~21,600**  |

The percentage barely moved because legitimate traffic is near zero — it is a private family app
with five users, so whatever remains is dominated by whatever is left of the bot. **On a low-traffic
site, share-of-traffic is a meaningless health metric.** Measure the absolute rate.

Two measurement notes worth keeping: `vercel logs --limit N` silently truncates, so a count that
equals the limit is a floor and not a total — take a window small enough to come back under it.
And the logs carry no user-agent field at all, so a bot cannot be identified from them; that lives
in Observability or the Firewall tab.

**What remains is a bot that ignores `robots.txt`.** Confirmed served: `200`, `User-agent: *`,
`Disallow: /explore/`. It is walking the corpus methodically by entity type — it was 83% `person`
on 10-11, and is 87% `organization` now, so it finished one type and moved to the next. 384 distinct
slugs in 385 requests, every one a cache miss.

At ~2% of Hobby's allowance this is affordable rather than solved, and the distinction matters. If
it accelerates or another joins, the lever is a user-agent check in `middleware.ts` guarding
`/explore/` — cheap, because middleware runs before the two graph queries that cost the money. That
needs the agent string first.
