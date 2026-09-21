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
