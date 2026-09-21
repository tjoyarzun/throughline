/**
 * Genres are neutral; themes are accent-outlined. That visual distinction is
 * deliberate — themes are our curated vocabulary, genres are a provider's, and
 * the UI should say so without explaining itself. See docs/ontology.md.
 */
export type ChipVariant = 'neutral' | 'theme' | 'provenance';

export function Chip({
  children,
  variant = 'neutral',
}: {
  children: React.ReactNode;
  variant?: ChipVariant;
}) {
  const style =
    variant === 'theme'
      ? { borderColor: 'var(--tl-accent)', color: 'var(--tl-text)' }
      : variant === 'provenance'
        ? {
            borderColor: 'var(--tl-border)',
            color: 'var(--tl-text-faint)',
            fontFamily: 'var(--font-mono)',
          }
        : { borderColor: 'var(--tl-border)', color: 'var(--tl-text-dim)' };

  return (
    <span
      className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs leading-none"
      style={style}
    >
      {children}
    </span>
  );
}
