# ADR 0009 — Better Auth over Auth.js v5 and Clerk

**Date:** 2026-09-20 · **Status:** Accepted

## Decision

Better Auth, with the Drizzle adapter, users in our own Postgres alongside `usr.*`.

## Alternatives

- **Auth.js v5** — in maintenance mode, security patches only, no new feature development, and no
  built-in passkeys. Rejected for a greenfield project.
- **Clerk** — a good product, and its free tier is generous. Rejected because it puts the user table
  in a database we do not control, which directly contradicts this project's thesis that the user
  layer is part of one coherent semantic model. It is also a paid dependency at scale on a ~$20/mo
  budget.

## Why Better Auth

TypeScript-native, owns data in our Postgres (so `usr.account` joins to `usr.title_state` like any
other table), and ships **passkeys** — which with Face ID is by a wide margin the best sign-in
experience for a phone-first app that family members will use.

Methods in order of preference: passkey, then email OTP (a six-digit code beats a magic link that
opens the wrong browser on mobile), then Google OAuth for convenience.

Invite-only is enforced in a server-side `before` hook on sign-up, not a UI check. A test asserts a
direct POST without an invite fails.
