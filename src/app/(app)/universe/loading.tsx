import { Skeleton, HeadLine, TextLine } from '@/components/ui/skeleton';

/** Three nav cards over the ontology panel, whose rows are fixed in number. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Skeleton style={{ height: '1.9rem', width: '11rem', borderRadius: 6 }} />
        <TextLine width="16rem" height="0.85rem" />
      </header>

      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
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

      <section
        className="flex flex-col gap-4 rounded-xl border p-4"
        style={{ borderColor: 'var(--tl-border)' }}
      >
        <HeadLine width="10rem" />
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <TextLine width="4rem" height="0.6rem" />
              <TextLine width="3rem" height="1.25rem" />
            </div>
          ))}
        </div>
        <div
          className="flex flex-col gap-1.5 border-t pt-3"
          style={{ borderColor: 'var(--tl-border)' }}
        >
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3">
              <TextLine width="8rem" height="0.7rem" />
              <TextLine width="3rem" height="0.7rem" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
