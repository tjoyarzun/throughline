import Link from 'next/link';
import { nodeImageUrl } from '@/lib/tmdb-image';
import type { GraphNode, NeighborGroup } from '@/lib/graph/types';

/**
 * A node's relationships, as real links.
 *
 * Shared by the public page and the signed-in one, because it is not a
 * fallback for the canvas -- it IS the content, and the canvas draws over it.
 * A crawler, a screen reader and a browser with scripting off all read this,
 * which is what makes the canvas safe to mark aria-hidden (AC-36). Keeping one
 * copy means the accessible view cannot drift from the decorative one.
 *
 * `hrefFor` differs by surface: signed-in readers stay inside /universe, where
 * the app shell and their own library are; strangers go to /explore.
 */
export function NeighborGroups({
  groups,
  hrefFor,
  mine,
}: {
  groups: NeighborGroup[];
  hrefFor: (node: GraphNode) => string;
  /** Node keys (`type:id`) the reader already tracks, marked in the list too. */
  mine?: Set<string>;
}) {
  return (
    <div className="flex flex-col gap-7">
      {groups.map((group) => (
        <section key={group.predicate} className="flex flex-col gap-3">
          <h2
            className="text-xs uppercase tracking-widest"
            style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
          >
            {group.label}
            {group.more > 0 && (
              <span style={{ color: 'var(--tl-text-faint)' }}> · {group.more} more</span>
            )}
          </h2>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 md:grid-cols-4">
            {group.nodes.map((n) => {
              const isMine = mine?.has(`${n.type}:${n.id}`) ?? false;
              return (
                <li key={`${n.type}-${n.id}`}>
                  <Link href={hrefFor(n)} className="flex items-center gap-2">
                    <span
                      className="block size-9 shrink-0 overflow-hidden rounded-full"
                      style={{
                        background: 'var(--tl-surface-2)',
                        // The same second channel the canvas uses for "yours":
                        // a ring, never a different fill, because fill already
                        // means entity type.
                        boxShadow: isMine ? '0 0 0 2px var(--tl-accent)' : undefined,
                      }}
                    >
                      {n.imagePath && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={nodeImageUrl(n.type, n.imagePath, 80) ?? ''}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm leading-tight">{n.label}</span>
                      {n.sublabel && (
                        <span
                          className="truncate text-[11px]"
                          style={{ color: 'var(--tl-text-dim)' }}
                        >
                          {n.sublabel}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
