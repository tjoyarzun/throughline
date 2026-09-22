'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteAccountAction } from '@/actions/account';
import { clearPrivateCaches } from '@/components/pwa/service-worker';
import type { DeletionReceipt } from '@/server/repos/account';

const dim = { color: 'var(--tl-text-dim)' } as const;
const mono = { fontFamily: 'var(--font-mono)' } as const;

/**
 * Your data: taking a copy, and taking it away.
 *
 * The two live together because they are the same promise from opposite
 * ends -- you can have all of it, and you can end all of it -- and putting
 * the export directly above the danger zone means the copy is one tap away
 * at the moment anyone would most want it.
 */
export function DataSection({ email }: { email: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState('');
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<DeletionReceipt[] | null>(null);
  const [pending, startTransition] = useTransition();

  if (receipt) {
    const total = receipt.reduce((n, r) => n + r.rows_deleted, 0);
    return (
      <div
        className="flex flex-col gap-3 rounded-xl border p-4"
        style={{ borderColor: 'var(--tl-border)', background: 'var(--tl-surface)' }}
      >
        <p className="text-sm">Your account is gone. {total} rows were deleted.</p>
        <ul className="flex flex-col gap-1 text-[11px] tabular-nums" style={{ ...mono, ...dim }}>
          {receipt
            .filter((r) => r.rows_deleted > 0)
            .map((r) => (
              <li key={r.entity}>
                {r.entity} · {r.rows_deleted}
              </li>
            ))}
        </ul>
        <p className="text-[11px]" style={dim}>
          Nothing in the shared catalog was touched. The films, people and connections are the same
          as they were.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <p className="text-sm" style={dim}>
          Everything you have tracked, rated and written, in one file. The CSV opens in a
          spreadsheet and its first columns are the ones Letterboxd&apos;s importer reads.
        </p>
        <div className="flex gap-2">
          {(['json', 'csv'] as const).map((format) => (
            <a
              key={format}
              href={`/api/me/export?format=${format}`}
              // Without download the browser renders the JSON instead of
              // saving it; Content-Disposition covers this too, and both is
              // cheap insurance across iOS Safari versions.
              download
              className="min-h-11 rounded-full px-4 text-sm leading-[2.75rem]"
              style={{ border: '1px solid var(--tl-border-strong)' }}
            >
              Download {format.toUpperCase()}
            </a>
          ))}
        </div>
      </div>

      <div
        className="flex flex-col gap-3 rounded-xl border p-4"
        style={{ borderColor: 'var(--tl-negative)' }}
      >
        <h3
          className="text-xs uppercase tracking-widest"
          style={{ ...mono, color: 'var(--tl-negative)' }}
        >
          Delete account
        </h3>
        <p className="text-sm" style={dim}>
          This removes your ratings, watch history, episode progress, notes and shared links
          permanently. It cannot be undone. Download your data first if you want it.
        </p>

        {!armed ? (
          <button
            type="button"
            onClick={() => setArmed(true)}
            className="min-h-11 self-start rounded-full px-4 text-sm"
            style={{ border: '1px solid var(--tl-negative)', color: 'var(--tl-negative)' }}
          >
            Delete my account
          </button>
        ) : (
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              startTransition(async () => {
                const res = await deleteAccountAction({ confirm });
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                setReceipt(res.receipt);
                // The rows are gone but the cookie is not, and neither are the
                // pages the worker cached for this person. Both have to go or
                // the app keeps showing a library that no longer exists.
                await fetch('/api/auth/sign-out', { method: 'POST' }).catch(() => {});
                await clearPrivateCaches().catch(() => {});
                router.refresh();
              });
            }}
          >
            <label className="text-[11px]" style={dim}>
              Type <span style={mono}>{email}</span> to confirm.
            </label>
            <input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="min-h-11 rounded-full px-4 text-sm"
              style={{
                border: '1px solid var(--tl-border)',
                background: 'var(--tl-surface-2)',
                color: 'var(--tl-text)',
              }}
            />
            {error && (
              <p className="text-xs" style={{ color: 'var(--tl-negative)' }}>
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={pending}
                className="min-h-11 rounded-full px-4 text-sm"
                style={{ border: '1px solid var(--tl-negative)', color: 'var(--tl-negative)' }}
              >
                {pending ? 'Deleting…' : 'Delete permanently'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setArmed(false);
                  setConfirm('');
                  setError(null);
                }}
                className="min-h-11 rounded-full px-4 text-sm"
                style={{ border: '1px solid var(--tl-border)' }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
