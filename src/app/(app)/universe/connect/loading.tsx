import { Skeleton } from '@/components/ui/skeleton';

/**
 * Path finding is the slowest read in the app (p95 ~173ms plus render), so
 * this is the route where feedback matters most.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton style={{ height: '2rem', width: '13rem', borderRadius: 6 }} />
      <div className="flex flex-col gap-3">
        <Skeleton style={{ height: '3.25rem', width: '100%', borderRadius: 8 }} />
        <Skeleton style={{ height: '3.25rem', width: '100%', borderRadius: 8 }} />
      </div>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} style={{ height: '11rem', width: '100%', borderRadius: 12 }} />
      ))}
    </div>
  );
}
