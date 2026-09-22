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
 * `inset` is the share of the canvas kept clear at the edges. Maskable icons
 * are cropped to a circle by the launcher, so the mark has to live inside the
 * middle ~80% or Android shaves it.
 */
function svg(size, inset) {
  const c = size / 2;
  const r = size * (0.5 - inset);
  const dot = size * 0.068;
  // Three nodes on a gentle arc, joined left to right.
  const pts = [
    [c - r * 0.82, c + r * 0.4],
    [c, c - r * 0.5],
    [c + r * 0.82, c + r * 0.4],
  ];
  const path = `M ${pts[0][0]} ${pts[0][1]} Q ${c} ${c - r * 1.05} ${pts[1][0]} ${pts[1][1]} Q ${c} ${c + r * 0.2} ${pts[2][0]} ${pts[2][1]}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <path d="${path}" fill="none" stroke="${GOLD}" stroke-width="${size * 0.05}"
        stroke-linecap="round" opacity="0.85"/>
  ${pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${dot}" fill="${GOLD}"/>`).join('\n  ')}
</svg>`;
}

const targets = [
  // Maskable: generous inset so a circular crop keeps the whole mark.
  { file: 'icon-192.png', size: 192, inset: 0.13 },
  { file: 'icon-512.png', size: 512, inset: 0.13 },
  // iOS applies its own rounded mask and never crops to a circle, so the mark
  // can sit tighter. It must be fully opaque -- iOS composites transparency
  // onto black and the edges go muddy.
  { file: 'apple-icon-180.png', size: 180, inset: 0.08 },
];

for (const t of targets) {
  const png = await sharp(Buffer.from(svg(t.size, t.inset)))
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join('public', t.file), png);
  console.log(`  ${t.file.padEnd(20)} ${t.size}x${t.size}  ${(png.length / 1024).toFixed(1)}KB`);
}
