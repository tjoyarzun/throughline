/**
 * The navigation fallback when the network is gone and nothing is cached.
 *
 * Deliberately outside the (app) route group: it must not depend on a session,
 * a database, or the bottom nav, because the whole point is that none of those
 * are reachable. Fully static, so the service worker can precache it.
 */
export const metadata = { title: 'Offline' };

export default function OfflinePage() {
  return (
    <main
      className="mx-auto flex w-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center"
      style={{ minHeight: '100dvh' }}
    >
      <h1 className="text-3xl">No connection.</h1>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--tl-text-dim)' }}>
        Pages you have already opened are still here. Anything new — searching, or marking something
        watched — needs the network.
      </p>
      <p className="pt-2 text-xs" style={{ color: 'var(--tl-text-dim)' }}>
        This page will work again the moment you are back.
      </p>
    </main>
  );
}
