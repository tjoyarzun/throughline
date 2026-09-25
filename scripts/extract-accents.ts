import postgres from 'postgres';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { targetDatabase } from './lib/target-db';
import { bar } from './lib/progress';
import { mapPool } from '../src/lib/pool';
import { accentFromPixels, clampForDark, toHex, type Rgb } from '../src/lib/color/accent';

/**
 * Fill core.title.accent_color from the poster.
 *
 * The column has existed since the first migration and NOTHING has ever
 * written to it: 4,978 titles, 4,978 nulls. Three surfaces read it -- the
 * title page tints its backdrop gradient with it, the share page does the
 * same, and the unfurl card uses it behind the poster -- and all three have
 * silently fallen back to the same gold since the day they were built. Every
 * title has looked identical, and the code comments say otherwise.
 *
 * Run locally, not at ingest. Decoding an image costs ~8ms, which is nothing
 * in a batch and is not something to put in the path of somebody opening a
 * title page. Resumable by construction: it selects only rows where
 * accent_color IS NULL.
 *
 *   pnpm extract:accents                      # whatever .env.local names
 *   pnpm extract:accents --url '<neon>'       # somewhere else, unambiguously
 *   ... --limit 200                           # try it small first
 */

/* sharp arrives transitively with Next and is not a declared dependency, so
   it is resolved out of the store the way scripts/make-icons.mjs does. That
   is fine HERE -- this is a local script -- and is exactly why the extraction
   does not live in the app. */
const require_ = createRequire(import.meta.url);
const store = join(process.cwd(), 'node_modules/.pnpm');
const sharpDir = readdirSync(store).find((d) => d.startsWith('sharp@'));
if (!sharpDir) throw new Error('extract-accents: sharp not found; it normally arrives with Next');
const sharp = require_(join(store, sharpDir, 'node_modules/sharp')) as any;

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

const CAP = arg('limit', Number.POSITIVE_INFINITY);
const CONCURRENCY = arg('concurrency', 8);
const ROUND = 200;

const target = targetDatabase('extract-accents');
const sql = postgres(target.url, { max: 6, prepare: false, onnotice: () => {} });

/** w92 is plenty: the answer is a single color, and 3KB fetches fast. */
async function accentFor(posterPath: string): Promise<string | null> {
  const res = await fetch(`https://image.tmdb.org/t/p/w92${posterPath}`);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(buf)
    .resize(40, 40, { fit: 'inside' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels: Rgb[] = [];
  for (let i = 0; i < data.length; i += info.channels) {
    pixels.push({ r: data[i]!, g: data[i + 1]!, b: data[i + 2]! });
  }
  const raw = accentFromPixels(pixels);
  return raw ? toHex(clampForDark(raw)) : null;
}

try {
  const [before] = await sql<{ total: number; done: number }[]>`
    SELECT count(*)::int AS total,
           count(accent_color)::int AS done
    FROM core.title WHERE poster_path IS NOT NULL`;

  console.log(`database : ${target.label}   (from ${target.source})`);
  console.log(`posters  : ${before!.total} total, ${before!.done} already colored`);
  console.log(`remaining: ${before!.total - before!.done}\n`);

  let colored = 0;
  let noHue = 0;
  let errors = 0;
  /**
   * Every id this run has already tried.
   *
   * Without it the loop never ends. A poster with no hue is not written --
   * null is the right answer, and the surfaces fall back to gold -- so it
   * still matches `accent_color IS NULL` on the next round and is selected
   * again, forever. Against production that showed up as "41,400 this run"
   * over a corpus of 4,866, re-fetching the same few hundred images from TMDB
   * until somebody noticed. The writes were all fine; the loop was not.
   *
   * In memory rather than in a column: a sentinel would need a migration and
   * a value that means "checked, nothing there", and retrying a few hundred
   * images on the next run is cheaper than owning that forever.
   */
  const tried = new Set<string>();

  for (;;) {
    if (tried.size >= CAP) break;
    const rows = await sql<{ id: string; poster_path: string }[]>`
      SELECT id, poster_path FROM core.title
      WHERE poster_path IS NOT NULL AND accent_color IS NULL
        ${tried.size > 0 ? sql`AND NOT (id = ANY(${[...tried]}::uuid[]))` : sql``}
      ORDER BY popularity DESC NULLS LAST
      LIMIT ${Math.min(ROUND, CAP - tried.size)}`;
    if (rows.length === 0) break;
    for (const r of rows) tried.add(r.id);

    await mapPool(rows, CONCURRENCY, async (r) => {
      try {
        const hex = await accentFor(r.poster_path);
        if (!hex) {
          /* A black-and-white poster genuinely has no accent. Leaving it null
             means the surfaces fall back to gold, which is the right answer.
             It is counted, not written, and `tried` keeps it out of the next
             round. */
          noHue++;
          return;
        }
        await sql`UPDATE core.title SET accent_color = ${hex} WHERE id = ${r.id}`;
        colored++;
      } catch (e) {
        /* An error is NOT the same as no hue, and reporting them together is
           how a mass failure would look like a corpus of monochrome posters.
           The first few are printed so a real problem is visible. */
        errors++;
        if (errors <= 5) console.warn(`\n  ${r.id}: ${e instanceof Error ? e.message : e}`);
      }
    });

    process.stdout.write(
      `\r${bar(before!.done + colored, before!.total)} ` +
        `${colored} colored · ${noHue} without a hue · ${errors} failed   `,
    );
  }

  const [after] = await sql<{ done: number; total: number }[]>`
    SELECT count(accent_color)::int AS done, count(*)::int AS total
    FROM core.title WHERE poster_path IS NOT NULL`;
  console.log(
    `\n\ndone. ${after!.done} of ${after!.total} colored` +
      `${noHue > 0 ? ` · ${noHue} posters carry no hue` : ''}` +
      `${errors > 0 ? ` · ${errors} FAILED — rerun to retry them` : ''}`,
  );
} finally {
  await sql.end();
}
