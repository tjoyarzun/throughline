import { BackLink } from '@/components/ui/back-link';
import { graphEngine } from '@/lib/graph/postgres-engine';
import { PathChain } from '@/components/graph/path-chain';
import { ConnectForm } from '@/components/graph/connect-form';
import { getAccountId } from '@/server/auth/session';
import { rateLimit } from '@/server/rate-limit';

export const metadata = { title: 'Find the throughline' };
export const dynamic = 'force-dynamic';

/** "type:uuid", the form the pickers produce. */
function parseRef(v: string | undefined): { type: string; id: string } | null {
  if (!v) return null;
  const [type, id] = v.split(':');
  if (!type || !id) return null;
  return { type, id };
}

export default async function ConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const sp = await searchParams;
  const a = parseRef(sp.a);
  const b = parseRef(sp.b);

  const [nodeA, nodeB] = await Promise.all([
    a ? graphEngine.node(a) : null,
    b ? graphEngine.node(b) : null,
  ]);
  /**
   * The one genuinely expensive query in the app -- a bidirectional expansion
   * over ~108k edges -- and it is reachable by editing a URL, so it is the
   * obvious thing to hammer.
   *
   * Counted only when both endpoints resolve, so landing on the page or
   * picking one side costs nothing. Fail-open: a limiter outage should not
   * take the Universe down with it.
   */
  const accountId = await getAccountId();
  let throttled = false;
  if (nodeA && nodeB && accountId) {
    const gate = await rateLimit(`paths:${accountId}`, 20, 60);
    throttled = !gate.allowed;
  }
  const paths = nodeA && nodeB && !throttled ? await graphEngine.findPaths(nodeA, nodeB) : [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <BackLink fallback="/universe" self="/universe/connect" />
        <h1 className="text-3xl">Find the throughline</h1>
        <p className="text-sm" style={{ color: 'var(--tl-text-dim)' }}>
          Pick two things. The graph explains how they connect.
        </p>
      </header>

      <ConnectForm
        initialA={
          nodeA
            ? { type: nodeA.type, id: nodeA.id, label: nodeA.label, sublabel: nodeA.sublabel }
            : null
        }
        initialB={
          nodeB
            ? { type: nodeB.type, id: nodeB.id, label: nodeB.label, sublabel: nodeB.sublabel }
            : null
        }
      />

      {throttled && (
        <section
          className="flex flex-col items-center gap-2 rounded-xl border px-6 py-10 text-center"
          style={{ borderColor: 'var(--tl-border)', background: 'var(--tl-surface)' }}
        >
          <h2 className="text-xl">Catching our breath.</h2>
          <p className="max-w-sm text-sm" style={{ color: 'var(--tl-text-dim)' }}>
            That is a lot of path finding in one minute. Give it a moment and try again.
          </p>
        </section>
      )}

      {!throttled && nodeA && nodeB && paths.length === 0 && (
        <section
          className="flex flex-col items-center gap-2 rounded-xl border px-6 py-10 text-center"
          style={{ borderColor: 'var(--tl-border)', background: 'var(--tl-surface)' }}
        >
          <h2 className="text-xl">No throughline found.</h2>
          <p className="max-w-sm text-sm" style={{ color: 'var(--tl-text-dim)' }}>
            Nothing links these within three steps that is worth saying. Genre and studio links are
            deliberately excluded — &ldquo;both are Drama&rdquo; is true and useless.
          </p>
        </section>
      )}

      {paths.length > 0 && (
        <ol className="flex flex-col gap-4">
          {paths.map((p, i) => (
            <PathChain key={i} path={p} index={i} />
          ))}
        </ol>
      )}
    </div>
  );
}
