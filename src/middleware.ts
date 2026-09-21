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
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (isUngated(pathname)) return NextResponse.next();
  if (getSessionCookie(request)) return NextResponse.next();

  // Preserve where they were going, so sign-in returns them there.
  const signIn = new URL('/auth/signin', request.url);
  if (pathname !== '/') signIn.searchParams.set('next', pathname + request.nextUrl.search);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:png|jpg|svg|ico)$).*)',
  ],
};
