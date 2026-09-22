'use client';

import { useRef, useState } from 'react';

/**
 * Half-star rating.
 *
 * Exposed as a slider, not a row of buttons: a screen reader hearing "button,
 * button, button, button, button" learns nothing, while role="slider" with
 * aria-valuetext says "four and a half out of five stars" (AC-33).
 *
 * Drag is a convenience, never the only way in -- SC 2.5.7 forbids a
 * dragging-only interaction, so tap sets a whole/half star directly and the
 * arrow keys step by halves.
 */
export function StarRating({
  value,
  onChange,
  size = 30,
  readOnly = false,
}: {
  value: number | null;
  onChange?: (stars: number | null) => void;
  size?: number;
  readOnly?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const shown = hover ?? value ?? 0;

  function starsFromPointer(clientX: number): number {
    const el = rowRef.current;
    if (!el) return 0;
    const { left, width } = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
    // Round UP to the next half so the leftmost sliver is 0.5, not 0 --
    // otherwise the first star is unreachable by tap.
    return Math.max(0.5, Math.ceil(ratio * 10) / 2);
  }

  function commit(stars: number): void {
    // Tapping the current rating again clears it. Without this there is no way
    // to un-rate something short of a separate destructive control.
    onChange?.(stars === value ? null : stars);
  }

  if (readOnly) {
    return (
      <span
        className="inline-flex"
        role="img"
        aria-label={value === null ? 'Not rated' : `${value} out of 5 stars`}
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} fill={fillFor(shown, i)} size={size} />
        ))}
      </span>
    );
  }

  return (
    <div
      ref={rowRef}
      role="slider"
      tabIndex={0}
      aria-label="Your rating"
      aria-valuemin={0}
      aria-valuemax={5}
      aria-valuenow={value ?? 0}
      aria-valuetext={value === null ? 'Not rated' : `${value} out of 5 stars`}
      className="inline-flex cursor-pointer touch-none select-none py-2"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setHover(starsFromPointer(e.clientX));
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) setHover(starsFromPointer(e.clientX));
      }}
      onPointerUp={(e) => {
        const stars = starsFromPointer(e.clientX);
        setHover(null);
        commit(stars);
      }}
      onPointerCancel={() => setHover(null)}
      onKeyDown={(e) => {
        const current = value ?? 0;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          onChange?.(Math.min(5, current + 0.5));
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          const next = Math.max(0, current - 0.5);
          onChange?.(next === 0 ? null : next);
        } else if (e.key === 'Home') {
          e.preventDefault();
          onChange?.(0.5);
        } else if (e.key === 'End') {
          e.preventDefault();
          onChange?.(5);
        }
      }}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <Star key={i} fill={fillFor(shown, i)} size={size} />
      ))}
    </div>
  );
}

/** 0, 0.5 or 1 for the i-th star given a rating in stars. */
function fillFor(stars: number, i: number): 0 | 0.5 | 1 {
  const d = stars - i;
  if (d >= 1) return 1;
  if (d >= 0.5) return 0.5;
  return 0;
}

function Star({ fill, size }: { fill: 0 | 0.5 | 1; size: number }) {
  const id = `half-${size}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden
      // Padding, not a bigger glyph: the hit area clears 44pt without the
      // stars ballooning. See docs/ui.md.
      style={{ padding: '0 3px', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={id}>
          <stop offset="50%" stopColor="var(--tl-accent)" />
          <stop offset="50%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <path
        d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.45 6.19 20.5l1.11-6.47L2.6 9.45l6.5-.95z"
        fill={fill === 1 ? 'var(--tl-accent)' : fill === 0.5 ? `url(#${id})` : 'transparent'}
        stroke="var(--tl-accent)"
        strokeWidth="1.4"
        strokeLinejoin="round"
        opacity={fill === 0 ? 0.45 : 1}
      />
    </svg>
  );
}
