'use client';

/** Every error boundary offers a real recovery action, never a bare apology. */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 py-16">
      <h1 className="text-3xl">That did not load.</h1>
      <p className="text-sm" style={{ color: 'var(--tl-text-dim)' }}>
        The problem has been logged. Trying again often works.
      </p>
      <button
        onClick={reset}
        className="rounded-full border px-4 py-2 text-sm"
        style={{ borderColor: 'var(--tl-border-strong)', color: 'var(--tl-text)' }}
      >
        Try again
      </button>
    </div>
  );
}
