import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * The loading skeleton has to describe the page that arrives.
 *
 * It shipped stale once: the hub stopped being three nav cards over an
 * expanded ontology panel, and this file kept promising that layout anyway.
 * Every visit showed one shape and snapped to another -- layout shift dressed
 * up as a loading state, which is worse than no skeleton at all, because a
 * skeleton is a promise about dimensions.
 *
 * Asserted against SOURCE rather than against a rendered page, because the
 * fallback is only on screen while a payload streams and is therefore the one
 * state a browser test cannot reliably catch. These checks are coarse on
 * purpose: they pin the things that drift silently -- the canvas geometry and
 * the column counts -- not the exact markup.
 */
const SKELETON = readFileSync('src/app/(app)/universe/loading.tsx', 'utf8');
const PAGE = readFileSync('src/app/(app)/universe/page.tsx', 'utf8');
const CANVAS = readFileSync('src/components/graph/constellation-canvas.tsx', 'utf8');
const GROUPS = readFileSync('src/components/graph/neighbor-groups.tsx', 'utf8');

describe('universe loading skeleton', () => {
  it('reserves the canvas at the geometry the canvas actually uses', () => {
    // Two numbers that must move together. If they ever disagree the page
    // jumps by the difference on every visit.
    for (const token of ["aspectRatio: '1 / 1'", 'min(78vh, 620px)']) {
      expect(CANVAS, `constellation-canvas lost ${token}`).toContain(token);
      expect(SKELETON, `loading.tsx lost ${token}`).toContain(token);
    }
  });

  it('uses the same column counts as the neighbor lists', () => {
    const cols = 'grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 md:grid-cols-4';
    expect(GROUPS).toContain(cols);
    expect(SKELETON).toContain(cols);
  });

  it('uses the same card grid as the two nav cards', () => {
    const cols = 'grid-cols-1 gap-3 sm:grid-cols-2';
    expect(PAGE).toContain(cols);
    expect(SKELETON).toContain(cols);
  });

  it('does not still describe the layout that was replaced', () => {
    // The tell-tales of the stale version: THREE nav cards, and an OPEN
    // ontology panel whose stat row is a 4-column dl at the sm breakpoint.
    // (A row count is not a usable signal -- the new skeleton legitimately
    // draws eight neighbors per group.)
    expect(SKELETON, 'three nav cards is the old layout').not.toContain('[0, 1, 2]');
    expect(SKELETON, 'the ontology stat grid is the old layout').not.toContain('sm:grid-cols-4');
    expect(PAGE, 'the footer is collapsed; the skeleton reserves its closed height').toContain(
      '<details',
    );
  });
});
