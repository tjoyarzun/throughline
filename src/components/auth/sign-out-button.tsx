'use client';

import { useState } from 'react';

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/auth/sign-out', { method: 'POST' });
        window.location.href = '/auth/signin';
      }}
      className="self-start rounded-full border px-4 py-2 text-sm disabled:opacity-60"
      style={{ borderColor: 'var(--tl-border-strong)', color: 'var(--tl-text)' }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
