import Link from 'next/link';
import type { GraphPath, GraphNode } from '@/lib/graph/types';
import { nodeImageUrl } from '@/lib/tmdb-image';

/**
 * A path rendered as a VERTICAL CHAIN, not a graph.
 *
 * This is the thing people screenshot, so it has to read as a sentence and
 * survive being scrolled with a thumb. A force-directed rendering of the same
 * four nodes would be prettier and would answer nothing.
 */
/**
 * How strong a connection is, as a word rather than a number.
 *
 * The raw ranking cost used to be printed here -- "cost 5.9" -- which is an
 * implementation detail wearing a label that reads like a price. The number is
 * also not comparable across paths of different lengths, because cost is a SUM
 * over hops: a three-step path always outscores a two-step one even when every
 * link is stronger.
 *
 * So this divides by length and buckets the result. The thresholds are
 * measured, not invented -- over real pairs in the corpus:
 *
 *   2.8 - 3.0   a shared director        strong
 *   3.8         a shared lead actor      strong
 *   6.1 - 6.3   a similar_to chain       moderate
 *   8.2         a shared theme           faint
 *   9.5         long paths through hubs  faint
 *
 * Which is the ranking's own opinion made legible: sharing a director is a
 * real claim, sharing a theme is a thin one, and the badge should say so.
 */
const STRENGTH = [
  { max: 5, label: 'Strong', hint: 'a direct, specific relationship' },
  { max: 8, label: 'Moderate', hint: 'a real link, through more crowded ground' },
  { max: Infinity, label: 'Faint', hint: 'connected, but only loosely' },
] as const;

export function pathStrength(cost: number, steps: number) {
  const perHop = steps > 0 ? cost / steps : cost;
  return STRENGTH.find((s) => perHop < s.max)!;
}

export function PathChain({ path, index }: { path: GraphPath; index: number }) {
  const nodes = [path.from, ...path.steps.map((s) => s.node)];
  const strength = pathStrength(path.cost, path.steps.length);
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
          className="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider"
          style={{
            border: '1px solid var(--tl-border-strong)',
            color: 'var(--tl-text-dim)',
            fontFamily: 'var(--font-mono)',
          }}
          // The exact score stays reachable for anyone who wants it, without
          // putting a float on a consumer surface.
          title={strength.hint}
          data-cost={path.cost.toFixed(2)}
        >
          {strength.label}
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
  const img = nodeImageUrl(node.type, node.imagePath, 92);

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
