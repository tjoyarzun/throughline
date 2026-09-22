import { describe, it, expect } from 'vitest';
import { HANDLERS } from '@/server/jobs/handlers';
import { MAX_AGE_S } from '@/server/repos/health';

/**
 * The freshness map is only a check for kinds that actually exist.
 *
 * Two of its four original entries named nothing -- `drain`, which is the
 * endpoint that runs jobs rather than a job, and `tmdb_changes`, which was
 * never built. Neither could ever match a row, so neither could ever report
 * stale, and the map read as though it covered four things while covering
 * two. That is the same defect this codebase keeps finding in a new place:
 * a guard that is never evaluated looks exactly like a guard that passes.
 */
describe('cron freshness map', () => {
  it('names only real job kinds', () => {
    const handlers = Object.keys(HANDLERS);
    for (const kind of Object.keys(MAX_AGE_S)) {
      expect(handlers, `MAX_AGE_S has '${kind}', which no handler produces`).toContain(kind);
    }
  });

  it('watches every job kind, so a new one cannot be added unmonitored', () => {
    for (const kind of Object.keys(HANDLERS)) {
      expect(
        MAX_AGE_S[kind],
        `job kind '${kind}' has no staleness bound — if it stops running, nothing notices`,
      ).toBeGreaterThan(0);
    }
  });
});
