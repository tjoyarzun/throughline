import { applyTheme } from '@/actions/theme';
import { THEMES, THEME_LABEL, type Theme } from '@/lib/theme';

/**
 * Light / Dark / System.
 *
 * A form of submit buttons, not a client component: the choice is one round
 * trip and the result is a re-render of the whole document, so there is
 * nothing for client state to do. It also means the control works before
 * hydration, which is the point of having it on the slow phone at all.
 *
 * aria-pressed rather than aria-current -- these are toggles among
 * themselves, not navigation. System is named explicitly rather than implied
 * by neither other being selected, because "follow the device" is a choice
 * somebody should be able to make on purpose after choosing otherwise.
 */
export function ThemeControl({ current }: { current: Theme }) {
  return (
    <form action={applyTheme} className="flex gap-1">
      {THEMES.map((t) => {
        const active = t === current;
        return (
          <button
            key={t}
            type="submit"
            name="theme"
            value={t}
            aria-pressed={active}
            className="min-h-11 flex-1 rounded-lg px-3 text-sm"
            style={{
              border: `1px solid ${active ? 'var(--tl-accent)' : 'var(--tl-border)'}`,
              background: active ? 'var(--tl-surface-2)' : 'var(--tl-surface)',
              color: active ? 'var(--tl-text)' : 'var(--tl-text-dim)',
            }}
          >
            {THEME_LABEL[t]}
          </button>
        );
      })}
    </form>
  );
}
