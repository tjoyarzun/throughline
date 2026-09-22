import { Skeleton } from '@/components/ui/skeleton';

/**
 * The baseline loading state for every app route.
 *
 * This file does more than look nice. Every page here is force-dynamic, and
 * Next's Link prefetch only fetches as far as the nearest loading boundary --
 * with none, prefetch had nothing to cache and a tap rendered NOTHING until
 * the server answered, around 300-440ms warm and near two seconds cold. That
 * silence is what reads as slowness; the request was never the whole story.
 *
 * Routes with a distinctive shape override this with their own skeleton, so
 * the placeholder matches what actually arrives and nothing shifts (CLS).
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton style={{ height: '2rem', width: '9rem', borderRadius: 6 }} />
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
