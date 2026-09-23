'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Five tabs, thumb-reachable, safe-area aware.
 *
 * Universe sits in PRIMARY navigation on purpose: the ontology is a destination,
 * not an Easter egg. Home never depends on it, so a user who ignores it loses
 * nothing. See docs/product.md.
 *
 * The active tab is marked by an icon, a weight change and aria-current, never
 * by accent-colored text alone — light-mode accent is 3.35:1 and would fail AA
 * as text, and color alone would fail SC 1.4.1 regardless.
 *
 * Icons are inline SVG rather than a font or a sprite: five glyphs do not
 * justify a dependency, and inline paths inherit currentColor for free.
 */
const TABS = [
  // "Now", not "Home". The tab is not a homepage -- it answers "what am I in
  // the middle of, and what is next", which is a different question and the
  // one people actually open the app for.
  { href: '/', label: 'Now', icon: now },
  { href: '/search', label: 'Search', icon: search },
  { href: '/library', label: 'Library', icon: library },
  { href: '/universe', label: 'Universe', icon: universe },
  { href: '/me', label: 'Me', icon: me },
] as const;

export function BottomNav({ unread = false }: { unread?: boolean }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur"
      style={{
        background: 'color-mix(in srgb, var(--tl-bg) 92%, transparent)',
        borderColor: 'var(--tl-border)',
        // The home indicator sits in this strip on a modern iPhone. Without
        // it the last row of tabs is half-covered and hard to hit.
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <ul className="mx-auto flex max-w-3xl">
        {TABS.map((tab) => {
          const active = isActive(tab.href);
          const Icon = tab.icon;
          /* Hidden while the notes are open: middleware marks them read on
             this very request, so the cookie the server rendered with is one
             navigation stale and the dot would otherwise sit there accusing
             you of not having read the page you are reading. */
          const dot = unread && tab.href === '/me' && pathname !== '/whats-new';
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className="flex h-16 flex-col items-center justify-center gap-1"
                style={{ color: active ? 'var(--tl-text)' : 'var(--tl-text-dim)' }}
              >
                <span className="relative">
                  <Icon active={active} />
                  {/* The unread mark, on Me only. Positioned on the ICON
                      rather than beside the label so it reads as a badge
                      instead of as punctuation. */}
                  {dot && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-1 -top-0.5 block size-2 rounded-full"
                      style={{
                        background: 'var(--tl-accent)',
                        // A ring in the bar's own color, so the dot stays
                        // legible where it overlaps the icon's stroke.
                        boxShadow: '0 0 0 2px var(--tl-bg)',
                      }}
                    />
                  )}
                </span>
                <span
                  className="text-[11px] leading-none"
                  style={{ fontWeight: active ? 600 : 400 }}
                >
                  {tab.label}
                  {/* A colored dot is invisible to a screen reader and to
                      anyone who cannot distinguish it (SC 1.4.1). The tab
                      announces "Me, new" instead. */}
                  {dot && <span className="sr-only">, new</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** 24px keeps the glyph legible without crowding the label. */
function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

/**
 * A clock, not a house.
 *
 * The tab is called Now because it is not a homepage: it answers "what am I
 * in the middle of, and what is next". A house says "start here", which is a
 * weaker promise and also the one glyph every other app on the phone is
 * already using.
 *
 * Two earlier attempts were better ideas than glyphs, and both were discarded
 * after rendering them at actual size rather than reasoning about them:
 *
 *   A playhead on a timeline. Three overlapping parts inside 24 pixels came
 *   out as a small gem with fins.
 *
 *   A progress ring. With a dimmed track behind it the two strokes merged and
 *   it read as a record button; without one it read as a loading spinner,
 *   which tells somebody the app is busy when it is not.
 *
 * A clock is plainer than either and survives the size. It also happens to be
 * the literal word on the label, and a deliberately non-round time -- ten
 * past ten is the watch-advertisement pose -- keeps both hands legible
 * instead of overlapping at twelve.
 */
function now({ active }: { active: boolean }) {
  return (
    <Svg>
      <circle
        cx="12"
        cy="12"
        r="8.5"
        fill={active ? 'currentColor' : 'none'}
        opacity={active ? 0.16 : 1}
      />
      <circle cx="12" cy="12" r="8.5" />
      {/* Hands. Filled when active, matching how every other tab here marks
          its state, so it never rests on color alone (SC 1.4.1). */}
      <path d="M12 7.2V12l3.4 2" />
    </Svg>
  );
}

function search() {
  return (
    <Svg>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </Svg>
  );
}

function library({ active }: { active: boolean }) {
  return (
    <Svg>
      <rect
        x="3.5"
        y="4"
        width="5"
        height="16"
        rx="1.2"
        fill={active ? 'currentColor' : 'none'}
        opacity={active ? 0.16 : 1}
      />
      <rect x="3.5" y="4" width="5" height="16" rx="1.2" />
      <rect x="10" y="4" width="5" height="16" rx="1.2" />
      <path d="m17.2 5.4 3.4 15" />
    </Svg>
  );
}

/** A throughline: nodes joined by a path. The same mark as the app icon. */
function universe({ active }: { active: boolean }) {
  return (
    <Svg>
      <path d="M5 17.5C7 9.5 9.5 6.5 12 6.5s4 4 7 11" opacity={0.9} />
      <circle cx="5" cy="17.5" r="2.1" fill={active ? 'currentColor' : 'none'} />
      <circle cx="12" cy="6.5" r="2.1" fill={active ? 'currentColor' : 'none'} />
      <circle cx="19" cy="17.5" r="2.1" fill={active ? 'currentColor' : 'none'} />
    </Svg>
  );
}

function me({ active }: { active: boolean }) {
  return (
    <Svg>
      <circle
        cx="12"
        cy="8.5"
        r="3.8"
        fill={active ? 'currentColor' : 'none'}
        opacity={active ? 0.16 : 1}
      />
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.8 20c1.4-3.6 4-5.4 7.2-5.4s5.8 1.8 7.2 5.4" />
    </Svg>
  );
}
