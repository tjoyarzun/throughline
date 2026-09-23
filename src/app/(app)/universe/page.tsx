import Link from 'next/link';
import { graphEngine } from '@/lib/graph/postgres-engine';
import { ConstellationCanvas } from '@/components/graph/constellation-canvas';
import { NeighborGroups } from '@/components/graph/neighbor-groups';
import { universeStats, featuredNodes, bestConnectedAmong } from '@/server/repos/universe';
import { getAccountId } from '@/server/auth/session';
import { listLibrary, trackedAmong } from '@/server/repos/user';

export const metadata = { title: 'Universe' };
export const dynamic = 'force-dynamic';

const n = (v: number) => v.toLocaleString('en-US');

/**
 * The Universe hub, which is now a view rather than a menu.
 *
 * It used to be three cards over a stats panel -- a page whose entire job was
 * to describe three other pages. The graph is the thing worth seeing, so the
 * graph is what opens, and the two surfaces the constellation cannot be
 * (your own shape, and a path between two chosen things) are the buttons
 * underneath it. Walking is done by tapping a node, which is the same gesture
 * the card was asking you to read about.
 *
 * The register stays technical -- mono type, hairline rules, numbers stated
 * plainly. The tracker speaks English; this room is allowed not to.
 */
export default async function UniversePage() {
  const accountId = await getAccountId();

  /**
   * Center on something of YOURS when there is something of yours.
   *
   * This is the difference between the signed-in Universe and the public one,
   * and it should be visible in the first second rather than explained: the
   * default view is your corner of the graph, seeded by the best-connected
   * title in your library. A cold account, or one whose library has not been
   * ingested deeply yet, falls back to the curated opener -- never to an
   * empty state, because an empty graph argues against the whole thesis.
   */
  const [stats, center] = await Promise.all([universeStats(), pickCenter(accountId)]);

  const [groups, neighborhood] = center
    ? await Promise.all([
        graphEngine.neighbors(center, { perGroup: 12 }),
        graphEngine.neighborhood(center),
      ])
    : [[], null];

  let mine = new Set<string>();
  if (accountId && neighborhood) {
    const titleIds = neighborhood.nodes.filter((x) => x.type === 'title').map((x) => x.id);
    mine = new Set([...(await trackedAmong(accountId, titleIds))].map((id) => `title:${id}`));
  }

  const hrefFor = (x: { type: string; id: string }) => `/universe/explore?focus=${x.type}:${x.id}`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl">The Universe</h1>
        <p className="text-sm" style={{ color: 'var(--tl-text-dim)' }}>
          {n(stats.titles)} titles · {n(stats.people)} people · {n(stats.edges)} connections
        </p>
      </header>

      {neighborhood && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm">
            <Link
              href={hrefFor(neighborhood.center)}
              className="underline-offset-4 hover:underline"
            >
              {neighborhood.center.label}
            </Link>
            <span style={{ color: 'var(--tl-text-dim)' }}>
              {' '}
              — {neighborhood.nodes.length} things, {neighborhood.edges.length} relationships
            </span>
          </h2>
          <ConstellationCanvas
            center={neighborhood.center}
            nodes={neighborhood.nodes}
            edges={neighborhood.edges}
            mine={[...mine]}
            linkTo="universe"
          />
          {/* Keeps the seed grid reachable now that the hub no longer routes
              through it. An orphaned route is dead code, and that grid is the
              one place your library and what is trending are offered side by
              side as places to start. */}
          <Link
            href="/universe/explore"
            className="self-start text-xs"
            style={{ color: 'var(--tl-text-dim)' }}
          >
            Start somewhere else →
          </Link>
        </section>
      )}

      <nav className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card
          href="/universe/me"
          title="My universe"
          body="Your viewing history as a shape, and how much of the graph it covers."
        />
        <Card
          href="/universe/connect"
          title="Find the throughline"
          body="Why are two things connected? Ranked, narrated paths through the graph."
        />
      </nav>

      {/* The list is not a fallback beside the canvas -- it IS the content, and
          the canvas draws over it. That ordering is what keeps the accessible
          view from rotting (AC-36). */}
      <NeighborGroups groups={groups} hrefFor={hrefFor} mine={mine} />

      <OntologyFooter stats={stats} />
    </div>
  );
}

async function pickCenter(accountId: string | null): Promise<{ type: string; id: string } | null> {
  if (accountId) {
    const library = await listLibrary(accountId, { sort: 'added', limit: 60 });
    const best = await bestConnectedAmong(library.map((m) => m.title_id));
    if (best) return best;
  }
  const [opener] = await featuredNodes(1);
  return opener ? { type: opener.type, id: opener.id } : null;
}

/**
 * The ontology, stated -- now collapsed, and at the bottom.
 *
 * It was the loudest thing on the page and it is the least urgent: a reader
 * who wants predicate counts will open it, and a reader who wants the graph
 * should not have to scroll past a table to reach it. A real <details>, so it
 * works with scripting off and announces its own state; the summary keeps the
 * two numbers worth seeing without opening anything.
 */
function OntologyFooter({ stats }: { stats: Awaited<ReturnType<typeof universeStats>> }) {
  return (
    <details
      className="rounded-xl border"
      style={{ borderColor: 'var(--tl-border)', background: 'var(--tl-surface)' }}
    >
      <summary
        className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 text-xs uppercase tracking-widest"
        style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
      >
        <span>Ontology at a glance</span>
        <span className="tabular-nums lowercase tracking-normal">
          {stats.nodeTypes} types · {stats.predicatesInUse}/{stats.predicatesDeclared} predicates
        </span>
      </summary>

      <div className="flex flex-col gap-4 px-4 pb-4 pt-2">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Stat label="node types" value={String(stats.nodeTypes)} />
          <Stat
            label="predicates"
            value={`${stats.predicatesInUse} / ${stats.predicatesDeclared}`}
          />
          <Stat label="curated themes" value={String(stats.themes)} />
          <Stat label="titles themed" value={`${stats.themedPct}%`} />
        </dl>

        <div
          className="flex flex-col gap-1.5 border-t pt-3"
          style={{ borderColor: 'var(--tl-border)' }}
        >
          {stats.topPredicates.map((p) => (
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
          Character resolution is {stats.charactersResolvedPct}% and deliberately partial: a
          character is only resolved on strong evidence, and the raw credit is shown otherwise.
          Partial coverage stated plainly beats fake completeness.
        </p>
      </div>
    </details>
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
