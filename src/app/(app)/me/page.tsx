import { redirect } from 'next/navigation';
import { getSession } from '@/server/auth/session';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { Chip } from '@/components/ui/chip';

export const metadata = { title: 'Me' };
export const dynamic = 'force-dynamic';

export default async function MePage() {
  const session = await getSession();
  if (!session) redirect('/auth/signin?next=/me');

  const { user } = session;
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl">{user.name || 'You'}</h1>
        <p className="text-sm" style={{ color: 'var(--tl-text-dim)' }}>
          {user.email}
        </p>
      </header>

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
          Coming next
        </h2>
        <p className="text-sm" style={{ color: 'var(--tl-text-dim)' }}>
          This is where data export, theme, region and household settings will live. Sharing and
          episode tracking are the next things being built.
        </p>
        <div className="flex flex-wrap gap-2">
          {['Sharing', 'Episodes', 'Data export', 'Households', 'Offline'].map((f) => (
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
