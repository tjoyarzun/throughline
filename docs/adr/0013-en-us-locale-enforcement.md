# ADR 0013 — American English enforced by a denylist, not by convention

**Date:** 2026-09-20 · **Status:** Accepted

## Context

en-US is a standing convention across all of Tommy's personal projects. It was stated in prose and
nowhere enforced. The first draft of this project's own specification was written in British English
throughout — `colour`, `normalisation`, `materialised`, `centred`, `behaviour`, `labelled`, and
about 60 more — and had to be corrected by hand.

A convention that lives only in prose gets violated by the next session.

## Decision

Two checks, both in CI and in `lefthook` pre-commit:

1. **`cspell`** with `language: en,en-US` plus `project-words.txt`.
2. **`scripts/check-locale.sh`** — a curated denylist of British `-ise`/`-isation` stems and literal
   forms (`colour`, `centre`, `behaviour`, `modelling`, `whilst`, and so on).

**The denylist is the one that matters.** cspell alone cannot catch this: `colour` and
`normalisation` are valid dictionary words and pass a spell check cleanly. Locale drift needs a
denylist, not a dictionary.

## Scope

Everything a human reads: UI copy, error messages, empty states, metadata, the theme vocabulary,
narration templates, all docs and ADRs, commit messages, code comments, and identifiers we author.

## Exceptions — do not "correct" these

Matching the surrounding context beats locale:

- **Provider field names.** If TMDB or any API returns a field with non-US spelling, `raw` capture
  and the mapper keep it verbatim. Renaming a provider field breaks the contract. Our canonical
  column gets the US spelling; the mapper is where the two meet.
- **Third-party package names, CSS properties, SQL keywords.**
- **Quoted material** — provider overview text, user notes, film titles. _The Colour of
  Pomegranates_ keeps its title.
- **Proper nouns** as they spell themselves.

Exceptions go in `.localeignore` as a regex with a stated reason, or an inline `locale-ok` comment.

## Propagation

`scripts/check-locale.sh` and the cspell config are project-agnostic and are copied into
`~/personal/pantry/scaffold/web-app/`, so every future personal project inherits the check at
bootstrap rather than relying on prose.
