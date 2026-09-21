import { PosterSkeleton } from '@/components/ui/skeleton';

export default function HomePage() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <p className="text-sm" style={{ color: 'var(--tl-text-dim)' }}>
          Phase 0 — foundation
        </p>
        <h1 className="text-3xl">Throughline</h1>
      </header>

      {/* Zero state: never an empty grid. One prompt, one action. */}
      <section
        className="flex flex-col items-center gap-3 rounded-xl border px-6 py-12 text-center"
        style={{ borderColor: 'var(--tl-border)', background: 'var(--tl-surface)' }}
      >
        <h2 className="text-2xl">Nothing tracked yet.</h2>
        <p className="max-w-sm text-sm" style={{ color: 'var(--tl-text-dim)' }}>
          Search for something you have watched and it will start collecting here. The graph fills
          in as you go.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2
          className="text-sm uppercase tracking-wide"
          style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          Continue watching
        </h2>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {[0, 1, 2].map((i) => (
            <PosterSkeleton key={i} />
          ))}
        </div>
      </section>
    </div>
  );
}
