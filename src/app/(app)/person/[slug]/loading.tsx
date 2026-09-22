import { Skeleton, HeadLine, TextLine, PosterGridSkeleton } from '@/components/ui/skeleton';

/** Circular headshot, name block, clamped bio, then filmography per role. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-start gap-4">
        <Skeleton className="h-24 w-24 shrink-0" style={{ borderRadius: '9999px' }} />
        <div className="flex min-w-0 flex-col gap-2">
          <Skeleton style={{ height: '1.9rem', width: '11rem', borderRadius: 6 }} />
          <TextLine width="7rem" height="0.7rem" />
        </div>
      </header>

      {/*
        NO bio block here, deliberately.
        core.person.biography is populated for 0 of 58,714 people (layers-ok:
        this is prose about the schema, not a query): ingest only
        stores what a credits payload carries, and that has no biography. The
        page renders it conditionally, so reserving space for it would shift
        the layout on every person page. Put it back when person detail is
        actually hydrated.
      */}

      {/* Filmography, grouped by role. Most people have one large group and
          perhaps a small second one. */}
      <section className="flex flex-col gap-3">
        <HeadLine width="8rem" />
        <PosterGridSkeleton count={9} />
      </section>
      <section className="flex flex-col gap-3">
        <HeadLine width="6rem" />
        <PosterGridSkeleton count={3} />
      </section>
    </div>
  );
}
