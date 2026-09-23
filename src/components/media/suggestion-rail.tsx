import Link from 'next/link';
import { suggestions } from '@/server/repos/suggestions';
import { reasonPhrase } from '@/lib/suggestion-copy';
import { posterUrl } from '@/lib/tmdb-image';

/**
 * Things to watch, with the evidence attached.
 *
 * Its own async component so it can sit behind a Suspense boundary: the query
 * walks the taste graph and is the slowest thing on Home, and Continue
 * Watching is the module people actually came for. Nothing here may delay it.
 *
 * Renders nothing at all when there is nothing to say -- a new account has no
 * watched titles, so no affinity, so no honest suggestion. An empty state
 * here would be a shrug in the middle of a working page.
 */
export async function SuggestionRail({ accountId }: { accountId: string }) {
  const items = await suggestions(accountId, { limit: 9 });
  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2
          className="text-xs uppercase tracking-widest"
          style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          Worth your time
        </h2>
        <span className="text-[11px]" style={{ color: 'var(--tl-text-faint)' }}>
          from what you have watched
        </span>
      </div>

      <ul className="flex gap-3 overflow-x-auto pb-2" style={{ scrollSnapType: 'x mandatory' }}>
        {items.map((s) => (
          <li key={s.title_id} className="w-[124px] shrink-0" style={{ scrollSnapAlign: 'start' }}>
            <Link href={`/title/${s.slug}`} className="flex flex-col gap-2">
              <span
                className="relative block aspect-[2/3] w-full overflow-hidden"
                style={{
                  borderRadius: 'var(--radius-poster)',
                  background: 'var(--tl-surface-2)',
                  boxShadow: 'inset 0 0 0 1px var(--tl-poster-inset)',
                }}
              >
                {s.poster_path && (
                  // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN; docs/adr/0012
                  <img
                    src={posterUrl(s.poster_path, 185)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                )}
              </span>

              <span className="flex flex-col gap-0.5">
                <span className="line-clamp-2 text-xs leading-tight">{s.title}</span>
                {/* The reason, not a score. A number would be unfalsifiable;
                    this names the person or theme and how many of theirs you
                    have already seen, which you can go and check. */}
                {s.reasons.slice(0, 1).map((r) => (
                  <span key={r.label} className="flex flex-col leading-tight">
                    {/* --tl-text, NOT --tl-accent. Aged gold on warm paper is
                        3.2:1 and fails AA for text; §37 of the spec makes
                        accent a non-text UI token in light mode, and this is
                        text. The name is already distinguished from the
                        phrase beneath it by weight and position. */}
                    <span className="truncate text-[11px]" style={{ color: 'var(--tl-text)' }}>
                      {r.label}
                    </span>
                    <span className="text-[10px]" style={{ color: 'var(--tl-text-dim)' }}>
                      {reasonPhrase(r)}
                    </span>
                  </span>
                ))}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
