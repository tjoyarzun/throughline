import { describe, it, expect } from 'vitest';
import {
  USAGE_MATRIX,
  THRESHOLD,
  palettes,
  contrastRatio,
  graphPalette,
  dark,
  light,
} from '@/lib/design/tokens';

/** AC-31: every declared token usage meets its WCAG 2.2 AA threshold. */
describe('color contrast (WCAG 2.2 AA)', () => {
  for (const u of USAGE_MATRIX) {
    const fg = palettes[u.scheme][u.token]!;
    const bg = palettes[u.scheme][u.on]!;
    const required = THRESHOLD[u.kind];
    it(`${u.scheme}: ${u.token} on ${u.on} (${u.kind}) — ${u.where}`, () => {
      const ratio = contrastRatio(fg, bg);
      expect(
        ratio,
        `${u.scheme}.${u.token} (${fg}) on ${u.on} (${bg}) is ${ratio.toFixed(2)}:1, needs ${required}:1`,
      ).toBeGreaterThanOrEqual(required);
    });
  }

  it('graph node fills are visible against the dark ground', () => {
    // The dark canvas is the default. Fills must be plainly visible there.
    for (const [type, hex] of Object.entries(graphPalette)) {
      expect(contrastRatio(hex, dark.bg), `${type} fill on dark`).toBeGreaterThanOrEqual(3);
    }
  });

  it('graph node strokes carry the 1.4.11 burden, not the fills', () => {
    // On the light ground several fills are deliberately pale. That is fine:
    // perceivability comes from the borderStrong stroke every node carries, and
    // node type is conveyed by the text label, never by hue alone (1.4.1).
    expect(contrastRatio(light.borderStrong, light.bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(dark.borderStrong, dark.bg)).toBeGreaterThanOrEqual(3);
    for (const [type, hex] of Object.entries(graphPalette)) {
      expect(contrastRatio(hex, light.borderStrong), `${type} fill vs its stroke`).toBeGreaterThan(
        1,
      );
    }
  });

  it('known-bad pairings are still bad — the test itself is load-bearing', () => {
    // These two failed the first palette draft. If either ever passes 4.5:1 the
    // palette changed underneath us and the usage rules need rechecking.
    expect(contrastRatio(light.accent, light.bg)).toBeLessThan(4.5);
    expect(contrastRatio('#61666E', dark.bg)).toBeLessThan(4.5);
    // faint is decorative in both schemes and must never be promoted to text.
    expect(contrastRatio(dark.faint, dark.bg)).toBeLessThan(3);
    expect(contrastRatio(light.faint, light.bg)).toBeLessThan(3);
  });
});

describe('luminance math', () => {
  it('matches known WCAG reference values', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 1);
    expect(contrastRatio('#AAAAAA', '#AAAAAA')).toBeCloseTo(1, 5);
  });
});
