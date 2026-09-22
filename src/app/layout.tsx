import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';

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
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-icon-180.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FBFAF8' },
    { media: '(prefers-color-scheme: dark)', color: '#0B0C0E' },
  ],
};

/**
 * Root layout holds only the document and the skip link. The app shell lives in
 * the (app) route group and auth pages in (auth), so neither inherits chrome
 * meant for the other.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-US">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:px-3 focus:py-2"
          style={{ background: 'var(--tl-surface)', color: 'var(--tl-text)' }}
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
