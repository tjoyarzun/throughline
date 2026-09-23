import Link from 'next/link';
import { headers } from 'next/headers';

/**
 * Back, to the screen you actually came from.
 *
 * Installed as a PWA there is no browser chrome, so a deep page with no back
 * control is a dead end: you tap a poster in Library, read it, and the only
 * way out is the tab bar, which loses your place in the grid.
 *
 * Resolved SERVER-side from the Referer header rather than by calling
 * history.back() on the client, for three reasons. It works before hydration
 * and with scripting off. It can be labeled -- "Library" rather than a bare
 * arrow -- which is the difference between a control you can aim and one you
 * have to try. And it is a real link: middle-clickable, and never a dead end,
 * because an absent or off-site referrer falls back to a parent that always
 * exists rather than to a history entry that may not.
 *
 * Next sends Referer on the RSC request for a soft navigation too, so this is
 * not limited to full page loads. Verified in a browser, not assumed.
 */
const LABELS: [RegExp, string][] = [
  [/^\/$/, 'Now'],
  [/^\/search/, 'Search'],
  [/^\/library/, 'Library'],
  [/^\/universe\/connect/, 'Throughline'],
  [/^\/universe\/me/, 'My universe'],
  [/^\/universe/, 'Universe'],
  [/^\/me/, 'Me'],
  [/^\/person\//, 'Person'],
  [/^\/title\//, 'Title'],
  [/^\/explore/, 'Explore'],
];

function labelFor(path: string): string {
  return LABELS.find(([re]) => re.test(path))?.[1] ?? 'Back';
}

export async function BackLink({
  fallback = '/',
  /** Paths this page IS -- never offer to go back to where you already are. */
  self,
}: {
  fallback?: string;
  self?: string;
}) {
  const h = await headers();
  const referer = h.get('referer');
  const host = h.get('host');

  let target = fallback;
  if (referer && host) {
    try {
      const u = new URL(referer);
      /* Same-origin only. A referrer from anywhere else is somebody arriving
         from a share link or a search engine, and sending them "back" to
         another site is not a back button. */
      const sameOrigin = u.host === host;
      const path = u.pathname + u.search;
      if (sameOrigin && !u.pathname.startsWith('/auth') && u.pathname !== self) target = path;
    } catch {
      // An unparsable Referer is not worth an error page.
    }
  }

  return (
    <Link
      href={target}
      className="inline-flex min-h-11 items-center gap-1 self-start text-xs"
      style={{ color: 'var(--tl-text-dim)' }}
    >
      <span aria-hidden="true">←</span>
      {labelFor(new URL(target, 'http://x').pathname)}
    </Link>
  );
}
