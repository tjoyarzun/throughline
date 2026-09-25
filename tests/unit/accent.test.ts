import { describe, it, expect } from 'vitest';
import {
  accentFromPixels,
  clampForDark,
  rgbToHsl,
  hslToRgb,
  toHex,
  type Rgb,
} from '@/lib/color/accent';

/**
 * The color a poster is "about" is not its dominant color.
 *
 * sharp's own dominant-bin answer is #080808 for Blade Runner 2049, The
 * Matrix, Arrival, The Grand Budapest Hotel and Mad Max: Fury Road alike --
 * five very differently-colored films, one identical near-black, because a
 * poster is mostly dark and the largest bin wins. Weighting by saturation is
 * what makes the answer say anything.
 */
const px = (r: number, g: number, b: number): Rgb => ({ r, g, b });
const many = (c: Rgb, n: number): Rgb[] => Array.from({ length: n }, () => c);

describe('rgb/hsl round trip', () => {
  it('survives a round trip within rounding', () => {
    for (const c of [px(191, 64, 44), px(44, 132, 190), px(210, 148, 61)]) {
      const { h, s, l } = rgbToHsl(c);
      const back = hslToRgb(h, s, l);
      for (const k of ['r', 'g', 'b'] as const) {
        expect(Math.abs(back[k] - c[k]), `${k} of ${toHex(c)}`).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('accentFromPixels', () => {
  it('ignores the near-black that dominates a poster by count', () => {
    // 900 black pixels against 100 orange ones. Counting says black; the eye
    // says orange, and so must this.
    const pixels = [...many(px(8, 8, 10), 900), ...many(px(200, 90, 40), 100)];
    const out = accentFromPixels(pixels)!;
    expect(out).not.toBeNull();
    const { h } = rgbToHsl(out);
    expect(h, 'orange, not black').toBeGreaterThan(10);
    expect(h).toBeLessThan(50);
  });

  it('weighs vividness against area rather than choosing one', () => {
    /**
     * The rule is sum-of-saturation, so BOTH count. An equal number of pale
     * and vivid pixels goes to the vivid one; five times as many pale ones
     * win instead, which is correct for a poster -- a large washed sky is a
     * film's color as much as a small bright logo is.
     *
     * The first version of this test asserted vividness always wins and
     * failed, because 600 pale pixels at s=0.24 genuinely outweigh 120 vivid
     * ones at s=0.76. Weighting by s squared was tried against five real
     * posters and changed none of them, so the simpler rule stands.
     */
    const pale = px(150, 170, 190);
    const vivid = px(220, 30, 30);

    const even = rgbToHsl(accentFromPixels([...many(pale, 200), ...many(vivid, 200)])!);
    expect(even.h < 20 || even.h > 340, `even split should go vivid, got ${even.h}`).toBe(true);

    const lopsided = rgbToHsl(accentFromPixels([...many(pale, 1000), ...many(vivid, 120)])!);
    expect(lopsided.h, 'a large washed area is also a color').toBeGreaterThan(180);
  });

  it('averages hue around the wrap point instead of through it', () => {
    // Reds at 359 and 1 degrees. Plain arithmetic gives 180 -- cyan, the
    // opposite color -- which is the classic circular-mean bug.
    const pixels = [...many(px(220, 30, 35), 200), ...many(px(220, 35, 30), 200)];
    const { h } = rgbToHsl(accentFromPixels(pixels)!);
    expect(h < 25 || h > 335, `got hue ${h}, expected red`).toBe(true);
  });

  it('returns null for an image with no hue, rather than inventing one', () => {
    // A black-and-white poster genuinely has no accent. Saying so beats
    // returning a gray that renders as a dead smear.
    expect(accentFromPixels(many(px(120, 120, 120), 500))).toBeNull();
    expect(accentFromPixels([])).toBeNull();
  });
});

describe('clampForDark', () => {
  it('lifts a color too dark to read against the page', () => {
    const { l } = rgbToHsl(clampForDark(px(20, 8, 4)));
    expect(l).toBeGreaterThanOrEqual(0.45);
  });

  it('pulls back a color too bright to sit under text', () => {
    const { l } = rgbToHsl(clampForDark(px(255, 240, 230)));
    expect(l).toBeLessThanOrEqual(0.63);
  });

  it('keeps every title at the same visual weight', () => {
    // The point of the clamp: a bright poster must not shout while a dark one
    // disappears, or the page looks inconsistent rather than personal.
    const ls = [px(20, 8, 4), px(255, 240, 230), px(120, 60, 200), px(0, 90, 40)].map(
      (c) => rgbToHsl(clampForDark(c)).l,
    );
    expect(Math.max(...ls) - Math.min(...ls), 'lightness spread').toBeLessThan(0.2);
  });

  it('never returns gray, so there is always a hue to show', () => {
    // The floor is 0.45; 8-bit rounding on the way back out costs about a
    // thousandth, which is why this is not asserted exactly.
    const { s } = rgbToHsl(clampForDark(px(130, 128, 126)));
    expect(s).toBeGreaterThan(0.44);
  });
});
