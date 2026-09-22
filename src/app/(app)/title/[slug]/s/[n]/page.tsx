import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getAccountId } from '@/server/auth/session';
import { getTitleBySlug } from '@/server/repos/titles';
import { episodesForSeason, seasonsForTitle } from '@/server/repos/episodes';
import { EpisodeList } from '@/components/tracking/episode-list';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; n: string }>;
}) {
  const { slug, n } = await params;
  const t = await getTitleBySlug(slug);
  return { title: t ? `${t.title} · Season ${n}` : 'Not found' };
}

export default async function SeasonPage({
  params,
}: {
  params: Promise<{ slug: string; n: string }>;
}) {
  const { slug, n } = await params;
  const seasonNumber = Number(n);
  if (!Number.isInteger(seasonNumber) || seasonNumber < 0) notFound();

  const accountId = await getAccountId();
  if (!accountId) redirect(`/auth/signin?next=/title/${slug}/s/${n}`);

  const title = await getTitleBySlug(slug);
  if (!title) notFound();

  const [seasons, episodes] = await Promise.all([
    seasonsForTitle(accountId, title.id),
    episodesForSeason(accountId, title.id, seasonNumber),
  ]);
  if (episodes.length === 0) notFound();

  const season = seasons.find((s) => s.season_number === seasonNumber);
  const label = seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <Link href={`/title/${slug}`} className="text-xs" style={{ color: 'var(--tl-text-dim)' }}>
          ← {title.title}
        </Link>
        <h1 className="text-3xl">{label}</h1>
        {season?.air_date && (
          <p
            className="text-xs uppercase tracking-wide"
            style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
          >
            {season.air_date}
          </p>
        )}
      </header>

      <EpisodeList titleId={title.id} slug={slug} seasonNumber={seasonNumber} initial={episodes} />

      {/* Neighboring seasons, so binge-marking does not mean going back up. */}
      {seasons.length > 1 && (
        <nav aria-label="Seasons" className="flex flex-wrap gap-2 pt-2">
          {seasons.map((s) => (
            <Link
              key={s.id}
              href={`/title/${slug}/s/${s.season_number}`}
              aria-current={s.season_number === seasonNumber ? 'page' : undefined}
              className="min-h-9 rounded-full px-3 py-1.5 text-xs"
              style={{
                border: `1px solid ${
                  s.season_number === seasonNumber ? 'var(--tl-accent)' : 'var(--tl-border)'
                }`,
                color: s.season_number === seasonNumber ? 'var(--tl-text)' : 'var(--tl-text-dim)',
              }}
            >
              {s.season_number === 0 ? 'Specials' : `S${s.season_number}`}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
