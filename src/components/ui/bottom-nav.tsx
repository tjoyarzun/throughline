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
 * The active tab is marked by an indicator bar plus aria-current, never by
 * accent-colored text alone — light-mode accent is 3.35:1 and would fail AA as
 * text, and color alone would fail SC 1.4.1 regardless.
 */
const TABS = [
  { href: '/', label: 'Home' },
  { href: '/search', label: 'Search' },
  { href: '/library', label: 'Library' },
  { href: '/universe', label: 'Universe' },
  { href: '/me', label: 'Me' },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur"
      style={{
        background: 'color-mix(in srgb, var(--tl-bg) 88%, transparent)',
        borderColor: 'var(--tl-border)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <ul className="mx-auto flex max-w-3xl">
        {TABS.map((tab) => {
          const active = isActive(tab.href);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className="relative flex h-14 flex-col items-center justify-center gap-1 text-xs"
                style={{ color: active ? 'var(--tl-text)' : 'var(--tl-text-dim)' }}
              >
                <span
                  aria-hidden
                  className="h-0.5 w-6 rounded-full transition-colors"
                  style={{ background: active ? 'var(--tl-accent)' : 'transparent' }}
                />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
