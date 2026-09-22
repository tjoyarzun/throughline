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

export function BottomNav() {
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
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className="flex h-16 flex-col items-center justify-center gap-1"
                style={{ color: active ? 'var(--tl-text)' : 'var(--tl-text-dim)' }}
              >
                <Icon active={active} />
                <span
                  className="text-[11px] leading-none"
                  style={{ fontWeight: active ? 600 : 400 }}
                >
                  {tab.label}
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

function now({ active }: { active: boolean }) {
  return (
    <Svg>
      <path d="M3 10.5 12 3l9 7.5" />
      <path
        d="M5.5 9.5V20h13V9.5"
        fill={active ? 'currentColor' : 'none'}
        opacity={active ? 0.16 : 1}
      />
      <path d="M5.5 9.5V20h13V9.5" />
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
