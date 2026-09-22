import Link from 'next/link';
import { graphEngine } from '@/lib/graph/postgres-engine';
import { Orbit } from '@/components/graph/orbit';
import { popularTitles } from '@/server/repos/titles';

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

/** Never an empty canvas: offer somewhere to start walking from. */
async function StartHere() {
  const seeds = await popularTitles(12);
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
                    src={`https://image.tmdb.org/t/p/w185${t.poster_path}`}
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
    </div>
  );
}
