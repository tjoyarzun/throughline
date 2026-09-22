import { Skeleton } from '@/components/ui/skeleton';

/** Segment chips sit above the grid, so the grid must not jump when they land. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      <Skeleton style={{ height: '2rem', width: '7rem', borderRadius: 6 }} />
      <div className="flex gap-1">
        {[5.5, 5, 5, 5.5].map((w, i) => (
          <Skeleton key={i} style={{ height: '2.75rem', width: `${w}rem`, borderRadius: 999 }} />
        ))}
      </div>
      <ul className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-6">
        {Array.from({ length: 12 }, (_, i) => (
          <li key={i} className="flex flex-col gap-2">
            <Skeleton className="aspect-[2/3] w-full" />
            <Skeleton style={{ height: '0.8rem', width: '85%', borderRadius: 4 }} />
          </li>
        ))}
      </ul>
    </div>
  );
}
