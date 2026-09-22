import Link from 'next/link';
import { universeStats } from '@/server/repos/universe';

export const metadata = { title: 'Universe' };
export const dynamic = 'force-dynamic';

const n = (v: number) => v.toLocaleString('en-US');

/**
 * The Universe hub.
 *
 * Deliberately a different register from the tracker: mono type, hairline
 * rules, numbers stated plainly. The tracker speaks English; this room is
 * allowed to be technical, because here the data work IS the product.
 */
export default async function UniversePage() {
  const s = await universeStats();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl">The Universe</h1>
        <p className="text-sm" style={{ color: 'var(--tl-text-dim)' }}>
          {n(s.titles)} titles · {n(s.people)} people · {n(s.edges)} connections
        </p>
      </header>

      <nav className="flex flex-col gap-3">
        <Card
          href="/universe/connect"
          title="Find the throughline"
          body="Why are two things connected? Ranked, narrated paths through the graph."
        />
        <Card
          href="/universe/explore"
          title="Explore the graph"
          body="Start anywhere and walk outward, one relationship at a time."
        />
        <Card
          href="/universe/me"
          title="My universe"
          body="Your viewing history as a shape, and how much of the graph it covers."
        />
      </nav>

      {/* The ontology, stated. Including what is NOT covered — a coverage gap
          shown honestly is worth more than a number quietly rounded up. */}
      <section
        className="flex flex-col gap-4 rounded-xl border p-4"
        style={{ borderColor: 'var(--tl-border)', background: 'var(--tl-surface)' }}
      >
        <h2
          className="text-xs uppercase tracking-widest"
          style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          Ontology at a glance
        </h2>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Stat label="node types" value={String(s.nodeTypes)} />
          <Stat label="predicates" value={`${s.predicatesInUse} / ${s.predicatesDeclared}`} />
          <Stat label="curated themes" value={String(s.themes)} />
          <Stat label="titles themed" value={`${s.themedPct}%`} />
        </dl>

        <div
          className="flex flex-col gap-1.5 border-t pt-3"
          style={{ borderColor: 'var(--tl-border)' }}
        >
          {s.topPredicates.map((p) => (
            <div key={p.predicate} className="flex items-baseline justify-between gap-3">
              <span className="text-xs" style={{ fontFamily: 'var(--font-mono)' }}>
                {p.predicate}
              </span>
              <span
                className="text-xs tabular-nums"
                style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
              >
                {n(p.n)}
              </span>
            </div>
          ))}
        </div>

        <p className="text-xs leading-relaxed" style={{ color: 'var(--tl-text-dim)' }}>
          Character resolution is {s.charactersResolvedPct}% and deliberately partial: a character
          is only resolved on strong evidence, and the raw credit is shown otherwise. Partial
          coverage stated plainly beats fake completeness.
        </p>
      </section>
    </div>
  );
}

function Card({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-xl border p-4"
      style={{ borderColor: 'var(--tl-border)', background: 'var(--tl-surface)' }}
    >
      <span className="text-lg">{title}</span>
      <span className="text-sm" style={{ color: 'var(--tl-text-dim)' }}>
        {body}
      </span>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt
        className="text-[10px] uppercase tracking-wide"
        style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
      >
        {label}
      </dt>
      <dd className="text-xl tabular-nums">{value}</dd>
    </div>
  );
}
