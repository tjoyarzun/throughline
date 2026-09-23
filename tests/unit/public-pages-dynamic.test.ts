import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Public pages must render per request, never from cached HTML.
 *
 * A nonce-based CSP and a cached page are incompatible. The middleware mints a
 * fresh nonce per request and sends it in the header; cached HTML carries
 * whatever nonce existed when it was generated, or none at all if it was
 * prerendered. The browser then blocks every script on the page.
 *
 * It shipped once and was nearly missed, because the failure is silent and
 * looks like a design choice: the server-rendered lists are intact and only
 * the canvas is blank. The e2e hydration test catches it, but ONLY against a
 * production build -- CI runs e2e against `pnpm dev`, where nothing is
 * statically cached and `revalidate` does nothing. Verified by reintroducing
 * the bug: the browser test still passed.
 *
 * So this asserts it at the source, where mode does not matter. Cache the
 * DATA with unstable_cache instead; the pages already do.
 */
const EXPLORE = 'src/app/explore';

function pagesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...pagesUnder(full));
    else if (entry === 'page.tsx') out.push(full);
  }
  return out;
}

describe('public explore pages', () => {
  const pages = pagesUnder(EXPLORE);

  it('finds the pages it is meant to be guarding', () => {
    // Without this the suite would pass by checking nothing if the directory
    // moved -- the exact failure mode it exists to prevent.
    expect(pages.length).toBeGreaterThan(0);
  });

  it.each(pages)('%s renders per request', (page) => {
    const src = readFileSync(page, 'utf8');
    expect(src, `${page} must declare force-dynamic`).toMatch(
      /export const dynamic = 'force-dynamic'/,
    );
    expect(src, `${page} must not cache its HTML with revalidate`).not.toMatch(
      /export const revalidate/,
    );
  });
});
