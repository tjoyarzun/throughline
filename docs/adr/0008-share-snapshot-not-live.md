# ADR 0008 — Shares snapshot the rating and note at creation

**Date:** 2026-09-20 · **Status:** Accepted

## Decision

`usr.share` stores `rating_snapshot` and `note_snapshot` captured at creation time, not a live
reference to the user's current rating.

## Why

You sent a friend "I gave it four and a half stars." If you later re-rate it to three, the message
you already sent should not silently rewrite itself. Snapshotting makes a shared artifact an
immutable statement, which is both more honest and less surprising.

The share page shows its creation date when the current rating differs. Re-sharing creates a new
link. `revoked_at` kills a link instantly.

## Security shape

The slug is a 21-character nanoid, about 126 bits — an unguessable capability URL, `noindex`ed. The
share route queries `core`/`sem` plus exactly one `usr.share` row by slug and **never opens a
user-scoped transaction**, so there is no code path from a share page to any other user data.
