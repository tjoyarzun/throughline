/**
 * The curated front doors of the public /explore surface.
 *
 * Why these nodes, and in this order, is explained where they are resolved:
 * featuredNodes() in src/server/repos/universe.ts. They live here, with no
 * imports, because middleware needs them too -- signed-out visitors may open
 * exactly these node pages and the landing, and nothing deeper (see
 * exploreNeedsSession in route-access.ts).
 */
export const EXPLORE_OPENERS: readonly { type: string; slug: string }[] = [
  { type: 'person', slug: 'christopher-nolan-525' },
  { type: 'title', slug: '2001-a-space-odyssey-1968' },
  { type: 'title', slug: 'the-godfather-1972' },
  { type: 'person', slug: 'denis-villeneuve-137427' },
  { type: 'title', slug: 'blade-runner-2049-2017' },
  { type: 'title', slug: 'star-wars-1977' },
  { type: 'title', slug: 'the-matrix-1999' },
  { type: 'title', slug: 'the-odyssey-2026' },
  { type: 'title', slug: 'jaws-1975' },
];
