import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAccountId, getSession } from '@/server/auth/session';
import { persona } from '@/server/repos/persona';

export const dynamic = 'force-dynamic';

/**
 * The persona card, as an image, WITHOUT a public URL behind it.
 *
 * This is the piece the title share card is missing and was reopened over:
 * `/s/[slug]/opengraph-image` is keyed on a share row, so the only way to see
 * what you are about to send is to first commit a permanent public link. Here
 * the card is rendered for the CURRENT SESSION and the bytes are handed
 * straight to the share sheet as a file, so there is a preview, there is no
 * URL, and there is nothing to revoke afterwards.
 *
 * Which also means: this route is private. It answers about whoever is signed
 * in, so it must never be cached, never be prerendered, and never accept an
 * account id from the caller. A cached response here is somebody else's taste
 * in your hands.
 */
export const size = { width: 1080, height: 1080 };

/**
 * The display face, vendored rather than fetched.
 *
 * Satori cannot resolve a font by name -- "Georgia" means nothing to it -- so
 * without a buffer the card renders in its default sans while the app around
 * it is serif. Reading it from disk keeps the route off the network: a share
 * sheet that stalls because fonts.gstatic.com is slow is a share that does not
 * happen.
 *
 * BOTH faces, because one is not a style. Satori treats the only font it is
 * given as the default for everything, so with the serif alone the counts and
 * their labels came out serif too -- and the whole look of this app is an
 * editorial headline over technical data. Mono for the numbers is not a
 * flourish; it is the same register the Universe uses.
 *
 * Scoped to this route deliberately. The app itself declares Instrument Serif
 * in --font-display and never loads it, so every heading in the product is
 * actually Georgia or ui-serif. That is worth fixing, but adding a webfont to
 * the runtime means a font-src in the CSP and a new cost against the LCP
 * budget, which is a different change from making a card look right.
 */
const cache = new Map<string, Buffer>();
async function font(file: string): Promise<Buffer> {
  let buf = cache.get(file);
  if (!buf) {
    buf = await readFile(join(process.cwd(), 'src/assets/fonts', file));
    cache.set(file, buf);
  }
  return buf;
}

const BG = '#0B0C0E';
const GOLD = '#E8C77A';

/**
 * Mix a color toward the page background.
 *
 * Satori supports linear-gradient, but not color-mix or any relative color
 * syntax, so the stops have to be computed here. `t` is how far toward
 * near-black: 0 is the accent at full strength, 1 is the page.
 */
function toward(hex: string, t: number): string {
  const h = hex.replace('#', '');
  const to = (i: number) => parseInt(h.slice(i * 2, i * 2 + 2), 16);
  const bg = [0x0b, 0x0c, 0x0e];
  const out = [0, 1, 2].map((i) => Math.round(to(i) * (1 - t) + bg[i]! * t));
  return `rgb(${out.join(',')})`;
}

export async function GET(): Promise<Response> {
  const accountId = await getAccountId();
  if (!accountId) return new Response('Not found', { status: 404 });

  const [p, session, serif, mono] = await Promise.all([
    persona(accountId),
    getSession(),
    font('InstrumentSerif-Regular.ttf'),
    font('GeistMono-Regular.ttf'),
  ]);
  const who = session?.user.name?.trim() || null;

  /* The accent comes from the poster of the thing they rated highest -- its
     own most chromatic region, extracted once and stored on the title. Gold
     is the fallback for a library with nothing rated and for a black-and-white
     poster that genuinely has no hue. */
  const accent = p.accent ?? GOLD;
  const poster = p.posterPath ? `https://image.tmdb.org/t/p/w185${p.posterPath}` : null;

  const body = (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        /* A field of color, not a photograph. The unfurl card learned this
           the expensive way: a 1200x630 PNG washed with a backdrop came out
           at 958KB, near the size where iMessage stops rendering previews.
           A gradient of flat color costs almost nothing in PNG, and it is
           what carries the look anyway -- the artwork sits ON the color
           rather than being it.

           The poster is the only photographic region and it is therefore the
           whole of the file size: at 268x402 this card weighed 345KB, past
           the 300KB the share test holds it to. 204x306 is the same
           composition for 40% fewer photographic pixels. */
        backgroundImage: `linear-gradient(160deg, ${toward(accent, 0.45)} 0%, ${toward(
          accent,
          0.82,
        )} 52%, ${BG} 100%)`,
        backgroundColor: BG,
        padding: 84,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div
          style={{
            display: 'flex',
            fontSize: 26,
            color: 'rgba(236,237,239,0.62)',
            letterSpacing: 4,
          }}
        >
          THROUGHLINE
        </div>
        {who && (
          <div style={{ display: 'flex', fontSize: 34, color: 'rgba(236,237,239,0.86)' }}>
            {who}
          </div>
        )}
      </div>

      {/* The art and the claim, side by side -- the Apple Music arrangement,
          where the cover anchors the color and the words sit beside it. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
        {poster && (
          /* Satori renders this to a PNG; next/image and alt text are for a
             DOM that will never exist. The card's own accessible description
             lives on the <img> that previews it in the page. */
          /* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */
          <img
            src={poster}
            width={204}
            height={306}
            style={{
              borderRadius: 14,
              /* A hairline inside the edge, the same device the poster grids
                 use, so artwork reads as artwork rather than as a hole. */
              border: '1px solid rgba(255,255,255,0.14)',
              objectFit: 'cover',
            }}
          />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
          <div
            style={{
              display: 'flex',
              fontFamily: 'Instrument Serif',
              /* Three steps, because a director's name can be long: "Jean-Pierre
                 Jeunet completist" is 29 characters and has to fit on one line
                 beside the poster. */
              fontSize: p.headline.length > 30 ? 56 : p.headline.length > 22 ? 70 : 90,
              color: '#FFFFFF',
              lineHeight: 1.0,
            }}
          >
            {p.headline}
          </div>
          {p.subhead && (
            <div style={{ display: 'flex', fontSize: 30, color: 'rgba(255,255,255,0.74)' }}>
              {p.subhead}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: 1,
            background: 'rgba(255,255,255,0.16)',
          }}
        />
        {/* Wrap rather than clip. Every value here is a short number by
            construction now, but a row that silently runs off the edge is how
            the last one failed, and wrapping costs nothing. */}
        <div style={{ display: 'flex', gap: 56, flexWrap: 'wrap' }}>
          {p.lines.map((l) => (
            <div key={l.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', fontSize: 44, color: '#FFFFFF' }}>{l.value}</div>
              <div
                style={{
                  display: 'flex',
                  fontSize: 22,
                  color: 'rgba(255,255,255,0.55)',
                  letterSpacing: 2,
                }}
              >
                {l.label.toUpperCase()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const res = new ImageResponse(body, {
    ...size,
    /* Mono FIRST: Satori uses the first entry as the default, and everything
       on this card is data except the one headline, which asks for the serif
       by name. */
    fonts: [
      { name: 'Geist Mono', data: mono, style: 'normal', weight: 400 },
      { name: 'Instrument Serif', data: serif, style: 'normal', weight: 400 },
    ],
  });
  /* Private and volatile: it changes as they watch things, and it is about
     one person. no-store rather than a short max-age, because a shared cache
     holding this would be a cross-account leak rather than a stale image. */
  res.headers.set('Cache-Control', 'private, no-store');
  return res;
}
