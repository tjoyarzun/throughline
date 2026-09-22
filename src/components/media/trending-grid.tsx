import Link from 'next/link';
import { posterUrl } from '@/lib/tmdb-image';
import type { RailItem } from './discovery-rail';

/**
 * A grid of what is trending.
 *
 * Shares RailItem with the horizontal rails on purpose: both answer "here are
 * titles, some of which we already hold", and both have to link a title we
 * have never seen to something that works. A second shape would mean a second
 * place to get the provisional-slug rule wrong.
 *
 * A grid rather than a rail because this is the idle page's main content --
 * the thing someone looks at when they open Search with nothing in mind --
 * and a horizontal strip shows six posters where a grid shows eighteen.
 */
export function TrendingGrid({ items }: { items: RailItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2
        className="text-xs uppercase tracking-widest"
        style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
      >
        Popular right now
      </h2>

      <ul className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-6">
        {items.map((item) => {
          // Provisional slug for anything not yet ingested; opening it hydrates.
          const href = item.slug
            ? `/title/${item.slug}`
            : `/title/tmdb-${item.kind}-${item.tmdbId}`;
          const year = item.date ? item.date.slice(0, 4) : null;

          return (
            <li key={`${item.kind}-${item.tmdbId}`}>
              <Link href={href} className="group flex flex-col gap-2">
                <span
                  className="relative block aspect-[2/3] overflow-hidden rounded-md"
                  style={{
                    background: 'var(--tl-surface-2)',
                    boxShadow: 'inset 0 0 0 1px var(--tl-poster-inset)',
                  }}
                >
                  {item.posterPath && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={posterUrl(item.posterPath, 185)}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                      // Titles we do not hold are dimmed, the same signal the
                      // rails use, so "already in your library" is legible
                      // before reading a word.
                      style={item.slug ? undefined : { opacity: 0.85 }}
                    />
                  )}
                  {item.tracked && (
                    <span
                      className="absolute right-1 top-1 rounded-full px-1.5 py-0.5 text-[9px]"
                      style={{
                        background: 'var(--tl-accent)',
                        color: 'var(--tl-accent-ink)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      Tracked
                    </span>
                  )}
                </span>
                <span className="line-clamp-2 text-sm leading-tight">{item.title}</span>
                {year && (
                  <span className="text-xs" style={{ color: 'var(--tl-text-dim)' }}>
                    {year}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
