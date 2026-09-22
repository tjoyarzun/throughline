import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getPersonBySlug, getFilmography } from '@/server/repos/titles';
import { hydratePersonOnDemand } from '@/server/ingest/on-demand';
import { posterUrl, profileUrl } from '@/lib/tmdb-image';

export const dynamic = 'force-dynamic';

/** Human labels for the role predicates. */
const ROLE_LABEL: Record<string, string> = {
  directed: 'As director',
  wrote: 'As writer',
  acted_in: 'As actor',
  composed_for: 'As composer',
  shot: 'As cinematographer',
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await getPersonBySlug(slug);
  return { title: p?.name ?? 'Not found' };
}

export default async function PersonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let person = await getPersonBySlug(slug);
  if (!person) notFound();

  // A person enters the corpus from a credits payload, which carries only a
  // name, a photo and a department. Their own record is fetched the first time
  // someone actually looks at them -- see docs/api.md#ingest.
  if (!person.detail_synced_at && person.tmdb_id) {
    try {
      if (await hydratePersonOnDemand(Number(person.tmdb_id))) {
        person = (await getPersonBySlug(slug)) ?? person;
      }
    } catch {
      // A provider failure is not a reason for the page to fail; it just
      // renders with what we already had.
    }
  }

  const filmography = await getFilmography(person.id);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-start gap-4">
        <span
          className="block h-24 w-24 shrink-0 overflow-hidden rounded-full"
          style={{ background: 'var(--tl-surface-2)' }}
        >
          {person.profile_path && (
            // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN; docs/adr/0012
            <img
              src={profileUrl(person.profile_path, 96)}
              alt=""
              className="h-full w-full object-cover"
            />
          )}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-3xl leading-tight">{person.name}</h1>
          <p
            className="text-xs uppercase tracking-wide"
            style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
          >
            {[
              person.known_for_department,
              lifespan(person.birthday, person.deathday),
              person.place_of_birth,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </header>

      {person.biography && (
        <p className="line-clamp-6 text-[15px] leading-relaxed">{person.biography}</p>
      )}

      {/*
        Filmography GROUPED BY ROLE. This grouping is the roles-not-entities
        decision made visible: one person who directs and writes, rather than a
        Director and a Writer who happen to share a name. See docs/adr/0002.
      */}
      {filmography.map(({ predicate, titles }) => (
        <section key={predicate} className="flex flex-col gap-3">
          <h2
            className="text-xs uppercase tracking-widest"
            style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
          >
            {ROLE_LABEL[predicate] ?? predicate} · {titles.length}
          </h2>
          <ul className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-6">
            {titles.map((t) => (
              <li key={t.id}>
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
                      // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
                      <img
                        src={posterUrl(t.poster_path, 160)}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </span>
                  <span className="line-clamp-2 text-sm leading-tight">{t.title}</span>
                  {t.release_year && (
                    <span className="text-xs" style={{ color: 'var(--tl-text-dim)' }}>
                      {t.release_year}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * "b. 1967" while living, "1967-2024" once not.
 *
 * Takes Date OR string because the driver hands back a Date for a DATE column
 * and a string elsewhere; assuming string threw at runtime and took the whole
 * page down with it, error boundary and all.
 */
function year(v: Date | string | null): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : String(d.getUTCFullYear());
}

function lifespan(birthday: Date | string | null, deathday: Date | string | null): string | null {
  const born = year(birthday);
  const died = year(deathday);
  if (!born) return died ? `d. ${died}` : null;
  return died ? `${born}\u2013${died}` : `b. ${born}`;
}
