'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker.
 *
 * Fire-and-forget and failure-tolerant: a worker that cannot install is a
 * missing optimization, not a broken app, and throwing here would take the
 * page down for a feature nobody asked for.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    // Registering during load contends for bandwidth with the page's own
    // requests, on exactly the connection this is meant to help.
    const onLoad = () => {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    };
    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad, { once: true });
    return () => window.removeEventListener('load', onLoad);
  }, []);
  return null;
}

/** Tell the worker to drop cached pages. Called on sign-out. */
export async function clearPrivateCaches(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  reg?.active?.postMessage({ type: 'CLEAR_PRIVATE_CACHES' });
}
