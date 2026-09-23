import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import manifest from '@/app/manifest';

/**
 * Icons, asserted rather than previewed.
 *
 * The manifest used to list two PNGs four times -- the same file under both
 * `any` and `maskable` -- with a comment explaining why they were separate.
 * The comment described an intent the code did not implement, and the result
 * was wrong in both directions at once. That class of defect is invisible in
 * a preview and obvious in a test.
 */
const icons = manifest().icons ?? [];
const file = (src: string) => join(process.cwd(), 'public', src.replace(/^\//, ''));

describe('web app manifest icons', () => {
  it('ships both purposes', () => {
    expect(icons.some((i) => i.purpose === 'any')).toBe(true);
    expect(icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it('never serves one file as both any and maskable', () => {
    const any = new Set(icons.filter((i) => i.purpose === 'any').map((i) => i.src));
    const maskable = icons.filter((i) => i.purpose === 'maskable').map((i) => i.src);
    for (const src of maskable) {
      expect(any.has(src), `${src} is declared as both purposes`).toBe(false);
    }
  });

  it('points at files that exist', () => {
    expect(icons.length).toBeGreaterThan(0);
    for (const i of icons) expect(existsSync(file(i.src)), i.src).toBe(true);
  });

  it('covers the sizes a launcher and an install prompt ask for', () => {
    for (const purpose of ['any', 'maskable'] as const) {
      const sizes = icons.filter((i) => i.purpose === purpose).map((i) => i.sizes);
      expect(sizes, purpose).toContain('192x192');
      expect(sizes, purpose).toContain('512x512');
    }
  });
});
