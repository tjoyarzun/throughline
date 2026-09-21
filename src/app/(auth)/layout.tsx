/**
 * Auth pages stand alone: no bottom navigation, no reserved space for it, and
 * exactly one full-height container so the page does not scroll.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6">
      {children}
    </main>
  );
}
