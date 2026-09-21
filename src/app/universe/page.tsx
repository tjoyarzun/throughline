import {
  PREDICATES,
  PREDICATE_SPECS,
  GRAPH_NODE_TYPES,
  TRAVERSABLE_PREDICATES,
  ONTOLOGY_VERSION,
  PATH_WEIGHTS,
} from '@/lib/ontology/generated';
import { Chip } from '@/components/ui/chip';

/**
 * "Ontology at a glance" — rendered from the compiled ontology, so it cannot
 * drift from what the database enforces. Deliberately more technical in tone
 * and typography than the tracker: this is a different, more serious room.
 *
 * Note this page needs no database. The ontology is real before any data is.
 */
export default function UniversePage() {
  const sorted = [...TRAVERSABLE_PREDICATES].sort(
    (a, b) => (PATH_WEIGHTS[a] ?? 99) - (PATH_WEIGHTS[b] ?? 99),
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl">The Universe</h1>
        <p className="text-sm" style={{ color: 'var(--tl-text-dim)' }}>
          The graph is empty until Phase 2 loads a corpus. The ontology that will shape it already
          exists.
        </p>
      </header>

      <section
        className="rounded-xl border p-4"
        style={{ borderColor: 'var(--tl-border)', background: 'var(--tl-surface)' }}
      >
        <h2
          className="mb-3 text-xs uppercase tracking-widest"
          style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          Ontology v{ONTOLOGY_VERSION}
        </h2>
        <dl className="grid grid-cols-3 gap-4" style={{ fontFamily: 'var(--font-mono)' }}>
          {[
            ['Predicates', PREDICATES.length],
            ['Node types', GRAPH_NODE_TYPES.length],
            ['Traversable', TRAVERSABLE_PREDICATES.length],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex flex-col gap-1">
              <dt className="text-xs" style={{ color: 'var(--tl-text-dim)' }}>
                {label}
              </dt>
              <dd className="text-2xl">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2
          className="text-xs uppercase tracking-widest"
          style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          Predicates by path weight
        </h2>
        <p className="text-sm" style={{ color: 'var(--tl-text-dim)' }}>
          Lower is more meaningful in an explanation. &ldquo;Both are Drama&rdquo; is true and
          useless, which is why{' '}
          <code style={{ fontFamily: 'var(--font-mono)' }}>belongs_to_genre</code> sits at the
          bottom and is banned from intermediate positions entirely.
        </p>
        <ul className="flex flex-col divide-y" style={{ borderColor: 'var(--tl-border)' }}>
          {sorted.map((p) => {
            const spec = PREDICATE_SPECS[p];
            return (
              <li key={p} className="flex items-center justify-between gap-3 py-2.5">
                <span className="flex min-w-0 flex-col gap-1">
                  <code className="truncate text-sm" style={{ fontFamily: 'var(--font-mono)' }}>
                    {p}
                  </code>
                  <span className="truncate text-xs" style={{ color: 'var(--tl-text-dim)' }}>
                    {spec.domain.join(' | ')} &rarr; {spec.range.join(' | ')}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {spec.provenance.includes('derived') && <Chip variant="provenance">derived</Chip>}
                  {spec.sparse && <Chip variant="provenance">sparse</Chip>}
                  <span
                    className="tabular-nums text-sm"
                    style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
                  >
                    {PATH_WEIGHTS[p]?.toFixed(2)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
