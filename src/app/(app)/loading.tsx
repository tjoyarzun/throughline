import {
  HeadLine,
  TextLine,
  PosterGridSkeleton,
  PosterRailSkeleton,
} from '@/components/ui/skeleton';

/**
 * Home.
 *
 * Also the fallback for any app route without its own loading file, so it
 * stays close to the commonest shape: a rail, a grid, a rail. Routes whose
 * layout differs enough to reflow have their own.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <TextLine width="11rem" height="0.7rem" />

      {/*
        No Continue Watching rail here, deliberately.

        That section is conditional -- it renders only for shows in progress
        that have episodes ingested -- and reserving 16:9 cards for it leaves a
        tall gap that COLLAPSES when the real page arrives. A skeleton that
        under-promises fills downward, which reads as content loading; one that
        over-promises jumps upward, which reads as a glitch.
      */}

      <section className="flex flex-col gap-3">
        <HeadLine width="5rem" />
        <PosterGridSkeleton count={6} className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-6" />
      </section>

      <section className="flex flex-col gap-3">
        <HeadLine width="10rem" />
        <PosterRailSkeleton count={8} />
      </section>
    </div>
  );
}
