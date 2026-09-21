import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Asserts the sign-in form posts to endpoints Better Auth actually serves.
 *
 * This exists because it already went wrong: the form posted the send request
 * to `/api/auth/sign-in/email-otp`, which is the VERIFY endpoint. I had tested
 * the API with curl using the correct paths and never tested the form, so the
 * flow worked in every check I ran and failed the moment a human used it.
 *
 * A typo'd URL is not something typechecking or linting can catch, so it needs
 * a test that reads the form and compares against the router.
 */
const FORM = readFileSync('src/components/auth/sign-in-form.tsx', 'utf8');

function endpointsUsedByForm(): string[] {
  return [...FORM.matchAll(/fetch\('(\/api\/auth\/[^']+)'/g)].map((m) => m[1]!);
}

describe('sign-in form endpoints', () => {
  it('posts to at least the send and verify endpoints', () => {
    const used = endpointsUsedByForm();
    expect(used.length, 'the form should call two auth endpoints').toBeGreaterThanOrEqual(2);
  });

  it('every endpoint it calls is served by Better Auth', async () => {
    const { auth } = await import('@/server/auth/auth');
    // Better Auth exposes its routes on the internal router; each is prefixed
    // with the basePath at request time.
    const known = new Set(
      Object.values(auth.api)
        .map((h) => (h as { path?: string }).path)
        .filter((p): p is string => typeof p === 'string'),
    );
    expect(known.size, 'no routes discovered — the introspection shape changed').toBeGreaterThan(5);

    for (const url of endpointsUsedByForm()) {
      const path = url.replace(/^\/api\/auth/, '');
      expect(known, `${url} is not a Better Auth endpoint`).toContain(path);
    }
  });

  it('uses the SEND endpoint to request a code, not the verify one', () => {
    // The specific mistake that shipped.
    const used = endpointsUsedByForm();
    expect(used[0], 'the first call must request a code').toBe(
      '/api/auth/email-otp/send-verification-otp',
    );
    expect(used[1], 'the second call must verify it').toBe('/api/auth/sign-in/email-otp');
  });

  it('sends the invite code with the request for a code', () => {
    // Invite-only is gated on the SEND path, so omitting it here means an
    // invited person is refused.
    expect(FORM).toMatch(/inviteCode/);
    expect(FORM).toMatch(/type:\s*'sign-in'/);
  });
});
