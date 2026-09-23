import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import '@/styles/globals.css';
import { THEME_COOKIE, isTheme, themeAttribute } from '@/lib/theme';
import { ServiceWorkerRegistrar } from '@/components/pwa/service-worker';
import { OfflineBanner } from '@/components/pwa/offline-banner';

/**
 * The origin Next resolves relative metadata URLs against.
 *
 * Without it, og:image is built from whatever origin Next can guess -- in
 * production that is the per-DEPLOYMENT hostname, which changes on every push
 * and is not the address anyone was given. iMessage requires an absolute
 * og:image and does not run JavaScript, so a wrong origin there is a share
 * link that unfurls as nothing.
 */
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: 'Throughline', template: '%s · Throughline' },
  description: 'A media tracker that understands how things connect.',
  applicationName: 'Throughline',
  /**
   * statusBarStyle 'default', NOT 'black-translucent'.
   *
   * black-translucent extends the web view UNDER the status bar and makes it
   * the page's job to pad it back. Nothing did, so on an installed iPhone the
   * first line of every screen sat beneath the clock. It also forces white
   * status-bar text, which is unreadable in light mode. 'default' has iOS
   * inset the view and fill the bar with themeColor.
   *
   * The shell still pads by env(safe-area-inset-top) as well -- that is zero
   * here and non-zero in a browser tab, and being right in both is cheap.
   */
  appleWebApp: { capable: true, title: 'Throughline', statusBarStyle: 'default' },
  /**
   * The small sizes are a SIMPLIFIED mark, not a downscale.
   *
   * At 16 and 32 pixels the three nodes on the arc merge into a smudge, so
   * those two drop the middle node and thicken the stroke. Listing them means
   * the browser picks one rather than resampling the 192 into mush.
   */
  icons: {
    icon: [
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-icon-180.png', sizes: '180x180', type: 'image/png' }],
  },
};

/**
 * themeColor has to follow the stored choice, not only the device.
 *
 * It paints the iOS status bar and the Android toolbar, and the media-query
 * form answers to prefers-color-scheme alone. Choose Light on a phone set to
 * dark and the page turns warm paper while the bar above it stays near-black
 * -- the one seam where an explicit choice visibly fails to take. When a
 * choice exists it is stated flatly; 'system' keeps the media pair.
 */
const BG = { light: '#FBFAF8', dark: '#0B0C0E' } as const;

export async function generateViewport(): Promise<Viewport> {
  const stored = (await cookies()).get(THEME_COOKIE)?.value;
  const chosen = themeAttribute(isTheme(stored) ? stored : 'system');

  return {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    interactiveWidget: 'resizes-content',
    themeColor: chosen
      ? BG[chosen]
      : [
          { media: '(prefers-color-scheme: light)', color: BG.light },
          { media: '(prefers-color-scheme: dark)', color: BG.dark },
        ],
  };
}

/**
 * Root layout holds only the document and the skip link. The app shell lives in
 * the (app) route group and auth pages in (auth), so neither inherits chrome
 * meant for the other.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  /* The stored choice, applied to the first paint rather than patched in
     afterwards. Every route here is force-dynamic already, so reading a cookie
     in the root layout costs no cacheability. */
  const stored = (await cookies()).get(THEME_COOKIE)?.value;
  const theme = themeAttribute(isTheme(stored) ? stored : 'system');

  return (
    <html lang="en-US" {...(theme ? { 'data-theme': theme } : {})}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:px-3 focus:py-2"
          style={{ background: 'var(--tl-surface)', color: 'var(--tl-text)' }}
        >
          Skip to content
        </a>
        <OfflineBanner />
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
