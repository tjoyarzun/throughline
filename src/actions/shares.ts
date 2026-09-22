'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAccountId } from '@/server/auth/session';
import { createShare, revokeShare } from '@/server/repos/shares';

/**
 * Share creation.
 *
 * Returns the slug rather than the full URL: the origin belongs to the
 * client, which is also where navigator.share has to be called from.
 */
export async function createShareAction(input: {
  titleId: string;
  includeRating?: boolean;
  message?: string | null;
}): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const accountId = await requireAccountId();
  const parsed = z
    .object({
      titleId: z.string().uuid(),
      includeRating: z.boolean().optional(),
      message: z.string().max(280).nullable().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid request' };

  const r = await createShare(accountId, parsed.data.titleId, {
    includeRating: parsed.data.includeRating ?? true,
    message: parsed.data.message ?? null,
  });
  return { ok: true, slug: r.slug };
}

export async function revokeShareAction(input: {
  slug: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const accountId = await requireAccountId();
  const parsed = z.object({ slug: z.string().min(10).max(40) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid request' };

  await revokeShare(accountId, parsed.data.slug);
  // The public page is cached; revoking has to take effect promptly or the
  // link keeps working after someone has explicitly killed it.
  revalidatePath(`/s/${parsed.data.slug}`);
  revalidatePath('/me');
  return { ok: true };
}
