import type { CSSProperties } from 'react';

/**
 * The most-repeated element in the product, so the details matter.
 *
 * The inset hairline is what separates artwork from the background without a
 * visible frame — it is the single line that makes posters read as premium
 * rather than as pasted images.
 */
export interface PosterCardProps {
  title: string;
  year?: number | undefined;
  /** Already a full TMDB CDN URL at the right size bucket. See docs/adr/0012. */
  posterUrl?: string | undefined;
  rating?: number | undefined;
  density?: 'sm' | 'md' | 'lg';
  style?: CSSProperties;
}

const WIDTHS: Record<NonNullable<PosterCardProps['density']>, string> = {
  sm: '5.5rem',
  md: '7.5rem',
  lg: '10rem',
};

export function PosterCard({
  title,
  year,
  posterUrl,
  rating,
  density = 'md',
  style,
}: PosterCardProps) {
  const label = year ? `${title} (${year})` : title;
  return (
    <figure className="m-0 flex flex-col gap-2" style={{ width: WIDTHS[density], ...style }}>
      <div
        className="relative aspect-[2/3] w-full overflow-hidden"
        style={{
          borderRadius: 'var(--radius-poster)',
          background: 'var(--tl-surface-2)',
          boxShadow: 'inset 0 0 0 1px var(--tl-poster-inset)',
        }}
      >
        {posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- TMDB serves pre-sized variants; see docs/adr/0012.
          <img src={posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span
            aria-hidden
            className="absolute inset-0 grid place-items-center text-xs"
            style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
          >
            no art
          </span>
        )}
      </div>
      <figcaption className="flex flex-col gap-0.5">
        <span className="line-clamp-2 text-sm leading-tight">{label}</span>
        {rating !== undefined && (
          <span className="text-xs" style={{ color: 'var(--tl-text-dim)' }}>
            {rating.toFixed(1)} out of 5 stars
          </span>
        )}
      </figcaption>
    </figure>
  );
}
