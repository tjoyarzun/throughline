import { Skeleton, HeadLine, PosterGridSkeleton } from '@/components/ui/skeleton';

/** The input keeps its exact height so the grid does not jump when it lands. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton style={{ height: '3.25rem', width: '100%', borderRadius: 12 }} />
      <HeadLine width="9rem" />
      <PosterGridSkeleton count={12} />
    </div>
  );
}
