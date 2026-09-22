import { ImageResponse } from 'next/og';
import { getPublicShare } from '@/server/repos/shares';
import { titleById } from '@/server/repos/titles';
import { posterUrl } from '@/lib/tmdb-image';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'A recommendation from Throughline';

/**
 * The unfurl card.
 *
 * Satori supports a SUBSET of CSS: flexbox only, no grid, no float, limited
 * background shorthand. Every element below therefore sets display flex
 * explicitly, and the star row is drawn as SVG paths rather than a glyph --
 * emoji stars render inconsistently across the renderers that fetch this.
 *
 * iMessage wants an absolute URL, explicit dimensions, and dislikes anything
 * much over 1MB. It also does not run JavaScript, which is why the page this
 * belongs to is server-rendered.
 */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const share = await getPublicShare(slug);
  const title = share ? await titleById(share.title_id) : null;

  const BG = '#0B0C0E';
  const GOLD = '#E8C77A';
  const DIM = '#9AA0A8';

  if (!share || !title) {
    return new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: BG,
          color: DIM,
          fontSize: 42,
        }}
      >
        Throughline
      </div>,
      size,
    );
  }

  const stars = share.rating_snapshot ? share.rating_snapshot / 2 : null;
  const accent = title.accent_color ?? GOLD;
  const poster = posterUrl(title.poster_path, 185);
  // NO full-bleed backdrop.
  //
  // ImageResponse always emits PNG, and PNG compresses photographic detail
  // terribly: a 1200x630 card washed with a backdrop came out at 958KB, past
  // the 300KB target and close to the ~1MB where iMessage stops rendering
  // previews at all. Dropping to a w300 source barely helped -- the cost is
  // the upscaled noise, not the source.
  //
  // The poster carries the image, and it is only 340px wide. Everything
  // behind it is a flat gradient in the title's own accent, which PNG stores
  // in almost nothing. Smaller AND more on-brand than a dimmed still.
  const note = (share.message ?? share.note_snapshot ?? '').slice(0, 120);

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        background: BG,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          background: `linear-gradient(115deg, ${BG} 45%, ${accent}33 100%)`,
        }}
      />

      <div style={{ display: 'flex', position: 'relative', padding: 56, gap: 44, width: '100%' }}>
        {poster && (
          // eslint-disable-next-line @next/next/no-img-element -- Satori needs a plain img
          <img
            src={poster}
            alt=""
            width={340}
            height={510}
            style={{ borderRadius: 12, objectFit: 'cover' }}
          />
        )}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            justifyContent: 'center',
            gap: 18,
          }}
        >
          <div style={{ display: 'flex', fontSize: 62, color: '#ECEDEF', lineHeight: 1.1 }}>
            {title.title.slice(0, 60)}
          </div>
          <div style={{ display: 'flex', fontSize: 26, color: DIM, letterSpacing: 2 }}>
            {[title.release_year, title.runtime_minutes ? `${title.runtime_minutes} MIN` : null]
              .filter(Boolean)
              .join('  ·  ')}
          </div>

          {stars !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
              {[0, 1, 2, 3, 4].map((i) => {
                const d = stars - i;
                const fill = d >= 1 ? GOLD : d >= 0.5 ? 'url(#h)' : 'none';
                return (
                  <svg key={i} width="44" height="44" viewBox="0 0 24 24">
                    <defs>
                      <linearGradient id="h">
                        <stop offset="50%" stopColor={GOLD} />
                        <stop offset="50%" stopColor="transparent" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M12 2.6l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.45 6.19 20.5l1.11-6.47L2.6 9.45l6.5-.95z"
                      fill={fill}
                      stroke={GOLD}
                      strokeWidth="1.4"
                    />
                  </svg>
                );
              })}
              <div style={{ display: 'flex', fontSize: 26, color: DIM, marginLeft: 10 }}>
                {share.display_name ?? 'Someone'}
              </div>
            </div>
          )}

          {note && (
            <div
              style={{
                display: 'flex',
                fontSize: 28,
                color: '#ECEDEF',
                borderLeft: `4px solid ${GOLD}`,
                paddingLeft: 18,
                marginTop: 8,
              }}
            >
              {note}
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 28,
          left: 56,
          right: 56,
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 20,
          color: DIM,
        }}
      >
        <div style={{ display: 'flex' }}>Data from TMDB</div>
        <div style={{ display: 'flex', color: GOLD, letterSpacing: 3 }}>THROUGHLINE</div>
      </div>
    </div>,
    size,
  );
}
