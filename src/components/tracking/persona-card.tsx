'use client';

import { useState } from 'react';

/**
 * The card, shown before anything is shared.
 *
 * That ordering is the point. The title share card works the other way round
 * -- tap Share, a permanent public URL is created, and only then does a card
 * exist to send -- which means you commit before you can see what you are
 * committing to. Here the image is just rendered for the current session, so
 * the preview IS the artifact and nothing is published until a share sheet is
 * actually confirmed.
 *
 * Shared as a FILE, not a link, for the same reason: there is no public page
 * for somebody's taste and there should not be one. The bytes go to the share
 * sheet and no row is written anywhere.
 */
export function PersonaCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- rendered per
          request by our own route; the optimizer would cache a private image */}
      <img
        src="/api/persona/card"
        alt="A summary card of your viewing: the strongest thread through what you have watched, with counts."
        width={1080}
        height={1080}
        className="w-full"
        style={{
          /* Capped, and deliberately not full-bleed. This is a PREVIEW of
             something you are about to send, not page content -- at the full
             column width it was 358px on a phone and 768px on a desktop,
             which reads as the subject of the page rather than as an object
             on it. Small enough to be legible at a glance, large enough that
             the headline is readable before you commit to sharing it. */
          maxWidth: '18rem',
          aspectRatio: '1 / 1',
          borderRadius: 12,
          border: '1px solid var(--tl-border)',
          background: 'var(--tl-surface)',
        }}
      />

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          className="min-h-11 rounded-full px-4 text-sm"
          style={{ border: '1px solid var(--tl-accent)', color: 'var(--tl-text)' }}
          onClick={async () => {
            setError(null);
            setBusy(true);
            try {
              const res = await fetch('/api/persona/card');
              if (!res.ok) throw new Error('could not render the card');
              const file = new File([await res.blob()], 'throughline.png', { type: 'image/png' });

              /**
               * The await above has already spent the user gesture on iOS, so
               * share() may refuse. That is acceptable HERE and not on the
               * title card: this button's whole job is the image, so there is
               * nothing to do before fetching it, and the clipboard fallback
               * below still leaves them with the card. The title card
               * prefetches instead, because there it has a share row to
               * create anyway.
               */
              if (navigator.canShare?.({ files: [file] })) {
                await navigator.share({ files: [file] });
              } else if (navigator.clipboard && 'ClipboardItem' in window) {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': file })]);
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
              } else {
                setError('This browser will not let a page hand over an image.');
              }
            } catch (e) {
              // A dismissed share sheet rejects too; that is not an error.
              if (!(e instanceof DOMException && e.name === 'AbortError')) {
                setError('Could not share the card. Try again?');
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Preparing…' : copied ? 'Copied' : 'Share this card'}
        </button>
      </div>

      {error && (
        <p role="status" className="text-xs" style={{ color: 'var(--tl-negative)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
