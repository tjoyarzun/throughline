/**
 * The color a poster is "about".
 *
 * NOT the dominant color. A movie poster is mostly dark — sharp's own
 * dominant-bin answer for Blade Runner 2049 is rgb(8,24,40), which is
 * near-black and says nothing. What the eye reads as a film's color is its
 * most chromatic region: the orange of the dust storm, the green of the
 * Matrix. So pixels are weighted by saturation, and the near-black and
 * near-white ones that dominate by count are discarded outright.
 *
 * Pure functions, separated from the image decoding, so the scoring can be
 * tested without a file or a binary dependency.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  const to = (v: number) => Math.round(Math.min(255, Math.max(0, (v + m) * 255)));
  return { r: to(r1), g: to(g1), b: to(b1) };
}

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/**
 * Pixels too dark, too pale or too gray to carry a hue.
 *
 * Posters are mostly these. Counting them is what makes a dominant-color
 * answer useless: the winner is always the letterbox black.
 */
function carriesHue(s: number, l: number): boolean {
  return s >= 0.18 && l >= 0.12 && l <= 0.88;
}

/**
 * Pick an accent from raw RGB pixels.
 *
 * Hue is bucketed at 15 degrees and each pixel contributes its saturation
 * rather than a vote, so a small, vivid area beats a large, washed one — the
 * way a poster actually reads. The winning bucket's own pixels are averaged
 * in HSL so the result is a real color from the image rather than the middle
 * of a bin.
 *
 * Returns null when nothing in the image carries a hue, which is a real
 * answer for a black-and-white poster and better than inventing one.
 */
export function accentFromPixels(pixels: Rgb[]): Rgb | null {
  const BUCKETS = 24; // 15 degrees each
  const weight = new Array<number>(BUCKETS).fill(0);
  const acc = Array.from({ length: BUCKETS }, () => ({ h: 0, s: 0, l: 0, n: 0 }));

  for (const px of pixels) {
    const { h, s, l } = rgbToHsl(px);
    if (!carriesHue(s, l)) continue;
    const b = Math.min(BUCKETS - 1, Math.floor((h / 360) * BUCKETS));
    weight[b]! += s;
    const a = acc[b]!;
    /* Hue is circular, so it is averaged as a vector; a mean of 359 and 1
       is 180 in plain arithmetic, which is the opposite color. */
    a.h += Math.cos((h * Math.PI) / 180);
    a.s += Math.sin((h * Math.PI) / 180);
    a.l += l;
    a.n += 1;
  }

  let best = -1;
  let bestW = 0;
  for (let i = 0; i < BUCKETS; i++) {
    if (weight[i]! > bestW) {
      bestW = weight[i]!;
      best = i;
    }
  }
  if (best === -1) return null;

  const a = acc[best]!;
  const hue = (Math.atan2(a.s / a.n, a.h / a.n) * 180) / Math.PI;
  return hslToRgb(hue, 0.62, a.l / a.n);
}

/**
 * Make it usable as a light on a near-black page.
 *
 * The extracted color is whatever the poster had; what the UI needs is
 * something that reads as a glow against #0B0C0E without becoming a pastel.
 * Saturation is floored so a washed-out poster still shows a hue, and
 * lightness is pinned to a narrow band so every title's accent sits at the
 * same visual weight — otherwise a bright poster shouts and a dark one
 * disappears, and the page looks inconsistent rather than personal.
 */
export function clampForDark(rgb: Rgb): Rgb {
  const { h, s, l } = rgbToHsl(rgb);
  return hslToRgb(h, Math.min(0.75, Math.max(0.45, s)), Math.min(0.62, Math.max(0.46, l)));
}
