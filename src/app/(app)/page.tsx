import Link from 'next/link';
import { getAccountId } from '@/server/auth/session';
import {
  continueWatching,
  listLibrary,
  recentlyWatched,
  type LibraryItem,
} from '@/server/repos/user';
import { posterUrl, backdropUrl } from '@/lib/tmdb-image';
import { StarRating } from '@/components/tracking/star-rating';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const accountId = await getAccountId();
  if (!accountId) return <ZeroState signedOut />;

  const [inProgress, upNext, recent] = await Promise.all([
    continueWatching(accountId),
    listLibrary(accountId, { status: 'watchlist', sort: 'added', limit: 6 }),
    recentlyWatched(accountId, 12),
  ]);

  if (inProgress.length === 0 && upNext.length === 0 && recent.length === 0) {
    return <ZeroState />;
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p
          className="text-xs uppercase tracking-widest"
          style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          {new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      </header>

      {/* Continue Watching is FIRST because resuming a show is the single
          highest-frequency job after capture. See docs/product.md §6.1. */}
      {inProgress.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHead>Continue watching</SectionHead>
          <ul className="flex gap-3 overflow-x-auto pb-2" style={{ scrollSnapType: 'x mandatory' }}>
            {inProgress.map((t) => (
              <li key={t.title_id} className="shrink-0" style={{ scrollSnapAlign: 'start' }}>
                <Link href={`/title/${t.slug}`} className="flex w-[260px] flex-col gap-2">
                  <span
                    className="relative block aspect-video w-full overflow-hidden"
                    style={{
                      borderRadius: 'var(--radius-card)',
                      background: 'var(--tl-surface-2)',
                      boxShadow: 'inset 0 0 0 1px var(--tl-poster-inset)',
                    }}
                  >
                    {t.backdrop_path && (
                      // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
                      <img
                        src={backdropUrl(t.backdrop_path, 500)}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    )}
                    <span
                      aria-hidden
                      className="absolute inset-x-0 bottom-0 h-[3px]"
                      style={{ background: 'rgb(0 0 0 / 0.45)' }}
                    >
                      <span
                        className="block h-full"
                        style={{
                          width: `${t.progress_pct ?? 0}%`,
                          background: 'var(--tl-accent)',
                        }}
                      />
                    </span>
                  </span>
                  <span className="line-clamp-1 text-sm">{t.title}</span>
                  <span
                    className="text-xs tabular-nums"
                    style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
                  >
                    S{t.season_number} E{t.episode_number}
                    {t.episodes_aired !== null && t.episodes_watched !== null
                      ? ` · ${t.episodes_aired - t.episodes_watched} left`
                      : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {upNext.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <SectionHead>Up next</SectionHead>
            <Link
              href="/library?list=watchlist"
              className="text-xs underline-offset-4 hover:underline"
              style={{ color: 'var(--tl-text-dim)' }}
            >
              See all
            </Link>
          </div>
          <PosterGrid items={upNext} />
        </section>
      )}

      {recent.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionHead>Recently watched</SectionHead>
          <ul className="flex gap-3 overflow-x-auto pb-2">
            {recent.map((t) => (
              <li key={t.title_id} className="w-[104px] shrink-0">
                <Link href={`/title/${t.slug}`} className="flex flex-col gap-2">
                  <Poster path={t.poster_path} />
                  <span className="line-clamp-2 text-xs leading-tight">{t.title}</span>
                  {t.rating !== null && <StarRating value={Number(t.rating)} size={11} readOnly />}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-xs uppercase tracking-widest"
      style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
    >
      {children}
    </h2>
  );
}

function PosterGrid({ items }: { items: LibraryItem[] }) {
  return (
    <ul className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-6">
      {items.map((t) => (
        <li key={t.title_id}>
          <Link href={`/title/${t.slug}`} className="flex flex-col gap-2">
            <Poster path={t.poster_path} />
            <span className="line-clamp-2 text-sm leading-tight">{t.title}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Poster({ path }: { path: string | null }) {
  return (
    <span
      className="relative block aspect-[2/3] w-full overflow-hidden"
      style={{
        borderRadius: 'var(--radius-poster)',
        background: 'var(--tl-surface-2)',
        boxShadow: 'inset 0 0 0 1px var(--tl-poster-inset)',
      }}
    >
      {path && (
        // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN; docs/adr/0012
        <img
          src={posterUrl(path, 160)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      )}
    </span>
  );
}

/** Never an empty grid: one prompt, one action. */
function ZeroState({ signedOut = false }: { signedOut?: boolean }) {
  return (
    <div className="flex flex-col gap-8">
      <section
        className="flex flex-col items-center gap-3 rounded-xl border px-6 py-14 text-center"
        style={{ borderColor: 'var(--tl-border)', background: 'var(--tl-surface)' }}
      >
        <h1 className="text-3xl">Nothing tracked yet.</h1>
        <p className="max-w-sm text-sm" style={{ color: 'var(--tl-text-dim)' }}>
          Search for something you have watched and it will start collecting here. The graph fills
          in as you go.
        </p>
        <Link
          href={signedOut ? '/auth/signin' : '/search'}
          className="mt-2 min-h-11 rounded-full px-5 py-2.5 text-sm"
          style={{ background: 'var(--tl-accent)', color: 'var(--tl-accent-ink)', fontWeight: 600 }}
        >
          {signedOut ? 'Sign in' : 'Find something'}
        </Link>
      </section>
    </div>
  );
}
