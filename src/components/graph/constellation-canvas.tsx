'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { graphPalette } from '@/lib/design/tokens';
import type { GraphEdge, GraphNode } from '@/lib/graph/types';

/**
 * A neighborhood, drawn as a force-directed network.
 *
 * Two earlier versions were wrong in ways worth keeping written down, because
 * both looked reasonable in code and only failed once actually rendered.
 *
 * The first laid neighbors on concentric rings and produced a bicycle wheel:
 * every node equidistant, the same film drawn once per relationship, labels
 * overprinting each other.
 *
 * The second was still a wheel, because the DATA was a star. One hop from any
 * node reaches people, concepts and studios, and this ontology has no direct
 * edge between those -- measured on Paris, Texas: 40 neighbors, exactly zero
 * edges among them. No layout algorithm invents structure that is not there.
 * The fix was in the query rather than the renderer: two hops, keeping every
 * edge among the whole set, which reconnects the first ring through the second
 * and yields 130-350 edges worth laying out.
 *
 * Hence a real simulation. It runs ONCE to a fixed iteration budget and then
 * stops -- a simulation left running is a battery drain on a public page
 * somebody may leave open in a tab.
 */

interface Placed {
  node: GraphNode;
  key: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  fixed: boolean;
}

const FALLBACK = '#8B93A1';
const PALETTE = Object.values(graphPalette);

function typeColor(type: string): string {
  return (graphPalette as Record<string, string>)[type] ?? FALLBACK;
}

/** Log-scaled: Drama has 2,139 connections and a source work has 8. */
function radiusFor(degree: number, isCenter: boolean): number {
  if (isCenter) return 13;
  return 3.5 + Math.min(8, Math.log1p(Math.max(0, degree)) * 1.25);
}

/**
 * Fruchterman-Reingold, with the focused node pinned at the middle.
 *
 * Deterministic on purpose: the same neighborhood must settle the same way
 * every time, or a resize would reshuffle the picture under the reader's
 * cursor. Initial placement is seeded from the node index, never Math.random.
 */
function simulate(placed: Placed[], edges: GraphEdge[], w: number, h: number): void {
  const index = new Map(placed.map((p, i) => [p.key, i]));
  const k = Math.sqrt((w * h) / Math.max(1, placed.length)) * 0.72;
  let temp = Math.min(w, h) * 0.22;
  const cool = temp / 320;

  for (let step = 0; step < 320; step++) {
    for (const p of placed) {
      p.vx = 0;
      p.vy = 0;
    }

    // Repulsion across every pair. O(n^2) on <=100 nodes is a few thousand
    // operations a step; a quadtree would be optimizing the wrong thing.
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!;
        const b = placed[j]!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) {
          // Coincident nodes have no direction to separate along. Nudge them
          // deterministically rather than dividing by zero.
          dx = ((i % 7) - 3) * 0.1;
          dy = ((j % 7) - 3) * 0.1;
          d = Math.hypot(dx, dy) || 0.01;
        }
        const force = (k * k) / d;
        const ux = dx / d;
        const uy = dy / d;
        a.vx += ux * force;
        a.vy += uy * force;
        b.vx -= ux * force;
        b.vy -= uy * force;
      }
    }

    // Attraction along edges, stronger for lower-weight relationships, so a
    // shared director pulls harder than a shared genre.
    for (const e of edges) {
      const ai = index.get(e.source);
      const bi = index.get(e.target);
      if (ai === undefined || bi === undefined) continue;
      const a = placed[ai]!;
      const b = placed[bi]!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const pull = ((d * d) / k) * (1 / Math.max(0.6, e.weight * 0.45));
      const ux = dx / d;
      const uy = dy / d;
      a.vx -= ux * pull;
      a.vy -= uy * pull;
      b.vx += ux * pull;
      b.vy += uy * pull;
    }

    const cx = w / 2;
    const cy = h / 2;
    for (const p of placed) {
      if (p.fixed) {
        p.x = cx;
        p.y = cy;
        continue;
      }
      // Mild gravity, or a disconnected node drifts off the canvas forever.
      p.vx += (cx - p.x) * 0.012;
      p.vy += (cy - p.y) * 0.012;

      const speed = Math.hypot(p.vx, p.vy) || 0.01;
      const capped = Math.min(speed, temp);
      p.x += (p.vx / speed) * capped;
      p.y += (p.vy / speed) * capped;

      // A loose clamp only, to stop a runaway. Hard-clamping to the frame
      // flattened everything that reached the edge into a straight line of
      // clipped dots along the top -- visible in the render, and obviously an
      // artifact rather than data.
      const bound = Math.max(w, h);
      p.x = Math.max(-bound, Math.min(w + bound, p.x));
      p.y = Math.max(-bound, Math.min(h + bound, p.y));
    }
    temp = Math.max(0.5, temp - cool);
  }

  fitToFrame(placed, w, h);
}

/**
 * Scale and center the settled layout so it fills the frame.
 *
 * The simulation works in its own space and has no idea how big the canvas is.
 * Fitting afterwards is what removes clipping entirely -- nothing has to be
 * clamped, because everything is mapped into view -- and it also uses the
 * whole frame instead of leaving one corner empty.
 */
function fitToFrame(placed: Placed[], w: number, h: number): void {
  if (placed.length === 0) return;
  const pad = 46; // room for a label beside the outermost node
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of placed) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  // One scale for both axes: scaling them independently would stretch the
  // picture and make distances lie about how related two things are.
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
  const offX = (w - spanX * scale) / 2 - minX * scale;
  const offY = (h - spanY * scale) / 2 - minY * scale;
  for (const p of placed) {
    p.x = p.x * scale + offX;
    p.y = p.y * scale + offY;
  }
}

export function ConstellationCanvas({
  center,
  nodes,
  edges,
}: {
  center: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  /**
   * Hover and the filter live in REFS.
   *
   * The previous version listed `hover` among the effect's dependencies, so
   * every mouse move tore the canvas down and rebuilt it, restarting the
   * fade-in from zero on each pixel of movement. That was the flicker. The
   * layout is computed once and redrawn imperatively; React state exists only
   * for the HTML tooltip and the legend's pressed state.
   */
  const hoverRef = useRef<Placed | null>(null);
  const litRef = useRef<string | null>(null);
  const placedRef = useRef<Placed[]>([]);
  const drawRef = useRef<(progress?: number) => void>(() => {});

  const [hoverLabel, setHoverLabel] = useState<string | null>(null);
  const [lit, setLit] = useState<string | null>(null);

  const predicates = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of edges) if (!seen.has(e.predicate)) seen.set(e.predicate, e.label);
    return [...seen.entries()].map(([predicate, label]) => ({ predicate, label }));
  }, [edges]);

  const colorOf = useMemo(() => {
    const m = new Map<string, string>();
    predicates.forEach((p, i) => m.set(p.predicate, PALETTE[i % PALETTE.length]!));
    return m;
  }, [predicates]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const css = getComputedStyle(document.documentElement);
    const ink = css.getPropertyValue('--tl-text').trim() || '#ECEDEF';
    const dim = css.getPropertyValue('--tl-text-dim').trim() || '#9AA0A8';
    const accent = css.getPropertyValue('--tl-accent').trim() || '#E8C77A';

    let raf = 0;
    let stopped = false;
    let laidOutFor = '';

    function build(w: number, h: number) {
      const all: Placed[] = [
        {
          node: center,
          key: `${center.type}:${center.id}`,
          x: w / 2,
          y: h / 2,
          vx: 0,
          vy: 0,
          r: radiusFor(center.degree, true),
          fixed: true,
        },
        ...nodes.map((n, i) => {
          const a = (i / Math.max(1, nodes.length)) * Math.PI * 2;
          const spread = Math.min(w, h) * (0.18 + 0.22 * ((i % 5) / 4));
          return {
            node: n,
            key: `${n.type}:${n.id}`,
            x: w / 2 + Math.cos(a) * spread,
            y: h / 2 + Math.sin(a) * spread,
            vx: 0,
            vy: 0,
            r: radiusFor(n.degree, false),
            fixed: false,
          };
        }),
      ];
      simulate(all, edges, w, h);
      placedRef.current = all;
      laidOutFor = `${w}x${h}`;
    }

    function draw(progress = 1) {
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
      if (laidOutFor !== `${w}x${h}`) build(w, h);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';

      const placed = placedRef.current;
      const byKey = new Map(placed.map((p) => [p.key, p]));
      const hover = hoverRef.current;
      const active = litRef.current;
      const near = hover
        ? new Set(
            edges
              .filter((e) => e.source === hover.key || e.target === hover.key)
              .flatMap((e) => [e.source, e.target]),
          )
        : null;

      for (const e of edges) {
        const a = byKey.get(e.source);
        const b = byKey.get(e.target);
        if (!a || !b) continue;
        const onFilter = !active || e.predicate === active;
        const touching = hover ? e.source === hover.key || e.target === hover.key : true;
        ctx.globalAlpha = (onFilter ? (touching ? 0.6 : 0.1) : 0.04) * progress;
        ctx.strokeStyle = colorOf.get(e.predicate) ?? FALLBACK;
        // Thicker for a stronger relationship. Visible edge weight is part of
        // why a network reads as a network rather than a tangle.
        ctx.lineWidth = touching && hover ? 2.2 : Math.max(0.7, 2.4 / Math.max(1, e.weight));
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        // A slight bow. Straight lines read as a diagram; curves read as a web.
        ctx.quadraticCurveTo(mx - dy * 0.08, my + dx * 0.08, b.x, b.y);
        ctx.stroke();
      }

      // Every node claims its footprint before a single label is placed, so no
      // label is ever printed over a dot or over another label.
      const claimed = placed.map((p) => ({
        x: p.x - p.r - 2,
        y: p.y - p.r - 2,
        w: p.r * 2 + 4,
        h: p.r * 2 + 4,
      }));
      const collides = (b: { x: number; y: number; w: number; h: number }) =>
        claimed.some(
          (c) => b.x < c.x + c.w && b.x + b.w > c.x && b.y < c.y + c.h && b.y + b.h > c.y,
        );

      for (const p of placed) {
        const faded = near ? !near.has(p.key) && p !== hover : false;
        ctx.globalAlpha = (faded ? 0.18 : 1) * progress;
        ctx.fillStyle = typeColor(p.node.type);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p === hover ? p.r + 2 : p.r, 0, Math.PI * 2);
        ctx.fill();
        if (p.fixed) {
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r + 5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Biggest first: when space is contested, the hub should win it.
      for (const p of [...placed].sort((a, b) => b.r - a.r)) {
        const faded = near ? !near.has(p.key) && p !== hover : false;
        if (faded && p !== hover) continue;
        ctx.font = p.fixed
          ? '600 12px ui-sans-serif, system-ui, sans-serif'
          : '11px ui-sans-serif, system-ui, sans-serif';
        const label = p.node.label.length > 22 ? `${p.node.label.slice(0, 21)}…` : p.node.label;
        const width = ctx.measureText(label).width;
        const right = p.x + p.r + 5;
        const flip = right + width > w - 4;
        const box = { x: flip ? p.x - p.r - 5 - width : right, y: p.y - 7, w: width, h: 14 };
        if (p !== hover && !p.fixed && collides(box)) continue;
        claimed.push(box);
        ctx.globalAlpha = progress;
        ctx.fillStyle = p === hover || p.fixed ? ink : dim;
        ctx.textAlign = flip ? 'right' : 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, flip ? p.x - p.r - 5 : right, p.y);
      }
      ctx.globalAlpha = 1;
    }

    drawRef.current = draw;

    let start = 0;
    function frame(now: number) {
      if (stopped) return;
      if (!start) start = now;
      const progress = reduced ? 1 : Math.min(1, (now - start) / 600);
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
    // Depends on the DATA only. Hover and the filter are read from refs inside
    // draw(), so changing either never re-runs this effect.
  }, [center, nodes, edges, colorOf]);

  const hit = useCallback((e: React.MouseEvent<HTMLCanvasElement>): Placed | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best: Placed | null = null;
    let bestD = Infinity;
    for (const p of placedRef.current) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < Math.max(p.r + 8, 14) && d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }, []);

  if (nodes.length === 0) return null;

  return (
    <figure className="flex flex-col gap-3">
      <div
        ref={wrapRef}
        className="relative w-full overflow-hidden rounded-xl border"
        style={{
          height: 'min(78vh, 620px)',
          borderColor: 'var(--tl-border)',
          background: 'var(--tl-surface)',
        }}
      >
        <canvas
          ref={canvasRef}
          className="h-full w-full"
          style={{ cursor: hoverLabel ? 'pointer' : 'default' }}
          onMouseMove={(e) => {
            const p = hit(e);
            if (p === hoverRef.current) return; // Redraw only on a real change.
            hoverRef.current = p;
            setHoverLabel(p ? p.node.label : null);
            drawRef.current();
          }}
          onMouseLeave={() => {
            if (!hoverRef.current) return;
            hoverRef.current = null;
            setHoverLabel(null);
            drawRef.current();
          }}
          onClick={(e) => {
            const p = hit(e);
            if (p) router.push(`/explore/${p.node.type}/${p.node.slug}`);
          }}
          /* Decorative: every node is a real link in the lists below. Adding
             these to the tab order would make a screen reader read the whole
             neighborhood twice (AC-36). */
          aria-hidden
        />
        {hoverLabel && (
          <span
            className="pointer-events-none absolute left-3 top-3 max-w-[70%] truncate rounded-full px-3 py-1 text-xs"
            style={{
              background: 'var(--tl-surface-2)',
              border: '1px solid var(--tl-border-strong)',
            }}
          >
            {hoverLabel}
          </span>
        )}
      </div>

      {/* HTML, not canvas: crisp at any zoom, selectable, and it doubles as a
          filter. */}
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {predicates.map((p) => {
          const on = lit === p.predicate;
          return (
            <button
              key={p.predicate}
              type="button"
              aria-pressed={on}
              onClick={() => {
                const next = on ? null : p.predicate;
                setLit(next);
                litRef.current = next;
                drawRef.current();
              }}
              className="flex min-h-8 items-center gap-1.5 rounded-full px-2 text-[11px]"
              style={{
                border: `1px solid ${on ? 'var(--tl-border-strong)' : 'transparent'}`,
                color: on ? 'var(--tl-text)' : 'var(--tl-text-dim)',
              }}
            >
              <span
                aria-hidden
                className="block size-2 rounded-full"
                style={{ background: colorOf.get(p.predicate) }}
              />
              {p.label}
            </button>
          );
        })}
      </figcaption>
    </figure>
  );
}
