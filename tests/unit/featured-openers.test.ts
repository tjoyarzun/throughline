import { describe, it, expect } from 'vitest';
import { mergeFeatured, type FeaturedNode } from '@/server/repos/universe';

/**
 * The public landing's front door.
 *
 * Ranking entry points by degree alone put a long-running anime on the front page in
 * production and a 1984 road movie locally -- both accidents of arithmetic,
 * because degree ranks anthology casts and studios above anything you would
 * choose to open on. The fix is a curated list with the degree query behind
 * it, and these are the rules that fix depends on.
 */
const node = (type: string, id: string, degree = 100): FeaturedNode => ({
  type,
  id,
  slug: `${type}-${id}`,
  label: `${type} ${id}`,
  degree,
});

describe('mergeFeatured', () => {
  it('puts curated entries first, in their declared order', () => {
    const out = mergeFeatured(
      [node('person', 'nolan'), node('title', 'godfather')],
      [node('title', 'anthology', 400)],
      8,
    );
    expect(out.map((n) => n.id)).toEqual(['nolan', 'godfather', 'anthology']);
  });

  it('fills from the ranked query when curation runs short', () => {
    const out = mergeFeatured(
      [node('person', 'nolan')],
      [node('title', 'a'), node('title', 'b')],
      3,
    );
    expect(out).toHaveLength(3);
  });

  it('skips a curated entry that did not resolve rather than leaving a hole', () => {
    // A slug that resolves nowhere simply is not in the resolved rows. The
    // page must still open, on the next entry -- curation that failed closed
    // would be worse than no curation.
    const out = mergeFeatured([node('title', 'godfather')], [node('title', 'a')], 8);
    expect(out.map((n) => n.id)).toEqual(['godfather', 'a']);
  });

  it('never repeats a node that appears in both halves', () => {
    const dup = node('person', 'nolan');
    const out = mergeFeatured([dup], [dup, node('title', 'a')], 8);
    expect(out.map((n) => n.id)).toEqual(['nolan', 'a']);
  });

  it('honors the limit', () => {
    const out = mergeFeatured(
      [node('a', '1'), node('a', '2'), node('a', '3')],
      [node('b', '1'), node('b', '2')],
      2,
    );
    expect(out.map((n) => `${n.type}:${n.id}`)).toEqual(['a:1', 'a:2']);
  });
});
