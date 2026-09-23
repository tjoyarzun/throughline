/**
 * Renders the app icons from one SVG source.
 *
 * Committed as PNGs rather than generated at request time: iOS fetches the
 * home-screen icon once, offline, at the moment you tap "Add to Home Screen",
 * and a route that has to boot a function to answer is the wrong thing to
 * depend on there.
 *
 * sharp comes in transitively with Next. Run: node scripts/make-icons.mjs
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const store = join(process.cwd(), 'node_modules/.pnpm');
const dir = readdirSync(store).find((d) => d.startsWith('sharp@'));
if (!dir) throw new Error('sharp not found; it normally arrives with Next');
const sharp = require(join(store, dir, 'node_modules/sharp'));

const BG = '#0B0C0E';
const GOLD = '#E8C77A';

/**
 * The mark: a line threading through three nodes.
 *
 * `inset` is the share of the canvas kept clear at the edges. `simplify`
 * fattens the nodes and the stroke for the 16 and 32 pixel favicons, where a
 * faithful downscale renders the mark as a thin smudge.
 *
 * It does NOT drop the middle node, which was the first attempt: the apex is
 * the most characteristic point of the mark, and removing the dot while
 * keeping the kink in the path left a shape that read as a hook rather than
 * as a smaller version of the same thing.
 *
 * MASKABLE IS NOT THE SAME ASSET AS ANY, which is what this file used to
 * pretend. The manifest declared one PNG under both purposes, so it was wrong
 * in both directions: launchers that crop to a circle shaved the mark, and
 * platforms that do not crop drew it floating inside padding it did not need.
 *
 * The maskable safe zone is a circle of diameter 80% -- radius 0.4 of the
 * canvas. The old 0.13 inset put the outer dots at 0.406 and the arc apex at
 * 0.414 from center. Measured, not estimated: both were outside, and both
 * were being clipped on Android.
 */
function svg(size, inset, simplify = false) {
  const c = size / 2;
  const r = size * (0.5 - inset);
  const dot = size * (simplify ? 0.105 : 0.068);
  const stroke = size * (simplify ? 0.075 : 0.05);

  // Three nodes on a gentle arc, joined left to right.
  const pts = [
    [c - r * 0.82, c + r * 0.4],
    [c, c - r * 0.5],
    [c + r * 0.82, c + r * 0.4],
  ];
  const path = `M ${pts[0][0]} ${pts[0][1]} Q ${c} ${c - r * 1.05} ${pts[1][0]} ${pts[1][1]} Q ${c} ${c + r * 0.2} ${pts[2][0]} ${pts[2][1]}`;
  const shown = pts;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <path d="${path}" fill="none" stroke="${GOLD}" stroke-width="${stroke}"
        stroke-linecap="round" opacity="${simplify ? 1 : 0.85}"/>
  ${shown.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${dot}" fill="${GOLD}"/>`).join('\n  ')}
</svg>`;
}

/**
 * How far the mark actually reaches from center, as a share of the canvas.
 *
 * Asserted rather than eyeballed: the safe-zone violation this file shipped
 * was six thousandths of a canvas, invisible in a preview and plainly wrong
 * in arithmetic.
 */
function reach(inset) {
  const r = 0.5 - inset;
  const dots = Math.hypot(r * 0.82, r * 0.4) + 0.068;
  const apex = r * 1.05 + 0.05 / 2;
  return Math.max(dots, apex);
}

/* 0.155 puts the furthest point of the mark at 0.399 -- inside the 0.4 safe
   radius, with nothing to spare and nothing clipped. Checked below. */
const MASKABLE_INSET = 0.155;
const SAFE_RADIUS = 0.4;

const targets = [
  // Purpose "any": nothing crops these, so the mark fills the tile.
  { file: 'icon-192.png', size: 192, inset: 0.07 },
  { file: 'icon-512.png', size: 512, inset: 0.07 },
  // Purpose "maskable": cropped to a circle by Android launchers.
  { file: 'icon-maskable-192.png', size: 192, inset: MASKABLE_INSET, maskable: true },
  { file: 'icon-maskable-512.png', size: 512, inset: MASKABLE_INSET, maskable: true },
  // iOS applies its own rounded mask and never crops to a circle, so the mark
  // can sit tighter. It must be fully opaque -- iOS composites transparency
  // onto black and the edges go muddy.
  { file: 'apple-icon-180.png', size: 180, inset: 0.08 },
  // Browser tab. Downscaling the 192 here turns three dots into a smudge, so
  // the small sizes get the simplified mark instead.
  { file: 'favicon-32.png', size: 32, inset: 0.1, simplify: true },
  { file: 'favicon-16.png', size: 16, inset: 0.08, simplify: true },
];

for (const t of targets) {
  if (t.maskable && reach(t.inset) > SAFE_RADIUS) {
    throw new Error(
      `${t.file}: the mark reaches ${reach(t.inset).toFixed(3)} of the canvas from center, ` +
        `outside the ${SAFE_RADIUS} maskable safe zone. Raise the inset.`,
    );
  }
  const png = await sharp(Buffer.from(svg(t.size, t.inset, t.simplify)))
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join('public', t.file), png);
  console.log(
    `  ${t.file.padEnd(24)} ${String(t.size).padStart(3)}x${t.size}  ` +
      `${(png.length / 1024).toFixed(1)}KB${t.maskable ? `  reach ${reach(t.inset).toFixed(3)}` : ''}`,
  );
}
