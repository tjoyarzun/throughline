'use client';

import { useEffect, useState } from 'react';

/**
 * Says so when the network is gone.
 *
 * navigator.onLine is read IN AN EFFECT, never during render: the server has
 * no such value, so rendering from it would hydrate a different tree than the
 * server produced. It starts as online and corrects itself on mount.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 z-50 px-4 text-center text-xs"
      style={{
        // Below the status bar on an installed phone, where the viewport runs
        // edge to edge.
        top: 0,
        paddingTop: 'calc(env(safe-area-inset-top) + 0.5rem)',
        paddingBottom: '0.5rem',
        background: 'var(--tl-surface-2)',
        color: 'var(--tl-text-dim)',
        borderBottom: '1px solid var(--tl-border)',
      }}
    >
      Offline — showing what you already opened. Changes will not save.
    </div>
  );
}
