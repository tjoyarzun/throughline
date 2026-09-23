import { cookies } from 'next/headers';
import { BottomNav } from '@/components/ui/bottom-nav';
import { SEEN_COOKIE, hasUnreadRelease } from '@/lib/whats-new';

/**
 * The app shell: bottom navigation and the reading column.
 *
 * A route group rather than a pathname check in the root layout. The auth
 * pages previously rendered INSIDE this shell, inheriting `pb-28` reserved for
 * a nav that was hidden on those routes — which made a page that should fit
 * exactly 128px taller than the viewport, and the resulting rubber-band
 * overscroll showed the browser canvas as bands behind the form.
 *
 * Padding is expressed against the safe-area insets rather than as fixed
 * values. On an installed iPhone the viewport runs edge to edge, so a flat
 * `pt-4` puts the first line under the status bar and a flat `pb-28` leaves
 * the last row beneath the home indicator. The insets are zero everywhere
 * else, so the same rule is correct on desktop.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  /* Read in the shell so the mark is on the nav from the first paint, rather
     than appearing a beat later once a client component has mounted. Every
     route in this group is force-dynamic already, so a cookie read here costs
     no cacheability. */
  const seen = (await cookies()).get(SEEN_COOKIE)?.value;

  return (
    <>
      <main
        id="main"
        className="mx-auto w-full max-w-3xl px-4"
        style={{
          minHeight: '100dvh',
          paddingTop: 'calc(env(safe-area-inset-top) + 1rem)',
          // Clears the fixed nav (64px) plus its own safe-area padding.
          paddingBottom: 'calc(env(safe-area-inset-bottom) + 5.5rem)',
        }}
      >
        {children}
      </main>
      <BottomNav unread={hasUnreadRelease(seen)} />
    </>
  );
}
