'use client';

import { useState, useTransition } from 'react';
import {
  createInviteAction,
  listSessionsAction,
  revokeInviteAction,
  revokeSessionAction,
} from '@/actions/admin';
import type { AdminInvite, AdminSession, AdminUser } from '@/server/repos/admin';

/**
 * The owner's view of everyone else.
 *
 * Rendered only when the server said `is_admin`, but that decision is cosmetic
 * -- every action below raises from inside the database if the caller is not
 * an admin. This component being reachable would leak nothing; it would only
 * produce errors.
 */

const mono = { fontFamily: 'var(--font-mono)' } as const;
const dim = { color: 'var(--tl-text-dim)' } as const;

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs uppercase tracking-widest" style={{ ...mono, ...dim }}>
      {children}
    </h3>
  );
}

/**
 * A collapsible admin section.
 *
 * A real <details>, the same device the Universe hub uses for its ontology
 * panel: it works with scripting off, announces its own open/closed state,
 * and needs no client component to hold a boolean. The heading stays an h3
 * INSIDE the summary so the document outline is unchanged -- collapsing a
 * section should not remove it from the structure a screen reader walks.
 *
 * Not persisted. Only the owner ever sees this screen, and a cookie to
 * remember which of three sections were open is more machinery than the
 * problem deserves.
 */
function Collapsible({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="flex flex-col gap-3">
      {/* An explicit chevron, because display:flex on a summary drops the
          native disclosure marker -- and without one these read as plain
          headings with no hint that they open. The affordance IS the
          feature here; a collapsed section nobody knows to tap is worse
          than a long one. */}
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block shrink-0 transition-transform"
          style={{ color: 'var(--tl-text-dim)', fontSize: '0.7rem' }}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 1.5 6.5 5 3 8.5" />
          </svg>
        </span>
        <SectionHeading>
          {title}
          {count !== undefined && ` · ${count}`}
        </SectionHeading>
      </summary>
      <div className="flex flex-col gap-3 pt-3">{children}</div>
    </details>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex flex-col divide-y rounded-xl border"
      style={{ borderColor: 'var(--tl-border)', background: 'var(--tl-surface)' }}
    >
      {children}
    </div>
  );
}

/** A short date. Nothing here needs a time of day. */
function day(v: string | null): string {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * User-agent strings are unreadable and long enough to break the row. This
 * keeps the two facts a person actually uses to recognize their own device.
 */
function device(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const os = /iPhone|iPad/.test(ua)
    ? 'iPhone'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'Mac'
        : /Windows/.test(ua)
          ? 'Windows'
          : 'Unknown';
  const browser = /CriOS|Chrome/.test(ua)
    ? 'Chrome'
    : /Firefox/.test(ua)
      ? 'Firefox'
      : /Safari/.test(ua)
        ? 'Safari'
        : 'browser';
  return `${os} · ${browser}`;
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span className="flex flex-col items-end">
      <span className="text-sm tabular-nums" style={mono}>
        {n}
      </span>
      <span className="text-[10px] uppercase tracking-wider" style={dim}>
        {label}
      </span>
    </span>
  );
}

function UserRow({ user, currentSessionId }: { user: AdminUser; currentSessionId: string }) {
  const [sessions, setSessions] = useState<AdminSession[] | null>(null);
  const [open, setOpen] = useState(false);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && sessions === null) {
      startTransition(async () => {
        const res = await listSessionsAction({ accountId: user.account_id });
        if (res.ok) setSessions(res.sessions);
        else setError(res.error);
      });
    }
  }

  return (
    <li className="flex flex-col px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm">
            {user.display_name || user.email}
            {user.is_admin && (
              <span className="ml-2 text-[10px] uppercase tracking-wider" style={dim}>
                admin
              </span>
            )}
          </span>
          <span className="truncate text-[11px]" style={dim}>
            {user.email}
          </span>
          <span className="mt-1 text-[10px] tabular-nums" style={{ ...mono, ...dim }}>
            last seen {day(user.last_login)} · {user.streak}
            {user.streak === 1 ? ' day streak' : ' day streak'} · joined {day(user.created_at)}
          </span>
        </span>
        <span className="flex shrink-0 gap-4">
          <Stat n={user.watched} label="watched" />
          <Stat n={user.rated} label="rated" />
          <Stat n={user.episodes} label="eps" />
        </span>
      </div>

      <button
        type="button"
        onClick={toggle}
        className="mt-2 self-start text-[11px] underline-offset-2 hover:underline"
        style={dim}
        aria-expanded={open}
      >
        {user.active_sessions} active {user.active_sessions === 1 ? 'device' : 'devices'}
        {open ? ' ▲' : ' ▼'}
      </button>

      {open && (
        <ul className="mt-2 flex flex-col gap-2">
          {pending && sessions === null && (
            <li className="text-[11px]" style={dim}>
              Loading…
            </li>
          )}
          {error && (
            <li className="text-[11px]" style={{ color: 'var(--tl-negative)' }}>
              {error}
            </li>
          )}
          {sessions?.length === 0 && (
            <li className="text-[11px]" style={dim}>
              No active sessions.
            </li>
          )}
          {sessions?.map((s) => {
            const revoked = gone.has(s.session_id);
            const isThisDevice = s.session_id === currentSessionId;
            return (
              <li key={s.session_id} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 flex-col">
                  <span
                    className="truncate text-[11px]"
                    style={{ textDecoration: revoked ? 'line-through' : 'none' }}
                  >
                    {device(s.user_agent)}
                    {isThisDevice && ' · this device'}
                  </span>
                  <span className="text-[10px] tabular-nums" style={{ ...mono, ...dim }}>
                    {s.ip_address ?? 'no address'} · since {day(s.created_at)}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={revoked || pending}
                  className="min-h-8 shrink-0 rounded-full px-3 text-[11px]"
                  style={{
                    border: `1px solid ${revoked ? 'var(--tl-border)' : 'var(--tl-border-strong)'}`,
                    color: revoked ? 'var(--tl-text-dim)' : 'var(--tl-negative)',
                  }}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await revokeSessionAction({ sessionId: s.session_id });
                      if (res.ok) setGone((p) => new Set(p).add(s.session_id));
                      else setError(res.error);
                    })
                  }
                >
                  {revoked ? 'Revoked' : isThisDevice ? 'Sign out' : 'Revoke'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

function InviteCreator({ origin }: { origin: string }) {
  const [email, setEmail] = useState('');
  const [made, setMade] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  // The link carries the code so the recipient never types it. The sign-in
  // page reads ?invite= and prefills the field.
  const link = made ? `${origin}/auth/signin?invite=${encodeURIComponent(made.code)}` : '';

  async function share() {
    const text = `Here is your invite to Throughline: ${link}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Throughline invite', text, url: link });
        return;
      } catch {
        // Dismissing the sheet throws. Fall through to copying.
      }
    }
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const res = await createInviteAction({ email: email.trim() || null, days: 30 });
            if (res.ok) {
              setMade({ code: res.code, expiresAt: res.expiresAt });
              setEmail('');
            } else setError(res.error);
          });
        }}
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email (optional)"
          autoComplete="off"
          className="min-h-11 flex-1 rounded-full px-4 text-sm"
          style={{
            border: '1px solid var(--tl-border)',
            background: 'var(--tl-surface-2)',
            color: 'var(--tl-text)',
          }}
        />
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 shrink-0 rounded-full px-4 text-sm"
          style={{ border: '1px solid var(--tl-border-strong)' }}
        >
          {pending ? 'Making…' : 'Create'}
        </button>
      </form>

      <p className="text-[11px]" style={dim}>
        Leave the email empty for a code anyone can redeem. Fill it in and only that address can.
        Either way it expires in 30 days and works once.
      </p>

      {error && (
        <p className="text-xs" style={{ color: 'var(--tl-negative)' }}>
          {error}
        </p>
      )}

      {made && (
        <div
          className="flex flex-col gap-2 rounded-xl border p-4"
          style={{ borderColor: 'var(--tl-border-strong)', background: 'var(--tl-surface-2)' }}
        >
          <span className="text-lg tracking-widest" style={mono}>
            {made.code}
          </span>
          <span className="truncate text-[11px]" style={dim}>
            {link}
          </span>
          <button
            type="button"
            onClick={share}
            className="min-h-10 self-start rounded-full px-4 text-sm"
            style={{ border: '1px solid var(--tl-border-strong)' }}
          >
            {copied ? 'Copied' : 'Share link'}
          </button>
        </div>
      )}
    </div>
  );
}

function InviteList({ invites }: { invites: AdminInvite[] }) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  if (invites.length === 0) {
    return (
      <p className="text-sm" style={dim}>
        No invites yet.
      </p>
    );
  }

  return (
    <Panel>
      {invites.map((i) => {
        const redeemed = i.redeemed_at !== null;
        const expired = new Date(i.expires_at) < new Date();
        const revoked = gone.has(i.code);
        const dead = redeemed || expired || revoked;
        return (
          <div key={i.code} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="flex min-w-0 flex-col">
              <span
                className="truncate text-sm tracking-widest"
                style={{ ...mono, textDecoration: dead ? 'line-through' : 'none' }}
              >
                {i.code}
              </span>
              <span className="truncate text-[10px]" style={dim}>
                {redeemed
                  ? `redeemed by ${i.redeemed_by_email ?? i.email ?? 'someone'} ${day(i.redeemed_at)}`
                  : revoked
                    ? 'revoked'
                    : expired
                      ? `expired ${day(i.expires_at)}`
                      : `${i.email ?? 'anyone'} · expires ${day(i.expires_at)}`}
              </span>
            </span>
            {!dead && (
              <button
                type="button"
                disabled={pending}
                className="min-h-8 shrink-0 rounded-full px-3 text-[11px]"
                style={{
                  border: '1px solid var(--tl-border-strong)',
                  color: 'var(--tl-negative)',
                }}
                onClick={() =>
                  startTransition(async () => {
                    const res = await revokeInviteAction({ code: i.code });
                    if (res.ok) setGone((p) => new Set(p).add(i.code));
                  })
                }
              >
                Revoke
              </button>
            )}
          </div>
        );
      })}
    </Panel>
  );
}

export function AdminPanel({
  users,
  invites,
  currentSessionId,
  origin,
}: {
  users: AdminUser[];
  invites: AdminInvite[];
  currentSessionId: string;
  origin: string;
}) {
  return (
    <section className="flex flex-col gap-4">
      {/* People is the long one and the reason this was filed, so it is
          collapsed. "Invite someone" is the only thing here anybody comes to
          DO rather than read, so it stays open. */}
      <Collapsible title="People" count={users.length}>
        <Panel>
          <ul className="contents">
            {users.map((u) => (
              <UserRow key={u.account_id} user={u} currentSessionId={currentSessionId} />
            ))}
          </ul>
        </Panel>
      </Collapsible>

      <Collapsible title="Invite someone" defaultOpen>
        <InviteCreator origin={origin} />
      </Collapsible>

      <Collapsible title="Invites" count={invites.length}>
        <InviteList invites={invites} />
      </Collapsible>
    </section>
  );
}
