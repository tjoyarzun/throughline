import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { getPublicShare, recordShareView } from '@/server/repos/shares';
import { titleById } from '@/server/repos/titles';
import { backdropUrl, posterUrl } from '@/lib/tmdb-image';
import { StarRating } from '@/components/tracking/star-rating';

/**
 * The public share page.
 *
 * Renders from core/sem plus EXACTLY ONE usr.share row, fetched by slug (layers-ok: prose, not a query -- the read lives in the repo)
 * through a SECURITY DEFINER function. It never opens a user-scoped
 * transaction, so there is no code path from here to anyone's live data --
 * only the snapshot taken when the link was made.
 *
 * Server-rendered with no client JS needed for the content, because iMessage,
 * WhatsApp and Slack fetch with their own bots and do not run JavaScript.
 */
export const dynamic = 'force-dynamic';

async function load(slug: string) {
  const share = await getPublicShare(slug);
  if (!share) return null;
  const title = await titleById(share.title_id);
  if (!title) return null;
  return { share, title };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) return { title: 'Not found' };
  const { share, title } = data;

  const stars = share.rating_snapshot ? share.rating_snapshot / 2 : null;
  // WhatsApp truncates around 65 characters, so the rating goes first.
  const description = [
    share.display_name && stars ? `${share.display_name} rated this ${stars}★` : null,
    share.message ?? share.note_snapshot ?? title.overview,
  ]
    .filter(Boolean)
    .join(' — ')
    .slice(0, 200);

  return {
    title: `${title.title}${title.release_year ? ` (${title.release_year})` : ''}`,
    description,
    // A personal message, not content. It should not be indexed.
    robots: { index: false, follow: false },
    openGraph: {
      type: 'video.movie',
      title: `${title.title}${title.release_year ? ` (${title.release_year})` : ''}`,
      description,
    },
    twitter: { card: 'summary_large_image' },
  };
}

export default async function SharePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();
  const { share, title } = data;

  const ua = (await headers()).get('user-agent');
  await recordShareView(slug, ua);

  const stars = share.rating_snapshot ? share.rating_snapshot / 2 : null;
  const accent = title.accent_color ?? 'var(--tl-accent)';

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col">
      <header className="relative">
        {title.backdrop_path ? (
          <span className="relative block aspect-video w-full overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element -- TMDB CDN */}
            <img
              src={backdropUrl(title.backdrop_path, 780)}
              alt=""
              className="h-full w-full object-cover"
            />
            <span
              aria-hidden
              className="absolute inset-0"
              style={{
                background: `linear-gradient(to bottom, transparent 30%, color-mix(in srgb, ${accent} 18%, var(--tl-bg)) 100%)`,
              }}
            />
          </span>
        ) : (
          <span
            className="block aspect-video w-full"
            style={{ background: 'var(--tl-surface-2)' }}
          />
        )}

        <div className="-mt-12 flex items-end gap-4 px-4">
          <span
            className="block w-24 shrink-0 overflow-hidden"
            style={{
              borderRadius: 'var(--radius-poster)',
              background: 'var(--tl-surface-2)',
              boxShadow: 'inset 0 0 0 1px var(--tl-poster-inset)',
            }}
          >
            {title.poster_path && (
              // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN
              <img
                src={posterUrl(title.poster_path, 96)}
                alt=""
                className="aspect-[2/3] h-full w-full object-cover"
              />
            )}
          </span>
          <div className="flex min-w-0 flex-col gap-1 pb-1">
            <h1 className="text-2xl leading-tight">{title.title}</h1>
            <p
              className="text-xs uppercase tracking-wide"
              style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
            >
              {[title.release_year, title.runtime_minutes ? `${title.runtime_minutes} min` : null]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-6 px-4 py-6">
        {(stars || share.message || share.note_snapshot) && (
          <section
            className="flex flex-col gap-3 rounded-xl border p-4"
            style={{ borderColor: 'var(--tl-border)', background: 'var(--tl-surface)' }}
          >
            {stars && (
              <span className="flex items-center gap-3">
                <StarRating value={stars} size={18} readOnly />
                <span className="text-sm" style={{ color: 'var(--tl-text-dim)' }}>
                  {share.display_name ?? 'Someone'} rated this
                </span>
              </span>
            )}
            {(share.message || share.note_snapshot) && (
              <blockquote
                className="border-l-2 pl-3 text-[15px] leading-relaxed"
                style={{ borderColor: 'var(--tl-accent)' }}
              >
                {share.message || share.note_snapshot}
              </blockquote>
            )}
            {/* Snapshots age. Saying when it was made is how the page stays
                honest if the rating has since changed. */}
            <span className="text-[10px]" style={{ color: 'var(--tl-text-dim)' }}>
              shared{' '}
              {new Date(share.created_at).toLocaleDateString('en-US', {
                month: 'long',
                year: 'numeric',
              })}
            </span>
          </section>
        )}

        {title.overview && (
          <p
            className="line-clamp-3 text-sm leading-relaxed"
            style={{ color: 'var(--tl-text-dim)' }}
          >
            {title.overview}
          </p>
        )}

        {(title.genres.length > 0 || title.themes.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {[...title.genres, ...title.themes].slice(0, 6).map((g) => (
              <span
                key={g}
                className="rounded-full px-2.5 py-1 text-xs"
                style={{ border: '1px solid var(--tl-border)', color: 'var(--tl-text-dim)' }}
              >
                {g}
              </span>
            ))}
          </div>
        )}

        <Link
          href={`/title/${title.slug}`}
          className="flex min-h-11 items-center justify-center rounded-full px-5 text-sm"
          style={{ background: 'var(--tl-accent)', color: 'var(--tl-bg)', fontWeight: 600 }}
        >
          Open in Throughline
        </Link>

        <footer className="pt-2 text-xs" style={{ color: 'var(--tl-text-faint)' }}>
          Data from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.
        </footer>
      </div>
    </main>
  );
}
