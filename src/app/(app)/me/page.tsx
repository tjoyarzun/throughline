import { redirect } from 'next/navigation';
import { getSession } from '@/server/auth/session';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { ShareList } from '@/components/tracking/share-list';
import { listMyShares } from '@/server/repos/shares';
import { Chip } from '@/components/ui/chip';
import { AdminPanel } from '@/components/admin/admin-panel';
import { DataSection } from '@/components/account/data-section';
import { adminInvites, adminUsers, isAdmin } from '@/server/repos/admin';
import Link from 'next/link';
import { RELEASES } from '@/content/releases';
import { SEEN_COOKIE, hasUnreadRelease } from '@/lib/whats-new';
import { ThemeControl } from '@/components/account/theme-control';
import { THEME_COOKIE, isTheme } from '@/lib/theme';
import { cookies } from 'next/headers';

export const metadata = { title: 'Me' };
export const dynamic = 'force-dynamic';

export default async function MePage() {
  const session = await getSession();
  if (!session) redirect('/auth/signin?next=/me');

  const { user } = session;
  const shares = await listMyShares(user.id);

  const latest = RELEASES[0];
  const LATEST_RELEASE = latest
    ? `${latest.name} · ${new Date(`${latest.date}T12:00:00Z`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })}`
    : '';

  const jar = await cookies();
  const unread = hasUnreadRelease(jar.get(SEEN_COOKIE)?.value);
  const storedTheme = jar.get(THEME_COOKIE)?.value;
  const theme = isTheme(storedTheme) ? storedTheme : 'system';

  // Two round trips only for an admin. Everyone else pays for one boolean.
  const admin = await isAdmin(user.id);
  const [users, invites] = admin
    ? await Promise.all([adminUsers(user.id), adminInvites(user.id)])
    : [[], []];
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl">{user.name || 'You'}</h1>
        <p className="text-sm" style={{ color: 'var(--tl-text-dim)' }}>
          {user.email}
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <Link
          href="/whats-new"
          className="flex min-h-11 items-center justify-between gap-3 rounded-xl border px-4 py-3"
          style={{ borderColor: 'var(--tl-border)', background: 'var(--tl-surface)' }}
        >
          <span className="flex flex-col">
            <span className="flex items-center gap-2 text-sm">
              What&rsquo;s new
              {unread && (
                <>
                  <span
                    aria-hidden="true"
                    className="block size-2 shrink-0 rounded-full"
                    style={{ background: 'var(--tl-accent)' }}
                  />
                  <span className="sr-only">, unread</span>
                </>
              )}
            </span>
            <span className="text-xs" style={{ color: 'var(--tl-text-dim)' }}>
              {LATEST_RELEASE}
            </span>
          </span>
          <span aria-hidden="true" style={{ color: 'var(--tl-text-dim)' }}>
            →
          </span>
        </Link>
      </section>

      <section className="flex flex-col gap-3">
        <h2
          className="text-xs uppercase tracking-widest"
          style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          Appearance
        </h2>
        <ThemeControl current={theme} />
        <p className="text-xs" style={{ color: 'var(--tl-text-dim)' }}>
          Stored on this device, not on your account — dark on a phone at night and light on a
          laptop is a reasonable thing to want.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2
          className="text-xs uppercase tracking-widest"
          style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          Account
        </h2>
        <dl
          className="flex flex-col divide-y rounded-xl border"
          style={{ borderColor: 'var(--tl-border)', background: 'var(--tl-surface)' }}
        >
          {[
            ['Email', user.email],
            ['Verified', user.emailVerified ? 'Yes' : 'Not yet'],
            ['Signed in since', new Date(session.session.createdAt).toLocaleDateString('en-US')],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-sm" style={{ color: 'var(--tl-text-dim)' }}>
                {label}
              </dt>
              <dd className="text-sm">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2
          className="text-xs uppercase tracking-widest"
          style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          Shared links
        </h2>
        <ShareList shares={shares} />
      </section>

      {admin && (
        <section className="flex flex-col gap-4">
          <h2
            className="text-xs uppercase tracking-widest"
            style={{ color: 'var(--tl-accent)', fontFamily: 'var(--font-mono)' }}
          >
            Administration
          </h2>
          <AdminPanel
            users={users}
            invites={invites}
            currentSessionId={session.session.id}
            origin={origin}
          />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2
          className="text-xs uppercase tracking-widest"
          style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          Your data
        </h2>
        <DataSection email={user.email} />
      </section>

      <section className="flex flex-col gap-3">
        <h2
          className="text-xs uppercase tracking-widest"
          style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          Coming next
        </h2>
        <p className="text-sm" style={{ color: 'var(--tl-text-dim)' }}>
          Theme, region and household settings will live here.
        </p>
        <div className="flex flex-wrap gap-2">
          {['Households', 'Import', 'Availability', 'Awards'].map((f) => (
            <Chip key={f} variant="provenance">
              {f}
            </Chip>
          ))}
        </div>
      </section>

      <SignOutButton />

      <footer className="pt-4 text-xs" style={{ color: 'var(--tl-text-faint)' }}>
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </footer>
    </div>
  );
}
