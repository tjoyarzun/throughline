'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { revokeShareAction } from '@/actions/shares';
import type { MyShare } from '@/server/repos/shares';

/**
 * Links you have handed out, and the way to take them back.
 *
 * Revocation without a way to reach it is not revocation. This is the only
 * surface that lists your shares -- the share row itself is reachable by slug
 * alone, so nothing else can enumerate them, including you.
 */
export function ShareList({ shares }: { shares: MyShare[] }) {
  const [revoked, setRevoked] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  if (shares.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--tl-text-dim)' }}>
        Nothing shared yet. The share button on any title makes a link.
      </p>
    );
  }

  return (
    <ul
      className="flex flex-col divide-y rounded-xl border"
      style={{ borderColor: 'var(--tl-border)', background: 'var(--tl-surface)' }}
    >
      {shares.map((s) => {
        const gone = revoked.has(s.slug);
        return (
          <li key={s.slug} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="flex min-w-0 flex-col">
              <Link
                href={`/s/${s.slug}`}
                className="truncate text-sm"
                style={{ textDecoration: gone ? 'line-through' : 'none' }}
              >
                {s.title}
              </Link>
              <span
                className="text-[10px] tabular-nums"
                style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
              >
                {s.rating_snapshot ? `${s.rating_snapshot / 2}★ · ` : ''}
                {s.view_count} {s.view_count === 1 ? 'view' : 'views'}
              </span>
            </span>
            <button
              type="button"
              disabled={gone || pending}
              className="min-h-9 shrink-0 rounded-full px-3 text-xs"
              style={{
                border: `1px solid ${gone ? 'var(--tl-border)' : 'var(--tl-border-strong)'}`,
                color: gone ? 'var(--tl-text-dim)' : 'var(--tl-negative)',
              }}
              onClick={() =>
                startTransition(async () => {
                  const res = await revokeShareAction({ slug: s.slug });
                  if (res.ok) setRevoked((prev) => new Set(prev).add(s.slug));
                })
              }
            >
              {gone ? 'Revoked' : 'Revoke'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
