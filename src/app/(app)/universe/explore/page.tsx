import Link from 'next/link';
import { graphEngine } from '@/lib/graph/postgres-engine';
import { Orbit } from '@/components/graph/orbit';
import { popularTitles, titlesByTmdbIds, type TitleSummary } from '@/server/repos/titles';
import { trending } from '@/server/providers/tmdb/discovery';
import { getAccountId } from '@/server/auth/session';
import { listLibrary } from '@/server/repos/user';
import { posterUrl } from '@/lib/tmdb-image';

export const metadata = { title: 'Explore the graph' };
export const dynamic = 'force-dynamic';

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const sp = await searchParams;
  const [type, id] = (sp.focus ?? '').split(':');

  if (!type || !id) return <StartHere />;

  const center = await graphEngine.node({ type, id });
  if (!center) return <StartHere />;
  const groups = await graphEngine.neighbors({ type, id }, { perGroup: 8 });

  return (
    <div className="flex flex-col gap-6">
      <Link href="/universe" className="text-xs" style={{ color: 'var(--tl-text-dim)' }}>
        ← Universe
      </Link>
      <Orbit center={center} groups={groups} />
    </div>
  );
}

/**
 * Somewhere to start walking from -- and it has to change.
 *
 * This used to be popularTitles(12): the corpus ranked by a stored popularity
 * that is a seed snapshot, which made it the same twelve posters forever under
 * a page inviting you to explore. Two independent sources now move it:
 *
 *   what you have been watching, which changes as you use the app and is the
 *   most interesting place to start walking from anyway -- your own universe
 *   is the part of the graph you have opinions about;
 *
 *   what is trending today, intersected with the corpus, because a seed has
 *   to BE a node. A trending title we have never ingested has nothing to
 *   focus on, so it is filtered out here rather than rendered as a dead link.
 *
 * Popularity remains as the floor, for a brand-new account on a cold cache.
 *
 * The two groups are rendered SEPARATELY and labeled. Blended into one grid
 * they were indistinguishable, and because trending and popularity are the
 * same for everybody, two people with small libraries saw near-identical
 * pages and reasonably wondered whether they were seeing each other's. They
 * were not -- but a page that invites that question is badly built, and the
 * fix is to say which half is yours.
 */
async function StartHere() {
  const { mine, shared } = await exploreSeeds(12);
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <Link href="/universe" className="text-xs" style={{ color: 'var(--tl-text-dim)' }}>
          ← Universe
        </Link>
        <h1 className="text-3xl">Explore the graph</h1>
        <p className="text-sm" style={{ color: 'var(--tl-text-dim)' }}>
          Start anywhere and walk outward. Every step is a relationship the ontology declares.
        </p>
      </header>
      <SeedGroup
        heading="From your library"
        note="the part of the graph you have opinions about"
        seeds={mine}
      />
      <SeedGroup
        heading="Trending now"
        note="the same for everyone — a shared starting point, not yours"
        seeds={shared}
      />
    </div>
  );
}

function SeedGroup({
  heading,
  note,
  seeds,
}: {
  heading: string;
  note: string;
  seeds: TitleSummary[];
}) {
  if (seeds.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2
        className="text-xs uppercase tracking-widest"
        style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
      >
        {heading}
      </h2>
      <p className="text-xs" style={{ color: 'var(--tl-text-faint)' }}>
        {note}
      </p>
      <ul className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-6">
        {seeds.map((t) => (
          <li key={t.id}>
            <Link href={`/universe/explore?focus=title:${t.id}`} className="flex flex-col gap-2">
              <span
                className="relative block aspect-[2/3] w-full overflow-hidden"
                style={{
                  borderRadius: 'var(--radius-poster)',
                  background: 'var(--tl-surface-2)',
                  boxShadow: 'inset 0 0 0 1px var(--tl-poster-inset)',
                }}
              >
                {t.poster_path && (
                  // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
                  <img
                    src={posterUrl(t.poster_path, 92)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                )}
              </span>
              <span className="line-clamp-2 text-xs leading-tight">{t.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function exploreSeeds(
  limit: number,
): Promise<{ mine: TitleSummary[]; shared: TitleSummary[] }> {
  const seen = new Set<string>();
  const take = (rows: TitleSummary[], n: number) => {
    const out: TitleSummary[] = [];
    for (const r of rows) {
      if (out.length >= n || seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
    return out;
  };

  let mine: TitleSummary[] = [];
  const accountId = await getAccountId();
  if (accountId) {
    const library = await listLibrary(accountId, { sort: 'added', limit: 12 });
    mine = take(
      library
        .filter((m) => m.poster_path)
        .map((m) => ({
          id: m.title_id,
          slug: m.slug,
          kind: m.kind === 'show' ? ('show' as const) : ('movie' as const),
          title: m.title,
          release_year: m.release_year,
          poster_path: m.poster_path,
          popularity: null,
          genres: m.genres ?? [],
          tmdb_id: null,
        })),
      6,
    );
  }

  /* The shared half is sized against what the personal half actually filled,
     so an empty library still gets a full page rather than a lonely row. */
  const room = limit - mine.length;
  let shared: TitleSummary[] = [];
  try {
    shared = take(await titlesByTmdbIds((await trending(24)).map((t) => t.tmdbId)), room);
  } catch {
    // The provider being down is not a reason to have nowhere to start.
  }
  if (shared.length < room)
    shared = [...shared, ...take(await popularTitles(limit), room - shared.length)];

  return { mine, shared };
}
