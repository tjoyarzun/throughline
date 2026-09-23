/**
 * A progress bar that cannot kill the job it reports on.
 *
 * The obvious implementation crashed a completed 40-minute hydrate run: the
 * remaining count is read once at the start, the cron walk keeps hydrating
 * while the script works, so a long run legitimately processes MORE rows than
 * the opening query said were left. `done / total` went to 1.021, the repeat
 * count went to -1, and String.repeat threw -- after every row had already
 * landed. The data was safe and the summary line was lost.
 *
 * Reporting code is not allowed to be the thing that fails.
 */
const WIDTH = 24;

export function bar(done: number, total: number, width = WIDTH): string {
  const raw = total > 0 ? done / total : 1;
  const pct = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1;
  const filled = Math.round(pct * width);
  return `[${'#'.repeat(filled)}${'.'.repeat(width - filled)}] ${(pct * 100).toFixed(1)}%`;
}
