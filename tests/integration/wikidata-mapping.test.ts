import { describe, it, expect } from 'vitest';
import {
  WORK_KIND_BY_QID,
  SCREEN_WORK_QIDS,
  FRANCHISE_SERIES_QIDS,
  qid,
} from '@/server/providers/wikidata/client';

/**
 * Guards on the Wikidata mapping tables. These are pure data, but two live-run
 * defects came out of them and both were the same shape: a permissive fallback
 * turning "we do not know" into a confident wrong assertion.
 */
describe('Wikidata source-type mapping', () => {
  it('never maps a screen work to a core.work kind', () => {
    // "The Office is based on the book The Office" — the source is the UK
    // television series. A screen work is a title-to-title relationship.
    for (const q of SCREEN_WORK_QIDS) {
      expect(
        WORK_KIND_BY_QID[q],
        `${q} is a screen work and must not be a work kind`,
      ).toBeUndefined();
    }
  });

  it('maps only to kinds core.work actually accepts', () => {
    const allowed = ['book', 'comic', 'play', 'game', 'article', 'true_events', 'short_story'];
    for (const [q, kind] of Object.entries(WORK_KIND_BY_QID)) {
      expect(allowed, `${q} -> ${kind}`).toContain(kind);
    }
  });

  it('types manga as comic, not book', () => {
    // Jujutsu Kaisen and Naruto came through as "book" under the old default.
    expect(WORK_KIND_BY_QID.Q8274).toBe('comic'); // manga
    expect(WORK_KIND_BY_QID.Q21198342).toBe('comic'); // manga series
  });

  it('keeps the franchise and screen-work sets disjoint from work kinds', () => {
    // A film series is a franchise, never an adaptation source.
    for (const q of FRANCHISE_SERIES_QIDS) {
      if (SCREEN_WORK_QIDS.has(q)) expect(WORK_KIND_BY_QID[q]).toBeUndefined();
    }
  });

  it('extracts QIDs from entity URIs', () => {
    expect(qid('http://www.wikidata.org/entity/Q42')).toBe('Q42');
    expect(qid(undefined)).toBeNull();
  });

  it('restricts franchise membership to actual series types', () => {
    // P179 is used loosely on Wikidata — No Country for Old Men came back as
    // part of "BBC's 100 Greatest Films of the 21st Century", a LIST. Accepting
    // that would put editorial listicles into the franchise graph.
    expect(FRANCHISE_SERIES_QIDS.has('Q24856')).toBe(true); // film series
    expect(FRANCHISE_SERIES_QIDS.has('Q196600')).toBe(true); // media franchise
    expect(FRANCHISE_SERIES_QIDS.has('Q13406463')).toBe(false); // Wikimedia list article
    expect(FRANCHISE_SERIES_QIDS.has('Q1002697')).toBe(false); // periodical
  });
});
