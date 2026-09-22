import { Suspense } from 'react';
import { SearchClient } from '@/components/media/search-client';
import { DiscoveryRail, type RailItem } from '@/components/media/discovery-rail';
import { popularTitles, localByTmdbIds } from '@/server/repos/titles';
import {
  newReleases,
  upcoming,
  trending,
  type DiscoveryItem,
} from '@/server/providers/tmdb/discovery';
import { TrendingGrid } from '@/components/media/trending-grid';
import { getAccountId } from '@/server/auth/session';
import { getUserTitle } from '@/server/repos/user';
import { Skeleton, HeadLine } from '@/components/ui/skeleton';

export const metadata = { title: 'Search' };
export const dynamic = 'force-dynamic';

export default async function SearchPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Search</h1>
      <SearchClient
        idle={
          <div className="flex flex-col gap-6">
            {/* Trending leads: it is what someone opening Search with nothing
                in mind is actually looking at. It streams like the rails, so a
                slow provider call never holds the search box. */}
            <Suspense key="trending" fallback={<GridFallback />}>
              <Trending />
            </Suspense>
            {/* Each rail streams on its own: one slow provider call must not
                hold the search box, which is what people came for. */}
            {/* Keyed because this tree is passed as a PROP to a client
                component: React serializes it as an array across that
                boundary, and then wants keys on the siblings. */}
            <Suspense key="new" fallback={<RailFallback />}>
              <Rail kind="new" title="New releases" subtitle="last 90 days" />
            </Suspense>
            <Suspense key="upcoming" fallback={<RailFallback />}>
              <Rail kind="upcoming" title="Coming soon" subtitle="soonest first" />
            </Suspense>
          </div>
        }
      />
    </div>
  );
}

/**
 * Trending, with the corpus merged in.
 *
 * Falls back to the local corpus ranked by stored popularity when TMDB is
 * unreachable. That is exactly what this rail used to be all the time -- a
 * frozen snapshot -- which is fine as a degraded state and was not fine as
 * the feature.
 */
async function Trending() {
  let items: DiscoveryItem[] = [];
  try {
    items = await trending(18);
  } catch {
    items = [];
  }

  if (items.length === 0) {
    const local = await popularTitles(18);
    return (
      <TrendingGrid
        items={local.map((t) => ({
          tmdbId: 0,
          kind: t.kind === 'show' ? ('show' as const) : ('movie' as const),
          title: t.title,
          date: t.release_year ? `${t.release_year}-01-01` : null,
          posterPath: t.poster_path,
          slug: t.slug,
          tracked: false,
        }))}
      />
    );
  }

  return <TrendingGrid items={await withLocalContext(items)} />;
}

/**
 * Attach what we already know to a list of provider items.
 *
 * Anything already in the corpus links to its real page rather than to a
 * provisional slug that would re-ingest what we already have, and anything the
 * viewer already tracks says so.
 */
async function withLocalContext(items: DiscoveryItem[]): Promise<RailItem[]> {
  const local = await localByTmdbIds(items.map((i) => i.tmdbId));
  const accountId = await getAccountId();

  return Promise.all(
    items.map(async (i) => {
      const match = local.get(`${i.kind}:${i.tmdbId}`);
      const tracked =
        accountId && match ? (await getUserTitle(accountId, match.id)) !== null : false;
      return {
        tmdbId: i.tmdbId,
        kind: i.kind,
        title: i.title,
        date: i.date,
        posterPath: i.posterPath,
        slug: match?.slug ?? null,
        tracked,
      };
    }),
  );
}

async function Rail({
  kind,
  title,
  subtitle,
}: {
  kind: 'new' | 'upcoming';
  title: string;
  subtitle: string;
}) {
  let items: DiscoveryItem[];
  try {
    items = kind === 'new' ? await newReleases(14) : await upcoming(14);
  } catch {
    // The provider being down is not a reason for the search page to fail.
    return null;
  }

  return <DiscoveryRail title={title} subtitle={subtitle} items={await withLocalContext(items)} />;
}

function RailFallback() {
  return (
    <section className="flex flex-col gap-2">
      <HeadLine width="7rem" />
      <ul className="flex gap-3 overflow-hidden pb-2">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="flex w-[104px] shrink-0 flex-col gap-1.5">
            <Skeleton className="aspect-[2/3] w-full" />
            <Skeleton style={{ height: '0.7rem', width: '85%', borderRadius: 4 }} />
            <Skeleton style={{ height: '2.25rem', width: '100%', borderRadius: 999 }} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Matches the trending grid's dimensions exactly, so nothing shifts on load. */
function GridFallback() {
  return (
    <section className="flex flex-col gap-3">
      <HeadLine width="9rem" />
      <ul className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-6">
        {Array.from({ length: 12 }, (_, i) => (
          <li key={i} className="flex flex-col gap-2">
            <Skeleton className="aspect-[2/3] w-full" />
            <Skeleton className="h-3 w-4/5" />
          </li>
        ))}
      </ul>
    </section>
  );
}
