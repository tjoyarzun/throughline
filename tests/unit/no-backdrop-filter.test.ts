import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No backdrop-filter on anything fixed.
 *
 * A fixed element with a backdrop-filter promotes the page behind it to a
 * composited layer so it can be sampled. On real iOS that layer is rasterized
 * at reduced resolution and scaled back up, and the symptom is smeared text
 * somewhere else entirely on the page -- reported here as "top of screen
 * blur" from a home-screen install, with the bottom nav as the cause.
 *
 * It does NOT reproduce in Playwright's WebKit, at any scale factor, which is
 * why this is a source check rather than a browser one. A device GPU behavior
 * cannot be asserted from a test runner; the property that CAN be asserted is
 * that nobody reaches for the thing that caused it.
 *
 * If a translucent bar is ever genuinely wanted, the honest way is an opaque
 * gradient rather than sampling what is underneath.
 */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(tsx?|css)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('compositing', () => {
  const files = sources('src');

  it('finds the sources it is meant to be guarding', () => {
    // Without this the suite passes by checking nothing if src moves.
    expect(files.length).toBeGreaterThan(20);
  });

  it('uses no backdrop-filter anywhere', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const body = readFileSync(f, 'utf8');
      // Tailwind's utility and the raw property. Comments explaining why it is
      // absent are allowed; a line that applies it is not.
      for (const [i, line] of body.split('\n').entries()) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        if (/\bbackdrop-blur\b|backdropFilter\s*:|backdrop-filter\s*:/.test(line)) {
          offenders.push(`${f}:${i + 1} ${line.trim()}`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
