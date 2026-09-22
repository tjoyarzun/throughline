import { logoUrl } from '@/lib/tmdb-image';
import type { Availability, Offer } from '@/server/repos/titles';

/**
 * Where to watch.
 *
 * The attribution is not decoration and is not separable from the data. TMDB
 * sources this from JustWatch and requires the JustWatch mark plus a
 * region-specific link on every surface that shows it; docs/attribution.md
 * records the obligation and a test asserts it renders. The component is built
 * so the two cannot come apart -- there is no way to render an offer here
 * without the footer, because they are the same component.
 *
 * If `link` is ever null we render nothing at all rather than offers without
 * their attribution. The spec is explicit: if the attribution cannot be done
 * properly, no availability ships.
 */

function Row({ label, offers }: { label: string; offers: Offer[] }) {
  if (offers.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3
        className="text-[10px] uppercase tracking-widest"
        style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
      >
        {label}
      </h3>
      <ul className="flex flex-wrap gap-2">
        {offers.map((o) => (
          <li
            key={`${label}-${o.provider_name}`}
            className="flex items-center gap-2 rounded-full py-1 pl-1 pr-3"
            style={{ border: '1px solid var(--tl-border)', background: 'var(--tl-surface)' }}
          >
            {o.provider_logo ? (
              /* TMDB serves pre-sized logos from its own CDN, so the optimizer
                 would re-encode an already-optimized asset and spend units for
                 nothing. The directive has to be the LAST line before the
                 element -- a comment between them disables the comment. */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl(o.provider_logo, 32)}
                alt=""
                width={24}
                height={24}
                loading="lazy"
                className="size-6 rounded-full object-contain"
                style={{ background: 'var(--tl-surface-2)' }}
              />
            ) : (
              <span className="size-6 rounded-full" style={{ background: 'var(--tl-surface-2)' }} />
            )}
            <span className="text-xs">{o.provider_name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WhereToWatch({ availability }: { availability: Availability | null }) {
  if (!availability?.link) return null;
  const { stream, free, rent, buy, link, region } = availability;
  if (stream.length + free.length + rent.length + buy.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2
        className="text-xs uppercase tracking-widest"
        style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
      >
        Where to watch · {region}
      </h2>

      <Row label="Stream" offers={stream} />
      <Row label="Free" offers={free} />
      <Row label="Rent" offers={rent} />
      <Row label="Buy" offers={buy} />

      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        className="flex min-h-11 items-center gap-2 self-start text-[11px]"
        style={{ color: 'var(--tl-text-dim)' }}
      >
        <span>Streaming data by</span>
        {/* Served from /public, because the CSP allows img-src 'self' and would
            silently block the same file from JustWatch's CDN. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- a 15KB static SVG */}
        <img src="/justwatch.svg" alt="JustWatch" width={66} height={10} className="h-[10px]" />
      </a>
    </section>
  );
}
