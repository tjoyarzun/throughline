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
] as const;

/** Authenticate themselves with a bearer secret; a cookie redirect breaks them. */
export const SELF_AUTHENTICATING_PREFIXES = ['/api/cron/', '/api/admin/'] as const;

export const UNGATED_PREFIXES: readonly string[] = [
  ...PUBLIC_PREFIXES,
  ...SELF_AUTHENTICATING_PREFIXES,
];

export function isUngated(pathname: string): boolean {
  return UNGATED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}
