'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { posterUrl } from '@/lib/tmdb-image';
import { addToWatchlistByTmdbAction } from '@/actions/tracking';

export interface RailItem {
  tmdbId: number;
  kind: 'movie' | 'show';
  title: string;
  date: string | null;
  posterPath: string | null;
  /** Set when the corpus already holds it, so we link to the real page. */
  slug: string | null;
  tracked: boolean;
}

/**
 * A horizontal rail of things to consider watching.
 *
 * Each card carries a direct add-to-watchlist, because the job here is
 * "something new to watch, saved for later" and making that a three-tap
 * navigation is the friction the section exists to remove.
 */
export function DiscoveryRail({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle: string;
  items: RailItem[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          className="text-[10px] uppercase tracking-widest"
          style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          {title}
        </h2>
        <span className="text-[10px]" style={{ color: 'var(--tl-text-dim)' }}>
          {subtitle}
        </span>
      </div>
      <ul className="flex gap-3 overflow-x-auto pb-2">
        {items.map((item) => (
          <li key={`${item.kind}-${item.tmdbId}`} className="w-[104px] shrink-0">
            <Card item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Card({ item }: { item: RailItem }) {
  const [added, setAdded] = useState(item.tracked);
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  // Provisional slug for anything not yet ingested; opening it hydrates.
  const href = item.slug ? `/title/${item.slug}` : `/title/tmdb-${item.kind}-${item.tmdbId}`;

  return (
    <div className="flex flex-col gap-1.5">
      <Link href={href} className="flex flex-col gap-1.5">
        <span
          className="relative block aspect-[2/3] w-full overflow-hidden"
          style={{
            borderRadius: 'var(--radius-poster)',
            background: 'var(--tl-surface-2)',
            boxShadow: 'inset 0 0 0 1px var(--tl-poster-inset)',
          }}
        >
          {item.posterPath && (
            // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN; docs/adr/0012
            <img
              src={posterUrl(item.posterPath, 104)}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          )}
        </span>
        <span className="line-clamp-2 text-xs leading-tight" style={{ minHeight: '2.1em' }}>
          {item.title}
        </span>
        <span
          className="text-[10px] tabular-nums"
          style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          {formatDate(item.date)}
          {item.kind === 'show' ? ' · TV' : ''}
        </span>
      </Link>

      <button
        type="button"
        disabled={added || pending}
        aria-label={added ? `${item.title} is on your watchlist` : `Add ${item.title} to watchlist`}
        className="min-h-9 rounded-full px-2 py-1 text-[11px]"
        style={{
          border: `1px solid ${added ? 'var(--tl-accent)' : 'var(--tl-border-strong)'}`,
          color: added ? 'var(--tl-accent)' : 'var(--tl-text-dim)',
          opacity: pending ? 0.6 : 1,
        }}
        onClick={() => {
          setFailed(false);
          startTransition(async () => {
            const res = await addToWatchlistByTmdbAction({
              tmdbId: item.tmdbId,
              kind: item.kind,
            });
            if (res.ok) setAdded(true);
            else setFailed(true);
          });
        }}
      >
        {/* Honest pending state: an unseeded title has to be fetched from TMDB
            first, which takes a beat. */}
        {added ? 'On list' : pending ? 'Adding…' : failed ? 'Retry' : '+ Watchlist'}
      </button>
    </div>
  );
}

/** "Sep 21" for this year, "Sep 2026" beyond it. Upcoming dates need the year. */
function formatDate(iso: string | null): string {
  if (!iso) return 'TBA';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return 'TBA';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    ...(sameYear ? { day: 'numeric' } : { year: 'numeric' }),
  });
}
