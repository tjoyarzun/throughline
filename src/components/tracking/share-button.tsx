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
 *
 * The card image sits BESIDE the link rather than replacing it, and that is a
 * deliberate disagreement with the shape of the request. A link unfurls into
 * a rich preview in Messages and WhatsApp AND stays tappable, so it is
 * strictly the better thing to send to a person; an image is the better thing
 * to post somewhere that will not unfurl anything. Both exist; the link stays
 * first.
 */
export function ShareButton({ titleId, title }: { titleId: string; title: string }) {
  const [slug, setSlug] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * The card, fetched while the share row is being created.
   *
   * Prefetched precisely because of the activation trap above: fetching the
   * PNG at tap time is an await before share(), which is the thing that
   * silently kills the sheet on iOS. Holding the File means the second tap
   * calls share() synchronously, exactly as the link path does.
   */
  const [card, setCard] = useState<File | null>(null);

  const url = slug
    ? `${typeof window === 'undefined' ? '' : window.location.origin}/s/${slug}`
    : null;

  if (!url) {
    return (
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          disabled={pending}
          className="min-h-11 rounded-full px-4 text-sm"
          style={{ border: '1px solid var(--tl-border-strong)', color: 'var(--tl-text)' }}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await createShareAction({ titleId });
              if (!res.ok) {
                /* The action's own words, not a generic retry prompt. Hitting
                 the twenty-an-hour cap used to render "Try again", which
                 invites you to retry into the same wall indefinitely and says
                 nothing about why. */
                setError(res.error);
                return;
              }
              setSlug(res.slug);
              // Best effort: the link path must not depend on this landing.
              try {
                const png = await fetch(`/s/${res.slug}/opengraph-image`);
                if (png.ok) {
                  setCard(
                    new File([await png.blob()], `${slugify(title)}.png`, { type: 'image/png' }),
                  );
                }
              } catch {
                // No card; the link button below is unaffected.
              }
            });
          }}
        >
          {pending ? 'Creating link…' : error ? 'Try again' : 'Share'}
        </button>
        {error && (
          <p role="status" className="max-w-56 text-xs" style={{ color: 'var(--tl-negative)' }}>
            {error}
          </p>
        )}
      </div>
    );
  }

  /* Asked with the real File rather than a placeholder: support for sharing
     files is per-type, and a browser that shares text may refuse a PNG. */
  const canSendCard = Boolean(card) && (navigator.canShare?.({ files: [card!] }) ?? false);

  return (
    <div className="flex gap-2">
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

      {canSendCard && (
        <button
          type="button"
          className="min-h-11 rounded-full px-4 text-sm"
          style={{ border: '1px solid var(--tl-border-strong)', color: 'var(--tl-text)' }}
          onClick={() => {
            /* Synchronous, with the File already in hand. A download link is
               not an option: the sandbox this page runs in blocks a page from
               starting its own download, so <a download> is inert on iOS. */
            void navigator.share({ files: [card!], title }).catch(() => {
              /* dismissed */
            });
          }}
        >
          Send card
        </button>
      )}
    </div>
  );
}

/** A filename the recipient sees in their photo roll, not a nanoid. */
function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 48) || 'throughline'
  );
}
