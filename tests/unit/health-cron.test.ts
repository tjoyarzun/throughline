import { describe, it, expect } from 'vitest';
import { HANDLERS } from '@/server/jobs/handlers';
import { MAX_AGE_S, ON_DEMAND_KINDS } from '@/server/repos/health';

/**
 * Every job kind is watched, and watched the right way.
 *
 * Two of the freshness map's four original entries named nothing -- `drain`,
 * which is the endpoint that runs jobs rather than a job, and `tmdb_changes`,
 * which was never built. Neither could match a row, so neither could report
 * stale, and the map read as covering four things while covering two.
 *
 * The opposite failure came later and was subtler: five kinds that nothing
 * schedules sat in a map whose bound was "roughly 2x its interval", for jobs
 * with no interval. Their age only ever climbed, so the endpoint was on its
 * way to permanently degraded for a system behaving correctly. A check that
 * is always red and a check that is never evaluated are the same bug wearing
 * different clothes.
 *
 * So there are two buckets now, and the rule is that a kind belongs to
 * exactly one of them.
 */
describe('job health coverage', () => {
  const handlers = Object.keys(HANDLERS);
  const onDemand: readonly string[] = ON_DEMAND_KINDS;

  it('names only real job kinds', () => {
    for (const kind of Object.keys(MAX_AGE_S)) {
      expect(handlers, `MAX_AGE_S has '${kind}', which no handler produces`).toContain(kind);
    }
    for (const kind of onDemand) {
      expect(handlers, `ON_DEMAND_KINDS has '${kind}', which no handler produces`).toContain(kind);
    }
  });

  it('watches every job kind, so a new one cannot be added unmonitored', () => {
    for (const kind of handlers) {
      const watched = MAX_AGE_S[kind] !== undefined || onDemand.includes(kind);
      expect(
        watched,
        `job kind '${kind}' is in neither bucket — decide whether a clock or a ` +
          `queue is the right thing to hold it to, and say so`,
      ).toBe(true);
    }
  });

  it('puts each kind in exactly one bucket', () => {
    // Both would mean a job judged on elapsed time AND on undone work, which
    // is the permanently-red behavior this split exists to remove.
    for (const kind of onDemand) {
      expect(
        MAX_AGE_S[kind],
        `'${kind}' is on-demand but also has a staleness bound; it will go red on its own`,
      ).toBeUndefined();
    }
  });

  it('keeps a clock only on the jobs something actually schedules', () => {
    // Four crons in vercel.json drive these; hydrate_people self-chains until
    // its backlog empties. Anything else here is a claim that something runs
    // on a timer, and that claim has to be true.
    expect(Object.keys(MAX_AGE_S).sort()).toEqual(
      [
        'hydrate_people',
        'housekeeping',
        'refresh_availability',
        'refresh_degree',
        'refresh_stale',
      ].sort(),
    );
  });
});
