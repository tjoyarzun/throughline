import { Skeleton } from '@/components/ui/skeleton';

/** Mirrors the detail header: backdrop, overlapping poster, title block. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <Skeleton className="aspect-video w-full" style={{ borderRadius: 'var(--radius-card)' }} />
        <div className="flex items-end gap-4">
          <Skeleton className="aspect-[2/3] w-24 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-2 pb-1">
            <Skeleton style={{ height: '1.75rem', width: '70%', borderRadius: 6 }} />
            <Skeleton style={{ height: '0.75rem', width: '45%', borderRadius: 4 }} />
          </div>
        </div>
      </div>
      {/* The action row: the thing people came to tap. */}
      <Skeleton style={{ height: '2.75rem', width: '100%', borderRadius: 999 }} />
      <div className="flex flex-col gap-2">
        {[100, 96, 60].map((w) => (
          <Skeleton key={w} style={{ height: '0.9rem', width: `${w}%`, borderRadius: 4 }} />
        ))}
      </div>
    </div>
  );
}
