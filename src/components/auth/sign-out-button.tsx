'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearPrivateCaches } from '@/components/pwa/service-worker';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/auth/sign-out', { method: 'POST' });
        // Cached navigations hold this session's pages -- a Library, a rating
        // history. "Sign out, go offline, still see their list" is not a
        // defensible outcome, so the worker drops them too.
        await clearPrivateCaches();
        // Discard everything rendered for the signed-in user before leaving.
        router.refresh();
        router.push('/auth/signin');
      }}
      className="self-start rounded-full border px-4 py-2 text-sm disabled:opacity-60"
      style={{ borderColor: 'var(--tl-border-strong)', color: 'var(--tl-text)' }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
