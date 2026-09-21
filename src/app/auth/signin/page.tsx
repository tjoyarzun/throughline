import { SignInForm } from '@/components/auth/sign-in-form';

export const metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-4xl">Throughline</h1>
        <p className="text-sm" style={{ color: 'var(--tl-text-dim)' }}>
          A media tracker that understands how things connect.
        </p>
      </header>
      <SignInForm next={next ?? '/'} />
      <p className="text-xs" style={{ color: 'var(--tl-text-faint)' }}>
        Throughline is invite-only. If you have a code, you can create an account with it.
      </p>
    </div>
  );
}
