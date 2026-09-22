'use client';

import { useState, useTransition } from 'react';
import { createShareAction } from '@/actions/shares';

/**
 * Create a share and hand it to the system share sheet.
 *
 * THE USER-ACTIVATION TRAP: navigator.share() must be called from within a
 * user gesture, and on iOS Safari any await before it loses that activation --
 * the sheet then silently refuses to open. So the share row is created FIRST,
 * on a separate tap, and the second tap does nothing but share. Two taps that
 * work beat one that fails on the platform this app is built for.
 */
export function ShareButton({ titleId, title }: { titleId: string; title: string }) {
  const [slug, setSlug] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  const url = slug
    ? `${typeof window === 'undefined' ? '' : window.location.origin}/s/${slug}`
    : null;

  if (!url) {
    return (
      <button
        type="button"
        disabled={pending}
        className="min-h-11 rounded-full px-4 text-sm"
        style={{ border: '1px solid var(--tl-border-strong)', color: 'var(--tl-text)' }}
        onClick={() => {
          setError(false);
          startTransition(async () => {
            const res = await createShareAction({ titleId });
            if (res.ok) setSlug(res.slug);
            else setError(true);
          });
        }}
      >
        {pending ? 'Creating link…' : error ? 'Try again' : 'Share'}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="min-h-11 rounded-full px-4 text-sm"
      style={{ border: '1px solid var(--tl-accent)', color: 'var(--tl-accent)' }}
      onClick={() => {
        // No await before share(): the gesture is still live here.
        if (navigator.canShare?.({ url })) {
          void navigator.share({ title, url }).catch(() => {
            /* dismissed */
          });
          return;
        }
        void navigator.clipboard.writeText(url).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        });
      }}
    >
      {copied ? 'Link copied' : 'Send link'}
    </button>
  );
}
