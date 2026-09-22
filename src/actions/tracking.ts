'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAccountId } from '@/server/auth/session';
import * as user from '@/server/repos/user';
import { enqueueEpisodeHydration } from '@/server/repos/tracking-hooks';
import { STATUSES, DATE_PRECISIONS, MEDIUMS, RATING_MIN, RATING_MAX } from '@/lib/tracking';

/**
 * Mutations for the personal layer.
 *
 * Every one of these: resolve the account from the session (never from an
 * argument -- a titleId can come from the client, an accountId never can),
 * parse with Zod, call the repository, revalidate.
 */

const uuid = z.string().uuid();
const stars = z
  .number()
  .min(RATING_MIN / 2)
  .max(RATING_MAX / 2)
  .refine((n) => Number.isInteger(n * 2), { message: 'ratings are in half stars' });

const viewingDetails = z
  .object({
    watchedOn: z.string().date().nullable().optional(),
    datePrecision: z.enum(DATE_PRECISIONS).optional(),
    companions: z.array(z.string().min(1).max(80)).max(20).nullable().optional(),
    location: z.string().max(120).nullable().optional(),
    medium: z.enum(MEDIUMS).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .optional();

/** Revalidate everything a tracking change can be visible on. */
function revalidateTracking(slug?: string): void {
  revalidatePath('/');
  revalidatePath('/library');
  if (slug) revalidatePath(`/title/${slug}`);
}

export async function setStatusAction(input: {
  titleId: string;
  status: string;
  slug?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const accountId = await requireAccountId();
  const parsed = z
    .object({ titleId: uuid, status: z.enum(STATUSES), slug: z.string().optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid request' };

  await user.setStatus(accountId, parsed.data.titleId, parsed.data.status);
  // Tracking a show is the trigger for pulling its episodes; without them
  // there is no progress, no next episode and no Continue Watching.
  if (parsed.data.status === 'watching' || parsed.data.status === 'watched') {
    await enqueueEpisodeHydration(parsed.data.titleId);
  }
  revalidateTracking(parsed.data.slug);
  return { ok: true };
}

export async function markWatchedAction(input: {
  titleId: string;
  stars?: number;
  details?: z.infer<typeof viewingDetails>;
  slug?: string;
}): Promise<{ ok: true; isRewatch: boolean } | { ok: false; error: string }> {
  const accountId = await requireAccountId();
  const parsed = z
    .object({
      titleId: uuid,
      stars: stars.optional(),
      details: viewingDetails,
      slug: z.string().optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid request' };

  const r = await user.markWatched(accountId, parsed.data.titleId, {
    stars: parsed.data.stars,
    details: parsed.data.details,
  });
  await enqueueEpisodeHydration(parsed.data.titleId);
  revalidateTracking(parsed.data.slug);
  return { ok: true, isRewatch: r.isRewatch };
}

export async function setRatingAction(input: {
  titleId: string;
  stars: number | null;
  slug?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const accountId = await requireAccountId();
  const parsed = z
    .object({ titleId: uuid, stars: stars.nullable(), slug: z.string().optional() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid rating' };

  if (parsed.data.stars === null) {
    await user.clearRating(accountId, parsed.data.titleId);
  } else {
    await user.setRating(accountId, parsed.data.titleId, parsed.data.stars);
  }
  revalidateTracking(parsed.data.slug);
  return { ok: true };
}

export async function toggleFavoriteAction(input: {
  titleId: string;
  slug?: string;
}): Promise<{ ok: true; isFavorite: boolean } | { ok: false; error: string }> {
  const accountId = await requireAccountId();
  const parsed = z.object({ titleId: uuid, slug: z.string().optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid request' };

  const r = await user.toggleFavorite(accountId, parsed.data.titleId);
  revalidateTracking(parsed.data.slug);
  return { ok: true, isFavorite: r.isFavorite };
}

export async function removeFromLibraryAction(input: {
  titleId: string;
  slug?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const accountId = await requireAccountId();
  const parsed = z.object({ titleId: uuid, slug: z.string().optional() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid request' };

  await user.removeFromLibrary(accountId, parsed.data.titleId);
  revalidateTracking(parsed.data.slug);
  return { ok: true };
}
