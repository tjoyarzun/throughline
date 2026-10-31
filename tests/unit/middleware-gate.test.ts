import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  isUngated,
  exploreNeedsSession,
  safeNextPath,
  SELF_AUTHENTICATING_PREFIXES,
  SESSION_GATED_API_ROUTES,
} from '@/lib/route-access';
import { EXPLORE_OPENERS } from '@/lib/explore-openers';

/**
 * The session gate must not stand in front of routes that authenticate
 * themselves with a bearer secret.
 *
 * /api/admin/invite shipped unreachable: middleware redirected it to the
 * sign-in page before its CRON_SECRET check could run, so a request with a
 * valid secret got a 307 to an HTML page instead of a JSON response — and a
 * request WITHOUT one got the same 307 rather than the 401 it deserved, which
 * hides a failed authorization behind what looks like a routing quirk.
 */
/** Every API route directory under src/app/api. */
function apiRoutes(base = 'src/app/api', prefix = '/api'): string[] {
  if (!existsSync(base)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(base, entry.name);
    const path = `${prefix}/${entry.name}`;
    if (existsSync(join(dir, 'route.ts'))) out.push(path);
    out.push(...apiRoutes(dir, path));
  }
  return out;
}

describe('middleware session gate', () => {
  const covered = isUngated;

  it('every bearer-authenticated API route is ungated', () => {
    // These check a secret themselves and must reach their own handler.
    for (const route of apiRoutes()) {
      if (SELF_AUTHENTICATING_PREFIXES.some((p) => route.startsWith(p.replace(/\/$/, '')))) {
        expect(covered(route), `${route} would be redirected before it can return 401`).toBe(true);
      }
    }
  });

  it('public read surfaces are ungated', () => {
    for (const p of ['/s/abc123', '/api/health', '/auth/signin']) {
      expect(covered(p), `${p} must be reachable without a session`).toBe(true);
    }
  });

  it('application routes are still gated', () => {
    for (const p of ['/', '/library', '/me', '/universe', '/search', '/title/arrival-2016']) {
      expect(covered(p), `${p} must require a session`).toBe(false);
    }
  });

  it('every deliberately gated route is in fact gated', () => {
    for (const route of SESSION_GATED_API_ROUTES) {
      expect(covered(route), `${route} is listed as gated but is ungated`).toBe(false);
    }
  });

  it('a new API route under a gated path is caught', () => {
    // Guards the future: an /api/something route that is neither cron nor
    // admin and is not listed will be session-gated, which may be correct —
    // this just makes the set explicit rather than accidental.
    const unlisted = apiRoutes().filter(
      (r) => !covered(r) && !(SESSION_GATED_API_ROUTES as readonly string[]).includes(r),
    );
    expect(unlisted, 'unexpected ungated-by-omission API routes').toEqual([]);
  });
});

describe('safeNextPath — where sign-in may send you', () => {
  it('keeps paths on this site, query and fragment included', () => {
    expect(safeNextPath('/library')).toBe('/library');
    expect(safeNextPath('/title/arrival-2016?tab=cast#crew')).toBe(
      '/title/arrival-2016?tab=cast#crew',
    );
    expect(safeNextPath(undefined)).toBe('/');
    expect(safeNextPath('')).toBe('/');
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/\t/evil.example',
    // Resolves on-site, but to "//evil.example", which the browser then reads
    // as protocol-relative. The case a startsWith('/') check would wave through.
    '/.//evil.example',
    'javascript:alert(1)',
    'http://[',
  ])('refuses %j', (next) => {
    expect(safeNextPath(next)).toBe('/');
  });
});

describe('exploreNeedsSession — how deep a stranger may go', () => {
  it('leaves the landing and the curated openers open', () => {
    expect(exploreNeedsSession('/explore')).toBe(false);
    expect(exploreNeedsSession('/explore/')).toBe(false);
    for (const o of EXPLORE_OPENERS) {
      expect(exploreNeedsSession(`/explore/${o.type}/${o.slug}`), o.slug).toBe(false);
      expect(exploreNeedsSession(`/explore/${o.type}/${o.slug}/`), `${o.slug}/`).toBe(false);
    }
  });

  it('gates every other node page', () => {
    expect(exploreNeedsSession('/explore/person/some-character-actor-12345')).toBe(true);
    expect(exploreNeedsSession('/explore/organization/amc-174')).toBe(true);
    // An opener slug under the wrong type is a different page.
    expect(exploreNeedsSession('/explore/person/the-godfather-1972')).toBe(true);
  });

  it('does not touch anything outside /explore', () => {
    for (const p of ['/', '/s/abc', '/universe/explore', '/explorer', '/api/health']) {
      expect(exploreNeedsSession(p), p).toBe(false);
    }
  });
});
