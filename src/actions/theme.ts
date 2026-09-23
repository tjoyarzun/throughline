'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { THEME_COOKIE, isTheme, type Theme } from '@/lib/theme';

/**
 * Store the color-scheme choice.
 *
 * Not httpOnly: nothing here is a secret, and a future client-side reader
 * (an OS-level change while the tab is open, say) should be able to see it.
 * SameSite=Lax and a year of life, because it is a preference, not a session.
 *
 * revalidatePath('/', 'layout') rather than a narrower path: the attribute
 * lives on <html> in the ROOT layout, so every route's rendered output
 * depends on it.
 */
export async function setTheme(theme: Theme): Promise<void> {
  if (!isTheme(theme)) throw new Error('setTheme: unknown theme');
  const jar = await cookies();
  jar.set(THEME_COOKIE, theme, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  revalidatePath('/', 'layout');
}

/**
 * Form-submission wrapper, so the control works with scripting off.
 *
 * The three choices are submit buttons carrying name/value rather than
 * onClick handlers -- the same reason the rest of this app degrades: a
 * preference control that only works once JavaScript has hydrated is a
 * preference control that does not work on the slow phone it exists for.
 */
export async function applyTheme(form: FormData): Promise<void> {
  const value = form.get('theme');
  if (typeof value !== 'string' || !isTheme(value)) throw new Error('applyTheme: unknown theme');
  await setTheme(value);
}
