import { Skeleton, HeadLine, TextLine } from '@/components/ui/skeleton';

/** Name, email, then a three-row account list of known height. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <Skeleton style={{ height: '1.9rem', width: '9rem', borderRadius: 6 }} />
        <TextLine width="13rem" height="0.85rem" />
      </header>

      <section className="flex flex-col gap-3">
        <HeadLine width="5rem" />
        <div
          className="flex flex-col divide-y rounded-xl border"
          style={{ borderColor: 'var(--tl-border)' }}
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4 px-4 py-3">
              <TextLine width="6rem" height="0.85rem" />
              <TextLine width="8rem" height="0.85rem" />
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <HeadLine width="7rem" />
        <TextLine width="95%" />
        <TextLine width="60%" />
      </section>
    </div>
  );
}
