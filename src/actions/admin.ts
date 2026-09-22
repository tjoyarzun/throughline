'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAccountId } from '@/server/auth/session';
import {
  adminCreateInvite,
  adminRevokeInvite,
  adminRevokeSession,
  adminSessions,
  type AdminSession,
} from '@/server/repos/admin';

/**
 * Admin actions.
 *
 * Note what is deliberately absent: an isAdmin() check. It would be redundant
 * — every function these call raises 42501 from inside the database when the
 * caller is not an admin — and worse than redundant, because having one here
 * invites the belief that it is what does the work. The one in the page is for
 * deciding what to render, nothing more.
 *
 * The errors below are the database's guard reaching the user as a message.
 */

function failed(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return /not an admin/.test(message) ? 'not an admin' : 'something went wrong';
}

export async function createInviteAction(input: {
  email?: string | null;
  days?: number;
}): Promise<{ ok: true; code: string; expiresAt: string } | { ok: false; error: string }> {
  const accountId = await requireAccountId();
  const parsed = z
    .object({
      email: z.string().email().nullable().optional().or(z.literal('')),
      days: z.number().int().min(1).max(365).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'that does not look like an email address' };

  try {
    const r = await adminCreateInvite(accountId, parsed.data.email || '', parsed.data.days ?? 30);
    revalidatePath('/me');
    return { ok: true, code: r.code, expiresAt: r.expires_at };
  } catch (e) {
    return { ok: false, error: failed(e) };
  }
}

export async function revokeInviteAction(input: {
  code: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const accountId = await requireAccountId();
  const parsed = z.object({ code: z.string().min(4).max(32) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid request' };

  try {
    await adminRevokeInvite(accountId, parsed.data.code);
    revalidatePath('/me');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: failed(e) };
  }
}

export async function listSessionsAction(input: {
  accountId: string;
}): Promise<{ ok: true; sessions: AdminSession[] } | { ok: false; error: string }> {
  const me = await requireAccountId();
  const parsed = z.object({ accountId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid request' };

  try {
    return { ok: true, sessions: await adminSessions(me, parsed.data.accountId) };
  } catch (e) {
    return { ok: false, error: failed(e) };
  }
}

export async function revokeSessionAction(input: {
  sessionId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireAccountId();
  // Better Auth owns the session table and its id is text, not a uuid.
  const parsed = z.object({ sessionId: z.string().min(1).max(128) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid request' };

  try {
    await adminRevokeSession(me, parsed.data.sessionId);
    revalidatePath('/me');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: failed(e) };
  }
}
