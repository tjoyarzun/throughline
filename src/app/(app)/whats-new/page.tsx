import Link from 'next/link';
import { BackLink } from '@/components/ui/back-link';
import { RELEASES, type Kind } from '@/content/releases';

export const metadata = { title: "What's new" };
export const dynamic = 'force-dynamic';

/**
 * What changed, for the people who use this.
 *
 * Deliberately NOT the Slack post with a border around it. A message you push
 * at somebody competes for their attention and has to open loud; a page they
 * came to has already won that argument, and can spend its space being
 * scannable instead.
 *
 * So: the consumer register — serif headings, sentences, no version numbers —
 * with the date in mono as metadata rather than as a headline. The Universe is
 * where this app is allowed to be technical. This is not there.
 */
const TAG: Record<Kind, string> = { new: 'New', better: 'Better', fixed: 'Fixed' };

export default function WhatsNewPage() {
  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <BackLink fallback="/me" self="/whats-new" />
        <h1 className="text-3xl leading-tight">What&rsquo;s new</h1>
        <p className="max-w-prose text-sm" style={{ color: 'var(--tl-text-dim)' }}>
          Everything that changed, newest first. No version numbers, because nobody has ever asked
          what version this is.
        </p>
      </header>

      {RELEASES.map((r) => (
        <section key={r.date} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <time
              dateTime={r.date}
              className="text-[11px] uppercase tracking-widest"
              style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
            >
              {new Date(`${r.date}T12:00:00Z`).toLocaleDateString('en-US', {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </time>
            <h2 className="text-xl leading-tight">{r.name}</h2>
            <p className="text-sm" style={{ color: 'var(--tl-text-dim)' }}>
              {r.summary}
            </p>
          </div>

          <ul
            className="flex flex-col divide-y rounded-xl border"
            style={{ borderColor: 'var(--tl-border)', background: 'var(--tl-surface)' }}
          >
            {r.items.map((item) => (
              <li key={item.title} className="flex flex-col gap-1.5 px-4 py-4">
                <div className="flex items-baseline gap-2.5">
                  {/* The tag is a hairline outline, not a filled badge. Three
                      of these per screen in solid accent would shout, and
                      nothing here is urgent. */}
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider"
                    style={{
                      border: '1px solid var(--tl-border-strong)',
                      color: 'var(--tl-text-dim)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {TAG[item.kind]}
                  </span>
                  <h3 className="text-base leading-snug">{item.title}</h3>
                </div>

                <p
                  className="max-w-prose text-sm leading-relaxed"
                  style={{ color: 'var(--tl-text-dim)' }}
                >
                  {item.body}
                </p>

                {/* A destination, where there is one. The point of reading
                    about a feature is to go and use it, and making somebody
                    navigate back to find it is how a changelog goes unread. */}
                {item.href && (
                  <Link
                    href={item.href}
                    className="min-h-11 self-start pt-1 text-xs underline-offset-4 hover:underline"
                    style={{ color: 'var(--tl-text)' }}
                  >
                    Take a look →
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p className="text-xs" style={{ color: 'var(--tl-text-faint)' }}>
        Built by one person on weekends. Tell me what is broken.
      </p>
    </div>
  );
}
