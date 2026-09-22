'use server';

import { z } from 'zod';
import { requireAccountId, getSession } from '@/server/auth/session';
import { deleteAccount, type DeletionReceipt } from '@/server/repos/account';

/**
 * Deleting your own account.
 *
 * Confirmation is by typed email rather than a checkbox, and it is checked
 * against the SESSION's email on the server -- not against a value the form
 * sent along with it, which would confirm nothing. A client that posts
 * {confirm: x, email: x} always agrees with itself.
 */
export async function deleteAccountAction(input: {
  confirm: string;
}): Promise<{ ok: true; receipt: DeletionReceipt[] } | { ok: false; error: string }> {
  const accountId = await requireAccountId();
  const session = await getSession();

  const parsed = z.object({ confirm: z.string().min(1).max(320) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid request' };

  const expected = session?.user.email?.trim().toLowerCase();
  if (!expected || parsed.data.confirm.trim().toLowerCase() !== expected) {
    return { ok: false, error: 'That does not match the email on this account.' };
  }

  const receipt = await deleteAccount(accountId);

  // No revalidatePath: the account is gone, and asking Next to re-render a
  // page that queries it would only produce an error. The client signs out,
  // which is what actually clears the session cookie.
  return { ok: true, receipt };
}
