import type { Metadata } from 'next';
import Link from 'next/link';
import { graphEngine } from '@/lib/graph/postgres-engine';
import { ConstellationCanvas } from '@/components/graph/constellation-canvas';
import { unstable_cache } from 'next/cache';
import { ontologyStats, featuredNodes } from '@/server/repos/universe';

/**
 * Where a stranger lands.
 *
 * No session, no explanation asked of them, and no empty state: the page
 * opens ON a real neighborhood rather than on a menu about neighborhoods.
 * Somebody arriving from a link has about one screen of patience, and a hub
 * page listing entity types spends it explaining instead of showing.
 *
 * The technical register is deliberate. This is the surface a reviewer
 * reaches, and the counts underneath are the claim being made: the ontology
 * is enforced, not decorative.
 */

/**
 * Dynamic, with the DATA cached rather than the HTML.
 *
 * A nonce-based CSP and cached HTML are incompatible: the middleware mints a
 * fresh nonce per request and sends it in the header, while a cached page
 * carries whatever nonce existed when it was generated -- or, when prerendered
 * before any request, none at all. The browser then blocks every script on the
 * page. It presented as a blank canvas with the lists intact, because the
 * server-rendered half is exactly the half that does not need JavaScript.
 *
 * So the page is rendered per request, and the expensive global queries are
 * wrapped in unstable_cache instead. Nothing user-scoped may ever go in there;
 * these read sem only.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Explore the ontology',
  description:
    'A knowledge graph of film and television: typed relationships between titles, ' +
    'people, concepts, studios and source works. Explore it without an account.',
  robots: { index: true, follow: true },
};

const cachedStats = unstable_cache(ontologyStats, ['explore-stats'], { revalidate: 3600 });
const cachedFeatured = unstable_cache(() => featuredNodes(8), ['explore-featured'], {
  revalidate: 3600,
});
const cachedNeighborhood = unstable_cache(
  (type: string, id: string) => graphEngine.neighborhood({ type, id }),
  ['explore-neighborhood'],
  { revalidate: 3600 },
);

export default async function ExploreLanding() {
  const [stats, featured] = await Promise.all([cachedStats(), cachedFeatured()]);
  // The best-connected title carries the opening view. Chosen from the data
  // rather than hardcoded, so it survives the corpus growing.
  const opener = featured[0];
  const neighborhood = opener ? await cachedNeighborhood(opener.type, opener.id) : null;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl leading-tight">Explore the ontology</h1>
        <p className="max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--tl-text-dim)' }}>
          Every line below is a typed relationship — a director, a writer, an adaptation, a theme —
          declared in one schema and enforced by the database. Not inferred from text, not a
          similarity score. Follow any node to see its own neighborhood.
        </p>
        <dl
          className="flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums"
          style={{ color: 'var(--tl-text-faint)', fontFamily: 'var(--font-mono)' }}
        >
          {[
            ['titles', stats.titles],
            ['people', stats.people],
            ['credits', stats.credits],
            ['relationships', stats.edges],
            ['concepts', stats.concepts],
            ['predicates', stats.predicates],
          ].map(([label, value]) => (
            <div key={label as string} className="flex gap-1.5">
              <dt>{label}</dt>
              <dd style={{ color: 'var(--tl-text-dim)' }}>
                {Number(value).toLocaleString('en-US')}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      {opener && neighborhood && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm">
            <Link
              href={`/explore/${opener.type}/${opener.slug}`}
              className="underline-offset-4 hover:underline"
            >
              {opener.label}
            </Link>
            <span style={{ color: 'var(--tl-text-dim)' }}>
              {' '}
              — {neighborhood.nodes.length} things, {neighborhood.edges.length} relationships
            </span>
          </h2>
          <ConstellationCanvas
            center={neighborhood.center}
            nodes={neighborhood.nodes}
            edges={neighborhood.edges}
          />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2
          className="text-xs uppercase tracking-widest"
          style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          Start somewhere else
        </h2>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {featured.slice(1).map((n) => (
            <li key={`${n.type}-${n.id}`}>
              <Link
                href={`/explore/${n.type}/${n.slug}`}
                className="flex min-h-11 flex-col justify-center rounded-lg border px-3 py-2"
                style={{ borderColor: 'var(--tl-border)', background: 'var(--tl-surface)' }}
              >
                <span className="truncate text-sm">{n.label}</span>
                <span
                  className="text-[10px] uppercase tracking-wider"
                  style={{ color: 'var(--tl-text-faint)', fontFamily: 'var(--font-mono)' }}
                >
                  {n.type} · {n.degree} links
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <footer
        className="flex flex-col gap-2 border-t pt-4 text-xs"
        style={{ borderColor: 'var(--tl-border)', color: 'var(--tl-text-faint)' }}
      >
        <p>
          Throughline is a private media tracker built on this graph.{' '}
          <Link href="/auth/signin" className="underline underline-offset-2">
            Sign in
          </Link>{' '}
          to see your own library inside it.
        </p>
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </footer>
    </main>
  );
}
