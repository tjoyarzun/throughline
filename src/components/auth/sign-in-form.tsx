'use client';

import { useState } from 'react';

/**
 * Email OTP sign-in.
 *
 * A six-digit code rather than a magic link: on a phone a magic link opens in
 * whichever browser handles mail, which is frequently not the one the person
 * started in, and the session lands in the wrong place. A code can be typed
 * where they already are.
 *
 * Passkeys are the intended primary method (Face ID makes them by far the best
 * experience here) and slot in above this once registration flow exists.
 */
type Stage = 'email' | 'code' | 'sent';

export function SignInForm({ next }: { next: string }) {
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/sign-in/email-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, inviteCode: inviteCode || undefined }),
      });
      if (!res.ok) throw new Error((await res.text()) || 'Could not send a code');
      setStage('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/sign-in/email-otp/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, otp: code }),
      });
      if (!res.ok) throw new Error('That code did not work');
      window.location.href = next;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const field = {
    background: 'var(--tl-surface)',
    borderColor: 'var(--tl-border-strong)',
    color: 'var(--tl-text)',
  };

  return (
    <form onSubmit={stage === 'email' ? requestCode : verify} className="flex flex-col gap-4">
      {stage === 'email' ? (
        <>
          <label className="flex flex-col gap-1.5 text-sm">
            Email
            <input
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              enterKeyHint="go"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border px-3 py-2.5 text-base"
              style={field}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Invite code
            <span className="text-xs" style={{ color: 'var(--tl-text-faint)' }}>
              Only needed the first time.
            </span>
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              autoComplete="one-time-code"
              className="rounded-lg border px-3 py-2.5 font-mono text-base"
              style={field}
            />
          </label>
        </>
      ) : (
        <label className="flex flex-col gap-1.5 text-sm">
          Six-digit code
          <span className="text-xs" style={{ color: 'var(--tl-text-faint)' }}>
            Sent to {email}
          </span>
          <input
            required
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="rounded-lg border px-3 py-2.5 text-center font-mono text-2xl tracking-[0.3em]"
            style={field}
          />
        </label>
      )}

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--tl-negative)' }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="rounded-full px-4 py-3 text-base font-medium disabled:opacity-60"
        style={{ background: 'var(--tl-text)', color: 'var(--tl-bg)' }}
      >
        {busy ? 'Working…' : stage === 'email' ? 'Send me a code' : 'Sign in'}
      </button>

      {stage === 'code' && (
        <button
          type="button"
          onClick={() => setStage('email')}
          className="text-sm underline"
          style={{ color: 'var(--tl-text-dim)' }}
        >
          Use a different email
        </button>
      )}
    </form>
  );
}
