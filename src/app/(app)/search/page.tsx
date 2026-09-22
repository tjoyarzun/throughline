import { Suspense } from 'react';
import { SearchClient } from '@/components/media/search-client';
import { DiscoveryRail, type RailItem } from '@/components/media/discovery-rail';
import { popularTitles, localByTmdbIds } from '@/server/repos/titles';
import { newReleases, upcoming, type DiscoveryItem } from '@/server/providers/tmdb/discovery';
import { getAccountId } from '@/server/auth/session';
import { getUserTitle } from '@/server/repos/user';
import { Skeleton, HeadLine } from '@/components/ui/skeleton';

export const metadata = { title: 'Search' };
export const dynamic = 'force-dynamic';

export default async function SearchPage() {
  // Server-rendered so the page is never an empty box while JavaScript loads.
  const initial = await popularTitles(18);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Search</h1>
      <SearchClient
        initial={initial}
        idle={
          <div className="flex flex-col gap-6">
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

  // Anything already in the corpus links to its real page rather than to a
  // provisional slug that would re-ingest what we already have.
  const local = await localByTmdbIds(items.map((i) => i.tmdbId));
  const accountId = await getAccountId();

  const rows: RailItem[] = await Promise.all(
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

  return <DiscoveryRail title={title} subtitle={subtitle} items={rows} />;
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
