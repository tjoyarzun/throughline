import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAccountId } from '@/server/auth/session';
import { libraryCounts, listLibrary, accountRegion, type LibrarySort } from '@/server/repos/user';
import type { Status } from '@/lib/tracking';
import { posterUrl } from '@/lib/tmdb-image';
import { StarRating } from '@/components/tracking/star-rating';

export const metadata = { title: 'Library' };
export const dynamic = 'force-dynamic';

const SEGMENTS = [
  { key: 'watchlist', label: 'Watchlist' },
  { key: 'watching', label: 'Watching' },
  { key: 'watched', label: 'Watched' },
  { key: 'favorites', label: 'Favorites' },
] as const;

const SORTS: { key: LibrarySort; label: string }[] = [
  { key: 'added', label: 'Added' },
  { key: 'rating', label: 'Rating' },
  { key: 'title', label: 'A–Z' },
  { key: 'release', label: 'Released' },
  { key: 'runtime', label: 'Shortest' },
  { key: 'streaming', label: 'Streaming' },
];

/** Distinct and actionable per segment — never a shrug. */
const EMPTY: Record<string, { head: string; body: string }> = {
  watchlist: { head: 'Nothing waiting.', body: 'Things you add will collect here.' },
  watching: { head: 'Nothing in flight.', body: 'Start something and it will show up here.' },
  watched: { head: 'No history yet.', body: 'Mark something watched and it lands here.' },
  favorites: {
    head: 'No favorites yet.',
    body: 'The heart is for what you love, not what you rated highest.',
  },
};

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string; sort?: string }>;
}) {
  const accountId = await getAccountId();
  if (!accountId) redirect('/auth/signin?next=/library');

  const sp = await searchParams;
  const segment = SEGMENTS.some((s) => s.key === sp.list) ? sp.list! : 'watchlist';
  const sort = (SORTS.find((s) => s.key === sp.sort)?.key ?? 'added') as LibrarySort;
  const favoritesOnly = segment === 'favorites';

  const [counts, items] = await Promise.all([
    libraryCounts(accountId),
    listLibrary(accountId, {
      ...(favoritesOnly ? { favoritesOnly: true } : { status: segment as Status }),
      sort,
      region: await accountRegion(accountId),
    }),
  ]);

  const empty = EMPTY[segment]!;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-3xl">Library</h1>

      {/* Segmented control, not sub-tabs: these are four views of one list. */}
      <nav aria-label="Library segments" className="flex gap-1 overflow-x-auto">
        {SEGMENTS.map((s) => {
          const active = s.key === segment;
          return (
            <Link
              key={s.key}
              href={`/library?list=${s.key}${sort === 'added' ? '' : `&sort=${sort}`}`}
              aria-current={active ? 'page' : undefined}
              className="min-h-11 shrink-0 rounded-full px-4 py-2 text-sm"
              style={{
                background: active ? 'var(--tl-surface-2)' : 'transparent',
                border: `1px solid ${active ? 'var(--tl-border-strong)' : 'transparent'}`,
                color: active ? 'var(--tl-text)' : 'var(--tl-text-dim)',
              }}
            >
              {s.label}
              <span
                className="ml-2 text-xs tabular-nums"
                style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
              >
                {counts[s.key] ?? 0}
              </span>
            </Link>
          );
        })}
      </nav>

      {items.length > 0 && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {SORTS.map((s) => (
            <Link
              key={s.key}
              href={`/library?list=${segment}&sort=${s.key}`}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs"
              style={{
                border: `1px solid ${s.key === sort ? 'var(--tl-accent)' : 'var(--tl-border)'}`,
                color: s.key === sort ? 'var(--tl-text)' : 'var(--tl-text-dim)',
              }}
            >
              {s.label}
            </Link>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <section
          className="flex flex-col items-center gap-3 rounded-xl border px-6 py-12 text-center"
          style={{ borderColor: 'var(--tl-border)', background: 'var(--tl-surface)' }}
        >
          <h2 className="text-2xl">{empty.head}</h2>
          <p className="max-w-sm text-sm" style={{ color: 'var(--tl-text-dim)' }}>
            {empty.body}
          </p>
          <Link
            href="/search"
            className="min-h-11 rounded-full px-5 py-2.5 text-sm"
            style={{
              background: 'var(--tl-accent)',
              color: 'var(--tl-accent-ink)',
              fontWeight: 600,
            }}
          >
            Find something
          </Link>
        </section>
      ) : (
        <ul className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-6">
          {items.map((t) => (
            <li key={t.title_id}>
              <Link href={`/title/${t.slug}`} className="flex flex-col gap-2">
                <span
                  className="relative block aspect-[2/3] w-full overflow-hidden"
                  style={{
                    borderRadius: 'var(--radius-poster)',
                    background: 'var(--tl-surface-2)',
                    boxShadow: 'inset 0 0 0 1px var(--tl-poster-inset)',
                  }}
                >
                  {t.poster_path && (
                    // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN; docs/adr/0012
                    <img
                      src={posterUrl(t.poster_path, 160)}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  )}
                  {t.progress_pct !== null && t.status === 'watching' && (
                    <span
                      aria-hidden
                      className="absolute inset-x-0 bottom-0 h-[3px]"
                      style={{ background: 'var(--tl-border-strong)' }}
                    >
                      <span
                        className="block h-full"
                        style={{ width: `${t.progress_pct}%`, background: 'var(--tl-accent)' }}
                      />
                    </span>
                  )}
                </span>

                <span className="line-clamp-2 text-sm leading-tight">{t.title}</span>

                <span className="flex items-center gap-2">
                  {t.rating !== null ? (
                    <StarRating value={Number(t.rating)} size={12} readOnly />
                  ) : (
                    <span className="text-xs" style={{ color: 'var(--tl-text-dim)' }}>
                      {t.release_year}
                    </span>
                  )}
                  {/* Quietly nudges cleanup; feeds the watchlist-aging metric. */}
                  {segment === 'watchlist' && t.days_on_watchlist > 180 && (
                    <span
                      className="text-[10px] uppercase"
                      style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
                    >
                      {Math.floor(t.days_on_watchlist / 30)}mo
                    </span>
                  )}
                  {t.view_count > 1 && (
                    <span
                      className="text-[10px]"
                      style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
                    >
                      ×{t.view_count}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
