import { Skeleton, HeadLine, TextLine } from '@/components/ui/skeleton';

/**
 * Matches the FOCUSED orbit rather than the start grid.
 *
 * Both shapes live on this route, and only one can get a placeholder — loading.tsx
 * receives no params, so it cannot branch on ?focus. The orbit wins because it
 * is the repeated action: walking the graph re-enters this route on every tap,
 * while the start grid is seen once on the way in.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <TextLine width="6rem" height="0.7rem" />

      <div
        className="flex items-center gap-4 rounded-xl border p-4"
        style={{ borderColor: 'var(--tl-border)' }}
      >
        <Skeleton className="aspect-[2/3] w-16 shrink-0" />
        <div className="flex min-w-0 flex-col gap-2">
          <TextLine width="10rem" height="1.25rem" />
          <TextLine width="12rem" height="0.65rem" />
        </div>
      </div>

      {[0, 1, 2].map((g) => (
        <section key={g} className="flex flex-col gap-2">
          <HeadLine width="7rem" />
          <ul className="flex gap-3 overflow-hidden pb-1">
            {Array.from({ length: 7 }, (_, i) => (
              <li key={i} className="flex w-[84px] shrink-0 flex-col gap-1.5">
                <Skeleton className="aspect-[2/3] w-full" />
                <TextLine width="90%" height="0.7rem" />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
