import { Skeleton, TextLine } from '@/components/ui/skeleton';

/**
 * The shape of the page that actually arrives.
 *
 * This file went stale the moment the hub stopped being three nav cards over
 * an expanded ontology panel: it kept promising that layout while a header, a
 * square canvas, two cards, the neighbor lists and a COLLAPSED footer turned
 * up instead. Every visit showed one shape and snapped to another, which is
 * layout shift dressed up as a loading state -- worse than no skeleton, since
 * a skeleton is a promise about dimensions.
 *
 * The canvas box repeats the geometry from constellation-canvas.tsx exactly
 * (square, capped at min(78vh, 620px)). Those two numbers have to move
 * together; if they ever disagree this page is where it will show.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Skeleton style={{ height: '1.9rem', width: '11rem', borderRadius: 6 }} />
        <TextLine width="17rem" height="0.85rem" />
      </header>

      <section className="flex flex-col gap-2">
        {/* The caption above the canvas: "<node> — N things, M relationships" */}
        <TextLine width="14rem" height="0.9rem" />
        <Skeleton
          className="w-full"
          style={{
            aspectRatio: '1 / 1',
            maxHeight: 'min(78vh, 620px)',
            borderRadius: 'var(--radius-card, 12px)',
          }}
        />
        <TextLine width="8rem" height="0.75rem" />
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-xl border p-4"
            style={{ borderColor: 'var(--tl-border)' }}
          >
            <TextLine width="9rem" height="1.1rem" />
            <TextLine width="85%" height="0.85rem" />
          </div>
        ))}
      </div>

      {/* Two neighbor groups, at the real grid's column counts. Mismatched
          columns reflow visibly, which is the defect this file exists to
          avoid rather than to cause. */}
      {[0, 1].map((g) => (
        <section key={g} className="flex flex-col gap-3">
          <Skeleton style={{ height: '0.7rem', width: '7rem', borderRadius: 4 }} />
          <ul className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 md:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i} className="flex items-center gap-2">
                <Skeleton className="size-9 shrink-0" style={{ borderRadius: 999 }} />
                <TextLine width="70%" height="0.8rem" />
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* The collapsed footer, at its closed height -- not the open panel. */}
      <Skeleton style={{ height: '2.75rem', width: '100%', borderRadius: 12 }} />
    </div>
  );
}
