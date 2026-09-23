import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { graphEngine } from '@/lib/graph/postgres-engine';
import { nodeImageUrl } from '@/lib/tmdb-image';
import { ConstellationCanvas } from '@/components/graph/constellation-canvas';
import type { GraphNode, NeighborGroup } from '@/lib/graph/types';

/**
 * The public ontology surface.
 *
 * No session, no account, nothing from usr -- this reads sem only. It is the
 * one deep part of the app a stranger can reach from a link, which makes it
 * the surface that has to carry the thesis on its own: that the ontology is
 * load-bearing rather than decorative.
 *
 * Everything meaningful is SERVER-RENDERED. The constellation is a progressive
 * enhancement over a real list of relationships, not a replacement for one --
 * a crawler, a screen reader and a browser with JavaScript off all get the
 * same facts, and the canvas is what happens when a machine can afford it.
 * That ordering is also AC-36: the list IS the accessible equivalent, so it
 * cannot rot, because it is the thing being enhanced.
 */

export const revalidate = 3600;

const TYPES = new Set(['title', 'person', 'concept', 'collection', 'organization', 'work']);

/** Kept in sync with the graph palette in src/lib/design/tokens.ts. */
const TYPE_LABEL: Record<string, string> = {
  title: 'Title',
  person: 'Person',
  concept: 'Concept',
  collection: 'Collection',
  organization: 'Organization',
  work: 'Work',
  character: 'Character',
};

async function load(type: string, slug: string) {
  if (!TYPES.has(type)) return null;
  const node = await graphEngine.nodeBySlug(type, slug);
  if (!node) return null;
  // Twelve per group: enough that a constellation has shape, few enough that a
  // person with 400 credits does not render 400 nodes on a public page.
  const [groups, neighborhood] = await Promise.all([
    graphEngine.neighbors({ type: node.type, id: node.id }, { perGroup: 12 }),
    // Two hops, for the canvas only. The lists render the one-hop grouping,
    // which is what this page is ABOUT; the drawing needs structure the second
    // ring provides.
    graphEngine.neighborhood({ type: node.type, id: node.id }),
  ]);
  return { node, groups, neighborhood };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string; slug: string }>;
}): Promise<Metadata> {
  const { type, slug } = await params;
  const data = await load(type, slug);
  if (!data) return { title: 'Not found' };

  const { node, groups } = data;
  const relationships = groups.reduce((n, g) => n + g.nodes.length + g.more, 0);
  return {
    // The root layout appends " · Throughline"; adding it here too produced
    // "Agnès Varda — Throughline · Throughline".
    title: node.label,
    description:
      `${node.label}${node.sublabel ? `, ${node.sublabel}` : ''}: ${relationships} ` +
      `connections across ${groups.length} kinds of relationship in the Throughline ontology.`,
    // Indexable, unlike share pages. A share is a personal message; this is a
    // reference page about a public fact and is meant to be found.
    robots: { index: true, follow: true },
  };
}

export default async function ExploreNodePage({
  params,
}: {
  params: Promise<{ type: string; slug: string }>;
}) {
  const { type, slug } = await params;
  const data = await load(type, slug);
  if (!data) notFound();
  const { node, groups, neighborhood } = data;

  const total = groups.reduce((n, g) => n + g.nodes.length + g.more, 0);

  return (
    <article className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-8">
      <header className="flex items-start gap-4">
        {node.imagePath && (
          <span
            className="block w-20 shrink-0 overflow-hidden rounded-lg"
            style={{
              aspectRatio: node.type === 'person' ? '1 / 1' : '2 / 3',
              background: 'var(--tl-surface-2)',
              boxShadow: 'inset 0 0 0 1px var(--tl-poster-inset)',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={nodeImageUrl(node.type, node.imagePath, 160) ?? ''}
              alt=""
              className="h-full w-full object-cover"
            />
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <span
            className="text-[10px] uppercase tracking-widest"
            style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
          >
            {TYPE_LABEL[node.type] ?? node.type}
          </span>
          <h1 className="text-3xl leading-tight">{node.label}</h1>
          {node.sublabel && (
            <p className="text-sm" style={{ color: 'var(--tl-text-dim)' }}>
              {node.sublabel}
            </p>
          )}
          <p
            className="text-xs tabular-nums"
            style={{ color: 'var(--tl-text-faint)', fontFamily: 'var(--font-mono)' }}
          >
            {total} connections · {groups.length}{' '}
            {groups.length === 1 ? 'relationship' : 'relationships'}
          </p>
        </div>
      </header>

      {/* The canvas mounts over this region on capable clients. It is given the
          same data the lists below render, so the two can never disagree. */}
      {neighborhood && (
        <ConstellationCanvas center={node} nodes={neighborhood.nodes} edges={neighborhood.edges} />
      )}

      <div className="flex flex-col gap-7">
        {groups.map((group) => (
          <Group key={group.predicate} group={group} />
        ))}
      </div>

      <footer
        className="flex flex-col gap-2 border-t pt-4 text-xs"
        style={{ borderColor: 'var(--tl-border)', color: 'var(--tl-text-faint)' }}
      >
        <p>
          Every link on this page is a typed relationship declared in{' '}
          <span style={{ fontFamily: 'var(--font-mono)' }}>ontology.yaml</span> and enforced by the
          database, not a guess.
        </p>
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
      </footer>
    </article>
  );
}

function Group({ group }: { group: NeighborGroup }) {
  return (
    <section className="flex flex-col gap-3">
      <h2
        className="text-xs uppercase tracking-widest"
        style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
      >
        {group.label}
        {group.more > 0 && (
          <span style={{ color: 'var(--tl-text-faint)' }}> · {group.more} more</span>
        )}
      </h2>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 md:grid-cols-4">
        {group.nodes.map((n) => (
          <li key={`${n.type}-${n.id}`}>
            <NodeLink node={n} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function NodeLink({ node }: { node: GraphNode }) {
  return (
    <Link href={`/explore/${node.type}/${node.slug}`} className="flex items-center gap-2">
      <span
        className="block size-9 shrink-0 overflow-hidden rounded-full"
        style={{ background: 'var(--tl-surface-2)' }}
      >
        {node.imagePath && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={nodeImageUrl(node.type, node.imagePath, 80) ?? ''}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm leading-tight">{node.label}</span>
        {node.sublabel && (
          <span className="truncate text-[11px]" style={{ color: 'var(--tl-text-dim)' }}>
            {node.sublabel}
          </span>
        )}
      </span>
    </Link>
  );
}
