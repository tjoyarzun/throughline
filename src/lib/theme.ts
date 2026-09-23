/**
 * The reader's color-scheme choice.
 *
 * A cookie rather than a column on usr.account, deliberately. The choice is
 * about the device in your hand -- dark on a phone at night, light on a
 * laptop in an office -- and an account-wide setting would force one of those
 * onto the other. It also means the preference works on the public pages,
 * where there is no account to read.
 *
 * Read server-side in the root layout and written onto <html>, so the first
 * paint is already correct. The usual alternative, an inline script that
 * patches the attribute before hydration, exists to avoid a flash on pages
 * rendered ahead of the request -- there are none here; every route in this
 * app is force-dynamic -- and it would need the CSP nonce, which is one more
 * thing to get wrong.
 */
export const THEME_COOKIE = 'tl-theme';

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export function isTheme(value: string | undefined): value is Theme {
  return THEMES.includes(value as Theme);
}

/**
 * The value for the `data-theme` attribute, or null for 'system'.
 *
 * 'system' must write NO attribute rather than a `data-theme="system"`: the
 * stylesheet keys its dark block on `:root:not([data-theme='light'])` inside a
 * prefers-color-scheme query, and an unrecognized attribute value would leave
 * that matching while the explicit blocks do not -- following the device, but
 * for a reason nobody reading the CSS would expect.
 */
export function themeAttribute(theme: Theme): 'light' | 'dark' | null {
  return theme === 'system' ? null : theme;
}

export const THEME_LABEL: Record<Theme, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};
