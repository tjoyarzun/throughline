'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { graphPalette } from '@/lib/design/tokens';
import type { GraphNode, NeighborGroup } from '@/lib/graph/types';

/**
 * A node and its neighborhood, drawn.
 *
 * Hand-rolled canvas rather than Sigma, and deliberately so. The spec names
 * Sigma for Constellation mode, where the job is a 600-node force-directed
 * view of the whole graph and WebGL earns its place. This is a different
 * problem: one node and its neighbors, in a STAR. A general force layout of a
 * star produces a ring and discards the only structure the data has.
 *
 * The first version WAS that ring, and it was worthless -- verified by
 * screenshotting it rather than assuming. Agnès Varda came out as a wheel of
 * identical blue dots with "The Gleaners and I" printed three times, because
 * she directed, wrote and appeared in it and each predicate drew its own copy.
 * Three fixes, all about carrying information rather than decoration:
 *
 *   ONE NODE PER THING. A film she directed and wrote is one dot with two
 *   edges, not two dots. That is also what the graph actually says.
 *
 *   EDGES CARRY THE PREDICATE, in color, with a legend. In a neighborhood
 *   where every neighbor is a title, node color says nothing and the
 *   relationship is the entire interest.
 *
 *   NODES SIT IN RINGS, ordered so that things sharing a relationship sit
 *   together. Depth instead of a flat wheel, and clusters you can read.
 */

interface Spoke {
  node: GraphNode;
  predicates: string[];
  angle: number;
  radius: number;
  x: number;
  y: number;
  r: number;
}

const FALLBACK = '#8B93A1';
/** Reused from the node palette: already tuned against both grounds. */
const EDGE_COLORS = Object.values(graphPalette);

function typeColor(type: string): string {
  return (graphPalette as Record<string, string>)[type] ?? FALLBACK;
}

/**
 * Radius from degree, log-scaled. Linear would make Drama, at 2,139
 * connections, a disc that swallows the canvas while a work with 8 vanishes.
 */
function radiusFor(degree: number): number {
  return 3.5 + Math.min(7, Math.log1p(Math.max(0, degree)) * 1.15);
}

/** One entry per distinct neighbor, carrying every relationship it is on. */
function collapse(groups: NeighborGroup[]) {
  const byNode = new Map<string, { node: GraphNode; predicates: string[] }>();
  for (const g of groups) {
    for (const n of g.nodes) {
      const key = `${n.type}:${n.id}`;
      const existing = byNode.get(key);
      if (existing) existing.predicates.push(g.predicate);
      else byNode.set(key, { node: n, predicates: [g.predicate] });
    }
  }
  const order = new Map(groups.map((g, i) => [g.predicate, i]));
  // Sorted by first relationship, so a sector of the circle is a relationship
  // and the clusters mean something.
  return [...byNode.values()].sort((a, b) => {
    const pa = order.get(a.predicates[0]!) ?? 99;
    const pb = order.get(b.predicates[0]!) ?? 99;
    return pa - pb || b.node.degree - a.node.degree;
  });
}

export function ConstellationCanvas({
  center,
  groups,
}: {
  center: GraphNode;
  groups: NeighborGroup[];
}) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const spokesRef = useRef<Spoke[]>([]);
  const [hover, setHover] = useState<Spoke | null>(null);
  const [lit, setLit] = useState<string | null>(null);

  const nodes = useMemo(() => collapse(groups), [groups]);
  const colorOf = useMemo(() => {
    const m = new Map<string, string>();
    groups.forEach((g, i) => m.set(g.predicate, EDGE_COLORS[i % EDGE_COLORS.length]!));
    return m;
  }, [groups]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--tl-text').trim() || '#ECEDEF';
    const dim = css.getPropertyValue('--tl-text-dim').trim() || '#9AA0A8';
    const accent = css.getPropertyValue('--tl-accent').trim() || '#E8C77A';

    let raf = 0;
    let start = 0;
    let stopped = false;

    function place(w: number, h: number): Spoke[] {
      const cx = w / 2;
      const cy = h / 2;
      const outer = Math.min(w, h) / 2 - 26;
      const inner = Math.min(w, h) * 0.2;
      // Three rings rather than one: a single radius is a wheel, and the gaps
      // are where labels get room to exist.
      const rings = nodes.length > 28 ? 3 : nodes.length > 12 ? 2 : 1;

      return nodes.map((entry, i) => {
        const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
        // Spread the rings across the full span instead of bunching them:
        // 0.45 / 0.72 / 1.0 of the way out reads as depth, where evenly
        // divided radii looked like one ring with jitter.
        const ring = rings === 1 ? 0 : i % rings;
        const step = rings === 1 ? 1 : 0.45 + (0.55 * ring) / (rings - 1);
        const radius = inner + (outer - inner) * step;
        return {
          node: entry.node,
          predicates: entry.predicates,
          angle,
          radius,
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
          r: radiusFor(entry.node.degree),
        };
      });
    }

    function draw(progress: number) {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const spokes = place(w, h);
      spokesRef.current = spokes;
      const cx = w / 2;
      const cy = h / 2;

      // One curved edge PER RELATIONSHIP. A film both directed and written
      // gets two strands, fanned apart so both are visible.
      for (const s of spokes) {
        s.predicates.forEach((predicate, k) => {
          const on = !lit || lit === predicate;
          const focused = hover === null || hover === s;
          ctx.globalAlpha = (on ? (focused ? 0.55 : 0.28) : 0.06) * progress;
          ctx.strokeStyle = colorOf.get(predicate) ?? FALLBACK;
          ctx.lineWidth = hover === s ? 1.8 : 1;

          // Fan multiple strands and bow them all, so the picture reads as
          // strands rather than as a bicycle wheel.
          const spread = (k - (s.predicates.length - 1) / 2) * 14;
          const mx = (cx + s.x) / 2;
          const my = (cy + s.y) / 2;
          // Unit normal to the spoke, for both the bow and the fan.
          const nx = (cy - s.y) / s.radius;
          const ny = (s.x - cx) / s.radius;
          // Start at the RIM, offset along the normal. Every strand starting
          // at the exact center produced a knot that buried the node the page
          // is about.
          const rim = 22;
          const ux = (s.x - cx) / s.radius;
          const uy = (s.y - cy) / s.radius;
          ctx.beginPath();
          ctx.moveTo(cx + ux * rim + nx * spread * 0.5, cy + uy * rim + ny * spread * 0.5);
          ctx.quadraticCurveTo(
            mx + nx * (s.radius * 0.2 + spread),
            my + ny * (s.radius * 0.2 + spread),
            s.x,
            s.y,
          );
          ctx.stroke();
        });
      }

      // Boxes already claimed by a label. The previous version drew every
      // label unconditionally and they overprinted each other into mush.
      const claimed: { x: number; y: number; w: number; h: number }[] = [];
      const collides = (b: { x: number; y: number; w: number; h: number }) =>
        claimed.some(
          (c) => b.x < c.x + c.w && b.x + b.w > c.x && b.y < c.y + c.h && b.y + b.h > c.y,
        );

      // Every node claims its own footprint before any label is placed, so a
      // label can never be printed on top of a dot.
      for (const s of spokes) {
        claimed.push({ x: s.x - s.r - 2, y: s.y - s.r - 2, w: s.r * 2 + 4, h: s.r * 2 + 4 });
      }

      for (const s of spokes) {
        const on = !lit || s.predicates.includes(lit);
        ctx.globalAlpha = (on ? 1 : 0.15) * progress;
        ctx.fillStyle = typeColor(s.node.type);
        ctx.beginPath();
        ctx.arc(s.x, s.y, hover === s ? s.r + 2 : s.r, 0, Math.PI * 2);
        ctx.fill();

        // Label sparingly. Everything labeled is nothing readable -- the first
        // version printed all of them and they collided into mush.
        if (on || hover === s) {
          ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
          const label = s.node.label.length > 24 ? `${s.node.label.slice(0, 23)}…` : s.node.label;
          const width = ctx.measureText(label).width;
          const left = s.x < cx;
          const tx = s.x + (left ? -s.r - 6 : s.r + 6);
          const box = { x: left ? tx - width : tx, y: s.y - 7, w: width, h: 14 };

          // The hovered node always gets its label; everything else yields to
          // whatever claimed the space first.
          if (hover === s || !collides(box)) {
            claimed.push(box);
            ctx.globalAlpha = (hover === s ? 1 : 0.75) * progress;
            ctx.fillStyle = hover === s ? ink : dim;
            ctx.textAlign = left ? 'right' : 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, tx, s.y);
          }
        }
      }

      ctx.globalAlpha = progress;
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.fillStyle = typeColor(center.type);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 19, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    function frame(now: number) {
      if (stopped) return;
      if (!start) start = now;
      // Fade in, then stop. A simulation left running is a battery drain on a
      // page somebody may leave open.
      const progress = reduced ? 1 : Math.min(1, (now - start) / 650);
      draw(progress);
      if (progress < 1) raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    const observer = new ResizeObserver(() => draw(1));
    observer.observe(wrap);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [center, nodes, colorOf, hover, lit]);

  function at(e: React.MouseEvent<HTMLCanvasElement>): Spoke | null {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best: Spoke | null = null;
    let bestD = Infinity;
    for (const s of spokesRef.current) {
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < Math.max(s.r + 9, 15) && d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }

  if (nodes.length === 0) return null;

  return (
    <figure className="flex flex-col gap-3">
      <div
        ref={wrapRef}
        className="relative w-full overflow-hidden rounded-xl border"
        style={{
          height: 'min(70vh, 540px)',
          borderColor: 'var(--tl-border)',
          background: 'var(--tl-surface)',
        }}
      >
        <canvas
          ref={canvasRef}
          className="h-full w-full"
          style={{ cursor: hover ? 'pointer' : 'default' }}
          onMouseMove={(e) => setHover(at(e))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            const s = at(e);
            if (s) router.push(`/explore/${s.node.type}/${s.node.slug}`);
          }}
          /* Decorative: every node below is a real link. Putting these in the
             tab order would make a screen reader read the neighborhood twice
             (AC-36). */
          aria-hidden
        />
        {hover && (
          <span
            className="pointer-events-none absolute left-3 top-3 max-w-[70%] truncate rounded-full px-3 py-1 text-xs"
            style={{
              background: 'var(--tl-surface-2)',
              border: '1px solid var(--tl-border-strong)',
            }}
          >
            {hover.node.label}
          </span>
        )}
      </div>

      {/* The legend is HTML, not canvas: crisp at any zoom, selectable, and it
          doubles as a filter. */}
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {groups.map((g) => {
          const active = lit === g.predicate;
          return (
            <button
              key={g.predicate}
              type="button"
              onClick={() => setLit(active ? null : g.predicate)}
              aria-pressed={active}
              className="flex min-h-8 items-center gap-1.5 rounded-full px-2 text-[11px]"
              style={{
                border: `1px solid ${active ? 'var(--tl-border-strong)' : 'transparent'}`,
                color: active ? 'var(--tl-text)' : 'var(--tl-text-dim)',
              }}
            >
              <span
                aria-hidden
                className="block size-2 rounded-full"
                style={{ background: colorOf.get(g.predicate) }}
              />
              {g.label}
            </button>
          );
        })}
      </figcaption>
    </figure>
  );
}
