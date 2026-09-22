/**
 * Which paths the session gate must not stand in front of.
 *
 * Two different reasons, kept apart deliberately — conflating them is how
 * /api/admin/invite shipped unreachable: middleware redirected it to the
 * sign-in page before its own CRON_SECRET check could run, so a valid request
 * got a 307 to HTML, and an INVALID one got the same 307 rather than the 401
 * it deserved. A failed authorization disguised as a routing quirk.
 *
 * Exported as data, not embedded in the middleware, so tests assert against
 * the real value instead of scraping the source. The first version of that
 * test did scrape it, and a regex broke on an apostrophe inside a comment.
 */

/** No credential required at all. */
export const PUBLIC_PREFIXES = [
  '/s/', // share pages
  '/explore/', // public ontology pages (Phase 2 backlog)
  '/auth/', // the sign-in page itself
  '/api/auth/', // Better Auth handlers
  '/api/health',
  // The service worker script itself. Without this the registration request is
  // redirected to sign-in and the worker silently never installs.
  '/sw.js',
  '/offline',
] as const;

/** Authenticate themselves with a bearer secret; a cookie redirect breaks them. */
export const SELF_AUTHENTICATING_PREFIXES = ['/api/cron/', '/api/admin/'] as const;

/**
 * API routes that are DELIBERATELY behind the session gate.
 *
 * Listed explicitly so "this route requires a session" is a decision on the
 * record rather than a consequence of nobody having thought about it. A new
 * /api/* route that is neither ungated nor listed here fails a unit test.
 */
export const SESSION_GATED_API_ROUTES = [
  // Proxies TMDB. Open to the world it would be a free scraping endpoint for
  // someone else's rate limit, and ours to answer for. See docs/security.md.
  '/api/search',
  // Typeahead over every graph node. Same reasoning as /api/search: it exposes
  // the whole corpus, and there is no reason for it to answer strangers.
  '/api/graph/search',
  // Hands back the caller's entire history as a file. The session IS the
  // authorization; there is no slug or token standing in for one.
  '/api/me/export',
] as const;

export const UNGATED_PREFIXES: readonly string[] = [
  ...PUBLIC_PREFIXES,
  ...SELF_AUTHENTICATING_PREFIXES,
];

export function isUngated(pathname: string): boolean {
  return UNGATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}
