# ADR 0005 — Favorites is an orthogonal relationship, not a status

**Date:** 2026-09-20 · **Status:** Accepted

## Decision

`is_favorite boolean` + `favorited_at` on `usr.title_state`, orthogonal to the lifecycle status
(`watchlist` / `watching` / `watched` / `abandoned`).

## Why not a status

1. **It is orthogonal to lifecycle.** You can favorite a show you are still watching, or a film on
   your watchlist you loved as a kid. A status forces a false exclusive choice.
2. **It differs from a rating.** A 5-star documentary you will never rewatch is not a favorite; a
   4-star comfort film you have seen nine times is. Rating is judgment, favorite is affinity.
   Collapsing them loses signal the analytics layer wants.
3. **The UI can still present a list.** `Favorites` is a Library segment derived from
   `WHERE is_favorite`. The user experiences a list; the model knows it is a flag.

Favorite and unfavorite still append to the user event log, so the history is preserved.
