import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { isUngated } from '@/lib/route-access';

/**
 * Route-level gate — the first of three authorization layers (see
 * docs/security.md). The others are the explicit `accountId` parameter on every
 * repository function, and Postgres RLS.
 *
 * This checks only for the PRESENCE of a session cookie, not its validity.
 * Validating here would mean a database round-trip in middleware on every
 * request including static assets. A forged cookie gets past this and then hits
 * the two real layers, which is the correct division of labor: middleware is a
 * redirect convenience, not a security boundary.
 *
 * It is also where the security headers are set, because the CSP nonce has to
 * be minted per request and handed to Next before it renders.
 */

/**
 * The response headers every document gets.
 *
 * @param nonce per-request, so inline scripts Next emits can be allowed
 *   without opening the door to injected ones.
 */
function securityHeaders(nonce: string): Record<string, string> {
  const dev = process.env.NODE_ENV !== 'production';

  const csp = [
    "default-src 'self'",
    // 'strict-dynamic' lets the scripts we vouch for load their own chunks,
    // so the allowlist does not have to enumerate Next's build output.
    // 'unsafe-eval' is DEV ONLY: React Refresh compiles with eval, and without
    // it hot reload dies. It is never sent in production.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    // style-src has to allow inline, and that is a deliberate concession.
    // Every component in this app styles through React's `style` prop, which
    // server-renders as a style="" ATTRIBUTE -- exactly what a strict style-src
    // blocks. Moving to classes is a rewrite of the entire UI, and style
    // injection is a far narrower risk than script injection, which stays
    // nonce-locked. Revisit if the UI is ever refactored onto classes.
    "style-src 'self' 'unsafe-inline'",
    // Posters and backdrops come straight from TMDB's CDN, deliberately
    // bypassing the Next image optimizer (docs/adr/0012).
    "img-src 'self' data: blob: https://image.tmdb.org",
    "font-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "base-uri 'self'",
    // Nothing here is ever meant to be framed; this is the clickjacking
    // control that X-Frame-Options only approximates.
    "frame-ancestors 'none'",
    "object-src 'none'",
    // Covered by default-src, but stated: the service worker is same-origin
    // and a future default-src change must not silently un-register it.
    "worker-src 'self'",
    // PRODUCTION ONLY. This rewrites every http:// subresource to https://,
    // which is free on a deployment that is already HTTPS and fatal on
    // http://localhost: every stylesheet and chunk gets upgraded to a port
    // with no TLS listener, so the page renders unstyled with no CSP
    // violation logged anywhere. It failed as a TLS error, not a policy one.
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    // Share slugs are capability URLs. Sending a full path to a third party in
    // a Referer header would hand over the capability itself.
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  };
}

export function middleware(request: NextRequest): NextResponse {
  // Base64 of 16 random bytes. Next reads x-nonce and stamps its own inline
  // scripts with it, which is what makes 'strict-dynamic' safe to use.
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const headers = securityHeaders(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const apply = (res: NextResponse): NextResponse => {
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  };

  const { pathname } = request.nextUrl;
  const allow = () => apply(NextResponse.next({ request: { headers: requestHeaders } }));

  if (isUngated(pathname)) return allow();
  if (getSessionCookie(request)) return allow();

  // Preserve where they were going, so sign-in returns them there.
  const signIn = new URL('/auth/signin', request.url);
  if (pathname !== '/') signIn.searchParams.set('next', pathname + request.nextUrl.search);
  return apply(NextResponse.redirect(signIn));
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:png|jpg|svg|ico)$).*)',
  ],
};
