import Link from 'next/link';
import { BackLink } from '@/components/ui/back-link';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getAccountId } from '@/server/auth/session';
import { tasteByPredicate, tasteSummary, type TasteNode } from '@/server/repos/taste';
import { resolveMetric, PHASE_1_METRICS } from '@/lib/metrics/resolve';
import { nodeImageUrl } from '@/lib/tmdb-image';
import { Donut, RankedList, Histogram, Sparkline, BucketBar, Stat } from '@/components/charts';
import { Skeleton, HeadLine, TextLine } from '@/components/ui/skeleton';

export const metadata = { title: 'My universe' };
export const dynamic = 'force-dynamic';

const RINGS = [
  { predicate: 'directed_by', label: 'Directors' },
  { predicate: 'explores_theme', label: 'Themes' },
  { predicate: 'features_actor', label: 'Actors' },
  { predicate: 'part_of_franchise', label: 'Franchises' },
] as const;

export default async function MyUniversePage() {
  const accountId = await getAccountId();
  if (!accountId) redirect('/auth/signin?next=/universe/me');

  const summary = await tasteSummary(accountId);

  if (summary.watched === 0) {
    return (
      <div className="flex flex-col gap-6">
        <Back />
        <section
          className="flex flex-col items-center gap-3 rounded-xl border px-6 py-14 text-center"
          style={{ borderColor: 'var(--tl-border)', background: 'var(--tl-surface)' }}
        >
          <h1 className="text-3xl">Your universe is dark.</h1>
          <p className="max-w-sm text-sm" style={{ color: 'var(--tl-text-dim)' }}>
            Track a few things and the constellation starts to form.
          </p>
          <Link
            href="/search"
            className="mt-2 min-h-11 rounded-full px-5 py-2.5 text-sm"
            style={{
              background: 'var(--tl-accent)',
              color: 'var(--tl-accent-ink)',
              fontWeight: 600,
            }}
          >
            Find something
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Back />
        <h1 className="text-3xl">My universe</h1>
        {/* An interpretation line, not just a chart. This is what makes it a
            product rather than a dashboard. */}
        <p className="text-sm leading-relaxed" style={{ color: 'var(--tl-text-dim)' }}>
          {summary.watched} watched across {summary.distinct_directors} directors and{' '}
          {summary.distinct_themes} themes
          {summary.top_theme ? `, most often ${summary.top_theme}` : ''}
          {summary.hours > 0 ? ` · about ${summary.hours} hours` : ''}
          {summary.mean_rating ? ` · you average ${Number(summary.mean_rating).toFixed(1)}★` : ''}.
        </p>
      </header>

      {RINGS.map((ring) => (
        <Suspense key={ring.predicate} fallback={<RingFallback label={ring.label} />}>
          <Ring accountId={accountId} predicate={ring.predicate} label={ring.label} />
        </Suspense>
      ))}

      {PHASE_1_METRICS.map((name) => (
        <Suspense key={name} fallback={<MetricFallback />}>
          <Metric name={name} accountId={accountId} />
        </Suspense>
      ))}
    </div>
  );
}

function Back() {
  return <BackLink fallback="/universe" self="/universe/me" />;
}

/**
 * One orbit ring: the nodes you connect to most through a single relationship.
 *
 * Each carries how much of that node you have actually seen. "4 of 11" against
 * a director is the whole personal-layer-over-global-ontology idea in one
 * number — a leaderboard would say "4" and tell you nothing.
 */
async function Ring({
  accountId,
  predicate,
  label,
}: {
  accountId: string;
  predicate: string;
  label: string;
}) {
  const nodes = await tasteByPredicate(accountId, predicate, 8);
  if (nodes.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2
        className="text-[10px] uppercase tracking-widest"
        style={{ color: 'var(--tl-accent)', fontFamily: 'var(--font-mono)' }}
      >
        {label}
      </h2>
      <ul className="flex gap-3 overflow-x-auto pb-1">
        {nodes.map((n) => (
          <li key={n.node_id} className="w-[92px] shrink-0">
            <Link
              href={`/universe/explore?focus=${n.node_type}:${n.node_id}`}
              className="flex flex-col gap-1.5"
            >
              <OrbitThumb node={n} />
              {/* Two lines reserved: a wrapping name would otherwise push its
                  own stats down and leave the row ragged. */}
              <span className="line-clamp-2 text-xs leading-tight" style={{ minHeight: '2.1em' }}>
                {n.label}
              </span>
              <span
                className="text-[10px] tabular-nums"
                style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
              >
                {n.n_titles} of {Math.max(n.corpus_titles, n.n_titles)}
                {n.avg_rating ? ` · ${Number(n.avg_rating).toFixed(1)}★` : ''}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Coverage rendered as a ring around the thumbnail: filled for what you have
 * seen, dim for the rest of that node's corpus.
 */
function OrbitThumb({ node }: { node: TasteNode }) {
  const img = nodeImageUrl(node.node_type, node.image_path, 92);
  const total = Math.max(node.corpus_titles, node.n_titles, 1);
  const frac = Math.min(1, node.n_titles / total);
  const R = 30;
  const C = 2 * Math.PI * R;

  return (
    <span className="relative block" style={{ width: 68, height: 68 }}>
      <svg width="68" height="68" viewBox="0 0 68 68" aria-hidden className="absolute inset-0">
        <circle cx="34" cy="34" r={R} fill="none" stroke="var(--tl-surface-2)" strokeWidth="3" />
        <circle
          cx="34"
          cy="34"
          r={R}
          fill="none"
          stroke="var(--tl-accent)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${frac * C} ${C}`}
          transform="rotate(-90 34 34)"
        />
      </svg>
      <span
        className="absolute overflow-hidden"
        style={{ inset: 7, borderRadius: '9999px', background: 'var(--tl-surface-2)' }}
      >
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN; docs/adr/0012
          <img src={img} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          // Concepts have no artwork. A truncated label here just repeats the
          // one below it, badly: "Magic & Enchantment" became a clipped
          // fragment. The count is the thing that is not already on screen.
          <span
            aria-hidden
            className="absolute inset-0 grid place-items-center text-base tabular-nums"
            style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
          >
            {node.n_titles}
          </span>
        )}
      </span>
    </span>
  );
}

/** Each metric streams independently; one slow query never blocks the rest. */
async function Metric({
  name,
  accountId,
}: {
  name: (typeof PHASE_1_METRICS)[number];
  accountId: string;
}) {
  const m = await resolveMetric(name, accountId);
  if (m.rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <span
        className="text-[10px] uppercase tracking-widest"
        style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
      >
        {m.label}
      </span>
      {m.viz === 'donut' && <Donut rows={m.rows} />}
      {m.viz === 'ranked_list' && <RankedList rows={m.rows} />}
      {m.viz === 'histogram' && <Histogram rows={m.rows} />}
      {m.viz === 'sparkline' && <Sparkline rows={m.rows} />}
      {m.viz === 'bar' && <BucketBar rows={m.rows} />}
      {m.viz === 'stat' && <Stat rows={m.rows} />}
    </section>
  );
}

function RingFallback({ label }: { label: string }) {
  return (
    <section className="flex flex-col gap-3">
      <HeadLine width={`${label.length * 0.55}rem`} />
      <ul className="flex gap-3 overflow-hidden pb-1">
        {Array.from({ length: 7 }, (_, i) => (
          <li key={i} className="flex w-[92px] shrink-0 flex-col gap-1.5">
            <Skeleton style={{ width: 68, height: 68, borderRadius: '9999px' }} />
            <TextLine width="85%" height="0.7rem" />
            <TextLine width="60%" height="0.6rem" />
          </li>
        ))}
      </ul>
    </section>
  );
}

function MetricFallback() {
  return (
    <section className="flex flex-col gap-3">
      <HeadLine width="8rem" />
      <Skeleton style={{ height: '6rem', width: '100%', borderRadius: 10 }} />
    </section>
  );
}
