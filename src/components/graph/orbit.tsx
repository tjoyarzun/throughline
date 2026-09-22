import Link from 'next/link';
import type { GraphNode, NeighborGroup } from '@/lib/graph/types';
import { nodeImageUrl } from '@/lib/tmdb-image';

/**
 * Focus mode: a DETERMINISTIC orbit, not a force-directed graph.
 *
 * On a phone a force layout is a bad product. It is illegible below about 40
 * nodes of screen area, it fights the browser for pan and zoom, and it answers
 * no question. An orbit grouped and LABELED by predicate answers one directly:
 * here is this thing, and here is every kind of relationship it has.
 *
 * Rendered as plain SVG and links, so it is keyboard reachable, screen-reader
 * navigable, and costs nothing in the bundle.
 */
export function Orbit({
  center,
  groups,
  max = 32,
}: {
  center: GraphNode;
  groups: NeighborGroup[];
  max?: number;
}) {
  // Hard cap on what is drawn. A prolific person has hundreds of neighbors and
  // rendering them all produces a smear, not a picture. Accumulated with
  // reduce rather than a mutable counter: React's lint rule rejects
  // reassignment during render, and it is right to -- the budget is derived
  // from the groups, not state that outlives them.
  const shown = groups.reduce<{ remaining: number; out: NeighborGroup[] }>(
    (acc, g) => {
      const take = Math.max(0, Math.min(g.nodes.length, acc.remaining));
      return {
        remaining: acc.remaining - take,
        out: take > 0 ? [...acc.out, { ...g, nodes: g.nodes.slice(0, take) }] : acc.out,
      };
    },
    { remaining: max, out: [] },
  ).out;

  return (
    <div className="flex flex-col gap-6">
      <CenterCard node={center} />

      {shown.map((g) => (
        <section key={g.predicate} className="flex flex-col gap-2">
          <h3
            className="text-[10px] uppercase tracking-widest"
            style={{ color: 'var(--tl-accent)', fontFamily: 'var(--font-mono)' }}
          >
            {g.label}
            {g.more > 0 && <span style={{ color: 'var(--tl-text-dim)' }}> · +{g.more} more</span>}
          </h3>
          <ul className="flex gap-3 overflow-x-auto pb-1">
            {g.nodes.map((n) => (
              <li key={`${n.type}-${n.id}`} className="w-[84px] shrink-0">
                <Link
                  href={`/universe/explore?focus=${n.type}:${n.id}`}
                  className="flex flex-col gap-1.5"
                >
                  <Thumb node={n} />
                  <span className="line-clamp-2 text-xs leading-tight">{n.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CenterCard({ node }: { node: GraphNode }) {
  const href =
    node.type === 'title'
      ? `/title/${node.slug}`
      : node.type === 'person'
        ? `/person/${node.slug}`
        : null;
  return (
    <div
      className="flex items-center gap-4 rounded-xl border p-4"
      style={{ borderColor: 'var(--tl-accent)', background: 'var(--tl-surface)' }}
    >
      <span className="w-16 shrink-0">
        <Thumb node={node} />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-xl leading-tight">{node.label}</span>
        <span
          className="text-[10px] uppercase tracking-wide"
          style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          {node.type}
          {node.sublabel ? ` · ${node.sublabel}` : ''} · degree {node.degree}
        </span>
        {href && (
          <Link
            href={href}
            className="text-xs underline-offset-4 hover:underline"
            style={{ color: 'var(--tl-text-dim)' }}
          >
            Open detail →
          </Link>
        )}
      </div>
    </div>
  );
}

function Thumb({ node }: { node: GraphNode }) {
  const img = nodeImageUrl(node.type, node.imagePath, 92);
  return (
    <span
      className="relative block aspect-[2/3] w-full overflow-hidden"
      style={{
        borderRadius: 'var(--radius-poster)',
        background: 'var(--tl-surface-2)',
        boxShadow: 'inset 0 0 0 1px var(--tl-poster-inset)',
      }}
    >
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN; docs/adr/0012
        <img src={img} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <span
          aria-hidden
          className="absolute inset-0 grid place-items-center px-1 text-center text-[9px] leading-tight"
          style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          {node.type}
        </span>
      )}
    </span>
  );
}
