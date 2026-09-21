import type { Metadata, Viewport } from 'next';
import { BottomNav } from '@/components/ui/bottom-nav';
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
        <main id="main" className="mx-auto min-h-dvh w-full max-w-3xl px-4 pb-28 pt-4">
          {children}
        </main>
        <BottomNav />
      </body>
    </html>
  );
}
