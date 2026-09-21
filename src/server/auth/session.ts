import { headers } from 'next/headers';
import { cache } from 'react';
import { auth } from './auth';

/**
 * Session access.
 *
 * `getAccountId()` returns the id that RLS filters on. Because Better Auth's
 * user model IS `usr.account`, the session user id and the account id are the
 * same value — no lookup, no mapping table, no chance of them drifting apart.
 *
 * Wrapped in React's `cache` so several server components in one render share
 * a single session read rather than each hitting the database.
 */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

export async function getAccountId(): Promise<string | null> {
  const session = await getSession();
  return session?.user.id ?? null;
}

/**
 * For anything that cannot proceed without a user.
 *
 * Throws rather than returning null on purpose: a caller that forgets to check
 * would otherwise pass `undefined` into a repository function and query with
 * no account scope. Loud beats silent — see docs/architecture.md.
 */
export async function requireAccountId(): Promise<string> {
  const id = await getAccountId();
  if (!id) throw new Error('requireAccountId: no authenticated session');
  return id;
}
