import { BottomNav } from '@/components/ui/bottom-nav';

/**
 * The app shell: bottom navigation and the reading column.
 *
 * A route group rather than a pathname check in the root layout. The auth
 * pages previously rendered INSIDE this shell, inheriting `pb-28` reserved for
 * a nav that was hidden on those routes — which made a page that should fit
 * exactly 128px taller than the viewport, and the resulting rubber-band
 * overscroll showed the browser canvas as bands behind the form.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <main id="main" className="mx-auto min-h-dvh w-full max-w-3xl px-4 pb-28 pt-4">
        {children}
      </main>
      <BottomNav />
    </>
  );
}
