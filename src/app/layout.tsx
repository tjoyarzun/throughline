import type { Metadata, Viewport } from 'next';
import '@/styles/globals.css';

export const metadata: Metadata = {
  title: { default: 'Throughline', template: '%s · Throughline' },
  description: 'A media tracker that understands how things connect.',
  applicationName: 'Throughline',
  appleWebApp: { capable: true, title: 'Throughline', statusBarStyle: 'black-translucent' },
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
