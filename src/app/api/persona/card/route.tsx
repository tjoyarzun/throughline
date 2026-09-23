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
const DIM = '#9AA0A8';
const FAINT = '#61666E';

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

  const body = (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: BG,
        padding: 84,
      }}
    >
      {/* Square, not 1200x630. This one is posted rather than unfurled, and
          every surface people post to crops a landscape card. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', fontSize: 26, color: FAINT, letterSpacing: 4 }}>
          THROUGHLINE
        </div>
        {who && <div style={{ display: 'flex', fontSize: 34, color: DIM }}>{who}</div>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div
          style={{
            display: 'flex',
            fontFamily: 'Instrument Serif',
            fontSize: p.headline.length > 22 ? 92 : 120,
            color: '#ECEDEF',
            lineHeight: 1.0,
          }}
        >
          {p.headline}
        </div>
        {p.subhead && <div style={{ display: 'flex', fontSize: 36, color: GOLD }}>{p.subhead}</div>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* A hairline, the same device the app uses to separate registers. */}
        <div style={{ display: 'flex', width: '100%', height: 1, background: '#2A2E34' }} />
        <div style={{ display: 'flex', gap: 56 }}>
          {p.lines.map((l) => (
            <div key={l.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', fontSize: 44, color: '#ECEDEF' }}>{l.value}</div>
              <div style={{ display: 'flex', fontSize: 22, color: FAINT, letterSpacing: 2 }}>
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
