/**
 * Skeletons must match final dimensions exactly — that is the whole point.
 * A skeleton of the wrong size trades a spinner for layout shift (CLS).
 */
export function Skeleton({
  className = '',
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      aria-hidden
      className={`block animate-pulse ${className}`}
      style={{ background: 'var(--tl-surface-2)', borderRadius: 'var(--radius-poster)', ...style }}
    />
  );
}

export function PosterSkeleton({ width = '7.5rem' }: { width?: string }) {
  return (
    <span className="flex flex-col gap-2" style={{ width }}>
      <Skeleton className="aspect-[2/3] w-full" />
      <Skeleton style={{ height: '0.875rem', width: '80%', borderRadius: 4 }} />
    </span>
  );
}

/** A line of body text. Height matches the real line box, not the glyphs. */
export function TextLine({
  width = '100%',
  height = '0.9rem',
}: {
  width?: string;
  height?: string;
}) {
  return <Skeleton style={{ height, width, borderRadius: 4 }} />;
}

/** The mono section label used throughout the app. */
export function HeadLine({ width = '7rem' }: { width?: string }) {
  return <Skeleton style={{ height: '0.7rem', width, borderRadius: 4 }} />;
}

/**
 * The poster grid, at the exact column counts the real grids use.
 * Mismatched columns are worse than no skeleton: the layout visibly reflows.
 */
export function PosterGridSkeleton({
  count = 12,
  className = 'grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-6',
}: {
  count?: number;
  className?: string;
}) {
  return (
    <ul className={className}>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex flex-col gap-2">
          <Skeleton className="aspect-[2/3] w-full" />
          <TextLine width="85%" height="0.8rem" />
        </li>
      ))}
    </ul>
  );
}

/** A horizontally scrolling strip of posters, e.g. Recently Watched. */
export function PosterRailSkeleton({ count = 6, width = 104 }: { count?: number; width?: number }) {
  return (
    <ul className="flex gap-3 overflow-hidden pb-2">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="shrink-0 flex flex-col gap-2" style={{ width }}>
          <Skeleton className="aspect-[2/3] w-full" />
          <TextLine width="90%" height="0.7rem" />
        </li>
      ))}
    </ul>
  );
}
