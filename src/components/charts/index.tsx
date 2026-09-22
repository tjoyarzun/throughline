import type { MetricRow } from '@/lib/metrics/resolve';

/**
 * Five charts, hand-rolled in SVG.
 *
 * Recharts is ~90KB for what amounts to a few dozen path commands, and it
 * would not match the design tokens without fighting it. These inherit the
 * palette directly and add nothing to the shared bundle.
 *
 * Every chart also renders its numbers as text, so the data is reachable
 * without reading the picture (AC-33).
 */

const ACCENT = 'var(--tl-accent)';
const DIM = 'var(--tl-text-dim)';
const TRACK = 'var(--tl-surface-2)';

/** Distribution as a ring, with the leaders listed beside it. */
export function Donut({ rows }: { rows: MetricRow[] }) {
  const top = rows.slice(0, 6);
  const total = rows.reduce((n, r) => n + r.value, 0) || 1;
  const R = 52;
  const C = 2 * Math.PI * R;

  // Offsets accumulate, so each arc starts where the previous ended. Derived
  // with a running sum rather than a mutable counter: React's lint rule
  // rejects reassignment during render, and it is right -- this is a value
  // computed from the rows, not state that outlives them.
  const arcs = top.map((r, i) => ({
    frac: r.value / total,
    offset: top.slice(0, i).reduce((n, prev) => n + prev.value / total, 0),
    opacity: 1 - i * 0.13,
  }));

  return (
    <div className="flex items-center gap-5">
      <svg width="128" height="128" viewBox="0 0 128 128" aria-hidden className="shrink-0">
        <circle cx="64" cy="64" r={R} fill="none" stroke={TRACK} strokeWidth="18" />
        {arcs.map((a, i) => (
          <circle
            key={i}
            cx="64"
            cy="64"
            r={R}
            fill="none"
            stroke={ACCENT}
            strokeOpacity={a.opacity}
            strokeWidth="18"
            strokeDasharray={`${a.frac * C} ${C}`}
            strokeDashoffset={-a.offset * C}
            transform="rotate(-90 64 64)"
          />
        ))}
      </svg>
      <ol className="flex min-w-0 flex-1 flex-col gap-1.5">
        {top.map((r, i) => (
          <li key={r.key} className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: ACCENT, opacity: 1 - i * 0.13 }}
              />
              <span className="truncate text-sm">{r.label ?? r.key}</span>
            </span>
            <span className="shrink-0 text-xs tabular-nums" style={{ color: DIM }}>
              {r.share !== null ? `${Math.round(r.share * 100)}%` : r.value}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A ranked list with a proportional bar behind each row. */
export function RankedList({ rows }: { rows: MetricRow[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ol className="flex flex-col gap-1.5">
      {rows.slice(0, 8).map((r) => (
        <li key={r.key} className="relative flex items-baseline justify-between gap-3 px-2 py-1.5">
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 rounded"
            style={{ width: `${(r.value / max) * 100}%`, background: ACCENT, opacity: 0.14 }}
          />
          <span className="relative truncate text-sm">{r.label ?? r.key}</span>
          <span className="relative shrink-0 text-xs tabular-nums" style={{ color: DIM }}>
            {r.value}
            {r.secondary !== null && ` · ${r.secondary.toFixed(1)}★`}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Ratings across the half-star scale. Empty steps are kept, not collapsed. */
export function Histogram({ rows }: { rows: MetricRow[] }) {
  const byKey = new Map(rows.map((r) => [Number(r.key).toFixed(1), r.value]));
  const steps = Array.from({ length: 10 }, (_, i) => ((i + 1) / 2).toFixed(1));
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="flex items-end gap-1.5" style={{ height: 96 }}>
      {steps.map((s) => {
        const v = byKey.get(s) ?? 0;
        return (
          <span key={s} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[9px] tabular-nums" style={{ color: DIM }}>
              {v || ''}
            </span>
            <span
              className="w-full rounded-t"
              style={{
                height: `${Math.max(2, (v / max) * 64)}px`,
                background: v ? ACCENT : TRACK,
                opacity: v ? 0.85 : 1,
              }}
            />
            <span className="text-[9px] tabular-nums" style={{ color: DIM }}>
              {s.endsWith('.0') ? s.slice(0, -2) : ''}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** Monthly counts. A single point is drawn as a dot, not a zero-length line. */
export function Sparkline({ rows }: { rows: MetricRow[] }) {
  const pts = rows.map((r) => r.value);
  const max = Math.max(...pts, 1);
  const W = 280;
  const H = 64;

  if (pts.length === 0) return null;
  if (pts.length === 1) {
    return (
      <div className="flex items-baseline gap-2">
        <span className="text-2xl tabular-nums">{pts[0]}</span>
        <span className="text-xs" style={{ color: DIM }}>
          this month
        </span>
      </div>
    );
  }

  const step = W / (pts.length - 1);
  const d = pts
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * step} ${H - (v / max) * (H - 8) - 4}`)
    .join(' ');
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden height={H}>
      <path d={d} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

const AGE_BUCKETS = ['under a month', '1–3 months', '3–6 months', '6–12 months', 'over a year'];

/** Watchlist age. The bucket index comes from width_bucket, so it is 0-based. */
export function BucketBar({ rows }: { rows: MetricRow[] }) {
  const byBucket = new Map(rows.map((r) => [Number(r.key), r.value]));
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ol className="flex flex-col gap-1.5">
      {AGE_BUCKETS.map((label, i) => {
        const v = byBucket.get(i) ?? 0;
        return (
          <li key={label} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-xs" style={{ color: DIM }}>
              {label}
            </span>
            <span className="h-2 flex-1 rounded-full" style={{ background: TRACK }}>
              <span
                className="block h-full rounded-full"
                style={{ width: `${(v / max) * 100}%`, background: ACCENT, opacity: 0.85 }}
              />
            </span>
            <span className="w-6 shrink-0 text-right text-xs tabular-nums" style={{ color: DIM }}>
              {v || ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function Stat({ rows }: { rows: MetricRow[] }) {
  const v = rows[0]?.value ?? 0;
  return <span className="text-3xl tabular-nums">{Math.round(v * 100)}%</span>;
}
