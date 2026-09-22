import Link from 'next/link';
import type { GraphPath, GraphNode } from '@/lib/graph/types';
import { posterUrl, profileUrl } from '@/lib/tmdb-image';

/**
 * A path rendered as a VERTICAL CHAIN, not a graph.
 *
 * This is the thing people screenshot, so it has to read as a sentence and
 * survive being scrolled with a thumb. A force-directed rendering of the same
 * four nodes would be prettier and would answer nothing.
 */
export function PathChain({ path, index }: { path: GraphPath; index: number }) {
  const nodes = [path.from, ...path.steps.map((s) => s.node)];
  return (
    <li
      className="flex flex-col gap-3 rounded-xl border p-4"
      style={{ borderColor: 'var(--tl-border)', background: 'var(--tl-surface)' }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span
          className="text-[10px] uppercase tracking-widest"
          style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          Path {index + 1} · {path.steps.length} steps
        </span>
        <span
          className="text-[10px] tabular-nums"
          style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          cost {path.cost.toFixed(1)}
        </span>
      </div>

      {/* The narration IS the accessible text for this module (AC-36). */}
      <p className="text-[15px] leading-relaxed">{path.narration}</p>

      <ol className="flex flex-col">
        {nodes.map((node, i) => (
          <li key={`${node.type}-${node.id}-${i}`} className="flex flex-col">
            {i > 0 && (
              <span className="flex items-center gap-2 py-1 pl-4">
                <span
                  aria-hidden
                  className="block w-px"
                  style={{ background: 'var(--tl-border-strong)', height: 20 }}
                />
                <span
                  className="text-[10px] uppercase tracking-wide"
                  style={{ color: 'var(--tl-accent)', fontFamily: 'var(--font-mono)' }}
                >
                  {path.steps[i - 1]!.predicateLabel}
                </span>
              </span>
            )}
            <NodeRow node={node} />
          </li>
        ))}
      </ol>
    </li>
  );
}

function NodeRow({ node }: { node: GraphNode }) {
  const href =
    node.type === 'title'
      ? `/title/${node.slug}`
      : node.type === 'person'
        ? `/person/${node.slug}`
        : `/universe/explore?focus=${node.type}:${node.id}`;
  const img =
    node.type === 'person' ? profileUrl(node.imagePath, 96) : posterUrl(node.imagePath, 92);

  return (
    <Link href={href} className="flex items-center gap-3 py-1">
      <span
        className="block h-11 w-8 shrink-0 overflow-hidden"
        style={{
          borderRadius: 'var(--radius-poster)',
          background: 'var(--tl-surface-2)',
          boxShadow: 'inset 0 0 0 1px var(--tl-poster-inset)',
        }}
      >
        {img && (
          // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN; docs/adr/0012
          <img src={img} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="line-clamp-1 text-sm">{node.label}</span>
        <span
          className="text-[10px] uppercase tracking-wide"
          style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          {node.type}
          {node.sublabel ? ` · ${node.sublabel}` : ''}
        </span>
      </span>
    </Link>
  );
}
