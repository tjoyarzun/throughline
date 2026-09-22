import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import { getTitleBySlug, getTitleByTmdbId } from '@/server/repos/titles';
import { hydrateOnDemand } from '@/server/ingest/on-demand';
import { Chip } from '@/components/ui/chip';
import { PosterSkeleton } from '@/components/ui/skeleton';
import { backdropUrl, posterUrl, profileUrl } from '@/lib/tmdb-image';
import { TrackControls } from '@/components/tracking/track-controls';
import { ShareButton } from '@/components/tracking/share-button';
import { similarTitles } from '@/server/repos/titles';
import { getAccountId } from '@/server/auth/session';
import { getUserTitle } from '@/server/repos/user';

export const dynamic = 'force-dynamic';

/**
 * Slugs of the form `tmdb-movie-329865` come from search results for titles we
 * do not hold yet. Opening one ingests it, then redirects to its real slug —
 * the lazy-hydration path from docs/api.md.
 */
const PROVISIONAL = /^tmdb-(movie|show)-(\d+)$/;

async function load(slug: string) {
  const provisional = PROVISIONAL.exec(slug);
  if (!provisional) return getTitleBySlug(slug);

  const kind = provisional[1]!;
  const tmdbId = Number(provisional[2]);
  const existing = await getTitleByTmdbId(tmdbId, kind);
  if (existing) return existing;
  await hydrateOnDemand(tmdbId, kind);
  return getTitleByTmdbId(tmdbId, kind);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await getTitleBySlug(slug);
  return { title: t ? `${t.title}${t.release_year ? ` (${t.release_year})` : ''}` : 'Not found' };
}

export default async function TitlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const t = await load(slug);
  if (!t) notFound();

  const directors = t.crew.filter((c) => c.predicate === 'directed');
  const writers = t.crew.filter((c) => c.predicate === 'wrote');
  const others = t.crew.filter((c) => !['directed', 'wrote'].includes(c.predicate));
  const accent = t.accent_color ?? 'var(--tl-accent)';

  // The page renders for signed-out visitors too (share links land here), so
  // the personal layer is fetched only when there is someone to fetch it for.
  // Similar is deliberately NOT awaited here. It is an extra round trip that
  // nothing above the fold needs, and awaiting it held the entire page --
  // including the action row people came to tap -- behind it. It streams in
  // below instead. See docs/performance-log.md.
  const accountId = await getAccountId();
  const tracked = accountId ? await getUserTitle(accountId, t.id) : null;

  return (
    <article className="-mx-4 flex flex-col gap-8">
      {/* Backdrop, fading into the page. The gradient is tinted by the poster's
          own dominant color, extracted once at ingest. */}
      <header className="relative">
        {t.backdrop_path ? (
          <div className="relative aspect-[16/9] w-full overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element -- TMDB CDN; docs/adr/0012 */}
            <img
              src={backdropUrl(t.backdrop_path, 780)}
              alt=""
              className="h-full w-full object-cover"
            />
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(to bottom, transparent 30%, color-mix(in srgb, ${accent} 18%, var(--tl-bg)) 100%)`,
              }}
            />
          </div>
        ) : (
          <div className="h-8" />
        )}

        <div className="-mt-16 flex items-end gap-4 px-4">
          <span
            className="relative block w-24 shrink-0 overflow-hidden"
            style={{
              aspectRatio: '2 / 3',
              borderRadius: 'var(--radius-poster)',
              background: 'var(--tl-surface-2)',
              boxShadow: 'inset 0 0 0 1px var(--tl-poster-inset), 0 8px 24px rgb(0 0 0 / 0.35)',
            }}
          >
            {t.poster_path && (
              // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN; docs/adr/0012
              <img
                src={posterUrl(t.poster_path, 96)}
                alt=""
                className="h-full w-full object-cover"
              />
            )}
          </span>
          <div className="flex min-w-0 flex-col gap-1 pb-1">
            <h1 className="text-3xl leading-tight">{t.title}</h1>
            <p
              className="text-xs uppercase tracking-wide"
              style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
            >
              {[
                t.release_year,
                t.runtime_minutes ? `${t.runtime_minutes} min` : null,
                t.kind === 'show' ? 'Series' : null,
                t.certification,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-8 px-4">
        {/* The primary action row sits ABOVE the overview: capture is the job
            people come here to do, and it must be reachable without scrolling. */}
        {accountId && (
          <div className="flex flex-col gap-3">
            <TrackControls
              titleId={t.id}
              slug={t.slug}
              kind={t.kind}
              initial={{
                status: tracked?.status ?? null,
                isFavorite: tracked?.is_favorite ?? false,
                rating:
                  tracked?.rating === null || tracked?.rating === undefined
                    ? null
                    : Number(tracked.rating),
              }}
            />
            <div className="flex gap-2">
              <ShareButton titleId={t.id} title={t.title} />
            </div>
          </div>
        )}

        {t.overview && <p className="text-[15px] leading-relaxed">{t.overview}</p>}

        {(t.genres.length > 0 || t.themes.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {t.genres.map((g) => (
              <Chip key={g}>{g}</Chip>
            ))}
            {/* Themes are accent-outlined: they are OUR curated vocabulary,
                genres are the provider's. See docs/ontology.md. */}
            {t.themes.map((th) => (
              <Chip key={th} variant="theme">
                {th}
              </Chip>
            ))}
          </div>
        )}

        {(directors.length > 0 || writers.length > 0 || others.length > 0) && (
          <Section title="Crew">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {[
                ['Director', directors],
                ['Writer', writers],
                ...others.map((o) => [o.job, [o]] as const),
              ]
                .filter(([, list]) => (list as unknown[]).length > 0)
                .slice(0, 6)
                .map(([label, list]) => (
                  <div key={String(label)} className="flex flex-col gap-0.5">
                    <dt className="text-xs" style={{ color: 'var(--tl-text-dim)' }}>
                      {String(label)}
                    </dt>
                    <dd>
                      {(list as { person_slug: string; person_name: string }[])
                        .slice(0, 3)
                        .map((p, i) => (
                          <span key={p.person_slug}>
                            {i > 0 && ', '}
                            <Link
                              href={`/person/${p.person_slug}`}
                              className="underline-offset-2 hover:underline"
                            >
                              {p.person_name}
                            </Link>
                          </span>
                        ))}
                    </dd>
                  </div>
                ))}
            </dl>
          </Section>
        )}

        {t.cast_members.length > 0 && (
          <Section title="Cast">
            <ul className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2">
              {t.cast_members.map((c) => (
                <li key={c.person_id} className="w-20 shrink-0">
                  <Link
                    href={`/person/${c.person_slug}`}
                    className="flex flex-col items-center gap-2 text-center"
                  >
                    <span
                      className="block h-20 w-20 overflow-hidden rounded-full"
                      style={{ background: 'var(--tl-surface-2)' }}
                    >
                      {c.profile_path && (
                        // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
                        <img
                          src={profileUrl(c.profile_path, 80)}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      )}
                    </span>
                    <span className="line-clamp-2 text-xs leading-tight">{c.person_name}</span>
                    {c.character_name && (
                      <span
                        className="line-clamp-2 text-[11px] leading-tight"
                        style={{ color: 'var(--tl-text-dim)' }}
                      >
                        {c.character_name}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {t.based_on.length > 0 && (
          <Section title="Based on">
            {/* TMDB has no field for this at all — it comes from Wikidata.
                See docs/adr/0006. */}
            {t.based_on.map((w) => (
              <p key={w.slug} className="text-sm">
                <span style={{ color: 'var(--tl-text-dim)' }}>the {w.kind} </span>
                <span className="italic">{w.title}</span>
                {w.author && <span style={{ color: 'var(--tl-text-dim)' }}> by {w.author}</span>}
              </p>
            ))}
          </Section>
        )}

        {t.franchises.length > 0 && (
          <Section title="Part of">
            <div className="flex flex-wrap gap-2">
              {t.franchises.map((f) => (
                <Chip key={f.id}>{f.name}</Chip>
              ))}
            </div>
          </Section>
        )}

        <Suspense fallback={<SimilarFallback />}>
          <SimilarStrip titleId={t.id} />
        </Suspense>

        <footer className="pt-2 text-xs" style={{ color: 'var(--tl-text-faint)' }}>
          Data from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
        </footer>
      </div>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2
        className="text-xs uppercase tracking-widest"
        style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Streams in after the page shell; never blocks the action row. */
async function SimilarStrip({ titleId }: { titleId: string }) {
  const similar = await similarTitles(titleId, 12);
  if (similar.length === 0) return null;
  return (
    <Section title="Similar">
      <ul className="flex gap-3 overflow-x-auto pb-2">
        {similar.map((sim) => (
          <li key={sim.id} className="w-[104px] shrink-0">
            <Link href={`/title/${sim.slug}`} className="flex flex-col gap-2">
              <span
                className="relative block aspect-[2/3] w-full overflow-hidden"
                style={{
                  borderRadius: 'var(--radius-poster)',
                  background: 'var(--tl-surface-2)',
                  boxShadow: 'inset 0 0 0 1px var(--tl-poster-inset)',
                }}
              >
                {sim.poster_path && (
                  // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
                  <img
                    src={posterUrl(sim.poster_path, 160)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                )}
              </span>
              <span className="line-clamp-2 text-xs leading-tight">{sim.title}</span>
              {/* The REASON is the point. A similarity you cannot explain is
                  indistinguishable from a guess. */}
              <span
                className="text-[10px] uppercase tracking-wide"
                style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
              >
                {sim.reason}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Exact dimensions of the real strip, so streaming it in shifts nothing. */
function SimilarFallback() {
  return (
    <Section title="Similar">
      <ul className="flex gap-3 overflow-x-auto pb-2">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="w-[104px] shrink-0">
            <PosterSkeleton width="100%" />
          </li>
        ))}
      </ul>
    </Section>
  );
}
