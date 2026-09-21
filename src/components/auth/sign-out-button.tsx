'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/auth/sign-out', { method: 'POST' });
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
