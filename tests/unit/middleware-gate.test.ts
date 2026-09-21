import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isUngated, SELF_AUTHENTICATING_PREFIXES } from '@/lib/route-access';

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

  it('a new API route under a gated path is caught', () => {
    // Guards the future: an /api/something route that is neither cron nor
    // admin and is not listed will be session-gated, which may be correct —
    // this just makes the set explicit rather than accidental.
    const unlisted = apiRoutes().filter((r) => !covered(r));
    expect(unlisted, 'unexpected ungated-by-omission API routes').toEqual([]);
  });
});
