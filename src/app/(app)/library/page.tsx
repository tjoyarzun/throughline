import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAccountId } from '@/server/auth/session';
import {
  libraryCounts,
  libraryGenres,
  libraryKinds,
  listLibrary,
  accountRegion,
  type LibrarySort,
} from '@/server/repos/user';
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
  searchParams: Promise<{ list?: string; sort?: string; genre?: string; kind?: string }>;
}) {
  const accountId = await getAccountId();
  if (!accountId) redirect('/auth/signin?next=/library');

  const sp = await searchParams;
  const segment = SEGMENTS.some((s) => s.key === sp.list) ? sp.list! : 'watchlist';
  const sort = (SORTS.find((s) => s.key === sp.sort)?.key ?? 'added') as LibrarySort;
  const favoritesOnly = segment === 'favorites';

  const scope = favoritesOnly ? { favoritesOnly: true as const } : { status: segment as Status };

  const [counts, genres, kinds, region] = await Promise.all([
    libraryCounts(accountId),
    libraryGenres(accountId, scope),
    libraryKinds(accountId, scope),
    accountRegion(accountId),
  ]);

  /* An unknown genre in the URL is not an error page: the chip list is built
     from the reader's own rows, so one can stop existing simply by their
     un-tracking the last title that had it. Treat it as no filter and let the
     chips show the truth.
     
     Validated BEFORE the list query rather than alongside it. Filtering by a
     genre the chips do not offer would render an empty grid under an "All
     genres" chip that claims nothing is filtered -- the list and the control
     describing it have to agree. */
  const genre = genres.some((g) => g.genre === sp.genre) ? sp.genre : undefined;

  /* Validated the same way and for the same reason as the genre: a kind the
     chips do not offer would render an empty grid under an "All" chip
     claiming nothing is filtered. */
  const kind = kinds.some((k) => k.kind === sp.kind) ? (sp.kind as 'movie' | 'show') : undefined;

  const items = await listLibrary(accountId, {
    ...scope,
    sort,
    ...(genre ? { genre } : {}),
    ...(kind ? { kind } : {}),
    region,
  });

  const href = (next: { sort?: LibrarySort; genre?: string | null; kind?: string | null }) => {
    const p = new URLSearchParams({ list: segment });
    const s2 = next.sort ?? sort;
    if (s2 !== 'added') p.set('sort', s2);
    const g = next.genre === null ? undefined : (next.genre ?? genre);
    if (g) p.set('genre', g);
    const k = next.kind === null ? undefined : (next.kind ?? kind);
    if (k) p.set('kind', k);
    return `/library?${p.toString()}`;
  };

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
              /* Genre AND kind are dropped when changing segment: both chip
                 sets are per-segment, so carrying "Anime" or "Shows" from
                 Watched into Watchlist would silently filter to nothing. */
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
              href={href({ sort: s.key })}
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

      {/* Movies/Shows sits in the SAME row as the genres, not a row of its
          own. They are both "narrow what I am looking at", and two stacked
          chip rows would read as two unrelated controls -- which is how a
          filter bar becomes a wall. Kind first because it is the coarser cut.
          Rendered only when the library actually holds both. */}
      {(kinds.length > 1 || genres.length > 1) && (
        <nav aria-label="Filter the library" className="flex gap-1 overflow-x-auto pb-1">
          {/* Two GROUPS, not one flat list. Both are "narrow what I am looking
              at", but they are different questions, and aria-current means
              "the current item in a set" -- two of them loose in one nav
              claims two current items in one set. A labeled group each keeps
              the row visually single and semantically honest. */}
          {kinds.length > 1 && (
            <div role="group" aria-label="Movies or shows" className="flex gap-1">
              <GenreChip href={href({ kind: null })} label="All" active={!kind} />
              {kinds.map((k) => (
                <GenreChip
                  key={k.kind}
                  href={href({ kind: k.kind === kind ? null : k.kind })}
                  label={k.kind === 'movie' ? 'Movies' : 'Shows'}
                  count={k.n}
                  active={k.kind === kind}
                />
              ))}
            </div>
          )}

          {kinds.length > 1 && genres.length > 1 && (
            /* A hairline between the groups, so the row reads as two controls
               rather than one long undifferentiated list. */
            <span
              aria-hidden="true"
              className="mx-1 w-px shrink-0 self-stretch"
              style={{ background: 'var(--tl-border)' }}
            />
          )}

          {genres.length > 1 && (
            <div role="group" aria-label="Genre" className="flex gap-1">
              <GenreChip href={href({ genre: null })} label="All genres" active={!genre} />
              {genres.map((g) => (
                <GenreChip
                  key={g.genre}
                  href={href({ genre: g.genre === genre ? null : g.genre })}
                  label={g.genre}
                  count={g.n}
                  active={g.genre === genre}
                />
              ))}
            </div>
          )}
        </nav>
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

/**
 * One genre chip.
 *
 * aria-current, NOT aria-pressed. The first attempt reasoned about these as
 * toggles -- tapping the active one does clear the filter -- and reached for
 * aria-pressed, which is only defined on role=button. These are links: they
 * navigate, they have an href, and axe rejected the attribute outright
 * (aria-allowed-attr, critical). aria-current="true" is the right thing for a
 * link marking the active member of a set, which is exactly what this is.
 */
function GenreChip({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count?: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs"
      style={{
        border: `1px solid ${active ? 'var(--tl-accent)' : 'var(--tl-border)'}`,
        background: active ? 'var(--tl-surface-2)' : 'transparent',
        color: active ? 'var(--tl-text)' : 'var(--tl-text-dim)',
      }}
    >
      {label}
      {count !== undefined && (
        <span className="tabular-nums" style={{ fontFamily: 'var(--font-mono)' }}>
          {count}
        </span>
      )}
    </Link>
  );
}
