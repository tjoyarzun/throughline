import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { RELEASES } from '@/content/releases';

/**
 * Release notes that link somewhere that exists.
 *
 * "Take a look →" is the reason anybody reads a changelog: the point of being
 * told about a feature is to go and use it. A link to a 404 is worse than no
 * link — it makes the whole page look abandoned, which is the exact opposite
 * of what a what's-new page is for. Routes get renamed; this notices.
 */
const APP = join(process.cwd(), 'src/app');

function routeExists(href: string): boolean {
  const path = href.split('?')[0]!.replace(/\/$/, '');
  if (path === '') return existsSync(join(APP, '(app)/page.tsx'));
  // Both route groups, since a reader cannot tell them apart.
  return (
    existsSync(join(APP, '(app)', path, 'page.tsx')) || existsSync(join(APP, path, 'page.tsx'))
  );
}

describe('release notes', () => {
  it('has releases to show', () => {
    expect(RELEASES.length).toBeGreaterThan(0);
  });

  it('is ordered newest first', () => {
    const dates = RELEASES.map((r) => r.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('links only to routes that exist', () => {
    for (const r of RELEASES) {
      for (const item of r.items) {
        if (!item.href) continue;
        expect(routeExists(item.href), `${r.name}: "${item.title}" → ${item.href}`).toBe(true);
      }
    }
  });

  it('says something in every entry', () => {
    // A title with no body is a version number with extra steps.
    for (const r of RELEASES) {
      expect(r.items.length, r.name).toBeGreaterThan(0);
      for (const item of r.items) {
        expect(item.title.length, item.title).toBeGreaterThan(3);
        expect(item.body.length, item.title).toBeGreaterThan(30);
      }
    }
  });
});
