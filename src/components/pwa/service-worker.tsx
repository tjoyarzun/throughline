'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Registers the service worker.
 *
 * Fire-and-forget and failure-tolerant: a worker that cannot install is a
 * missing optimization, not a broken app, and throwing here would take the
 * page down for a feature nobody asked for.
 */
export function ServiceWorkerRegistrar() {
  const router = useRouter();

  /**
   * The worker now paints the last-seen page immediately and checks the
   * network behind it, so the first frame can be a few minutes old. This is
   * the half that corrects it: when the revalidation comes back the worker
   * says so, and refresh() re-fetches the RSC payload in place.
   *
   * Without it the reader keeps seeing their previous visit until they
   * navigate -- fine for a poster grid, wrong for "I marked that watched on
   * the laptop". Scoped to the CURRENT url: a message about a page nobody is
   * looking at is not worth a re-render.
   */
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'PAGE_REVALIDATED') return;
      try {
        if (new URL(event.data.url).pathname === window.location.pathname) router.refresh();
      } catch {
        // A malformed url is not a reason to take the page down.
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [router]);

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
