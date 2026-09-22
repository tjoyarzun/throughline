'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAccountId } from '@/server/auth/session';
import * as episodes from '@/server/repos/episodes';
import { setStatus } from '@/server/repos/user';

/** Progress is visible on Now, in Library and on the title page. */
function revalidateProgress(slug?: string): void {
  revalidatePath('/');
  revalidatePath('/library');
  if (slug) {
    revalidatePath(`/title/${slug}`);
    revalidatePath(`/title/${slug}/s/[n]`, 'page');
  }
}

const base = z.object({
  titleId: z.string().uuid(),
  slug: z.string().optional(),
});

export type ProgressReply =
  | { ok: true; watched: number; aired: number; justCompleted: boolean }
  | { ok: false; error: string };

export async function setEpisodeWatchedAction(input: {
  titleId: string;
  episodeId: string;
  watched: boolean;
  slug?: string;
}): Promise<ProgressReply> {
  const accountId = await requireAccountId();
  const parsed = base
    .extend({ episodeId: z.string().uuid(), watched: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid request' };

  const r = await episodes.setEpisodeWatched(
    accountId,
    parsed.data.titleId,
    parsed.data.episodeId,
    parsed.data.watched,
  );
  revalidateProgress(parsed.data.slug);
  return { ok: true, ...r };
}

export async function markThroughAction(input: {
  titleId: string;
  episodeId: string;
  slug?: string;
}): Promise<ProgressReply> {
  const accountId = await requireAccountId();
  const parsed = base.extend({ episodeId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid request' };

  const r = await episodes.markThrough(accountId, parsed.data.titleId, parsed.data.episodeId);
  revalidateProgress(parsed.data.slug);
  return { ok: true, ...r };
}

export async function markSeasonAction(input: {
  titleId: string;
  seasonNumber: number;
  watched: boolean;
  slug?: string;
}): Promise<ProgressReply> {
  const accountId = await requireAccountId();
  const parsed = base
    .extend({ seasonNumber: z.number().int().min(0), watched: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid request' };

  const r = await episodes.markSeason(
    accountId,
    parsed.data.titleId,
    parsed.data.seasonNumber,
    parsed.data.watched,
  );
  revalidateProgress(parsed.data.slug);
  return { ok: true, ...r };
}

/**
 * Confirm finishing a show.
 *
 * Separate from the episode actions on purpose: reaching the last aired
 * episode REPORTS completion, and this is the person agreeing. A show that is
 * still in production is not over just because you are caught up.
 */
export async function confirmFinishedAction(input: {
  titleId: string;
  slug?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const accountId = await requireAccountId();
  const parsed = base.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid request' };

  await setStatus(accountId, parsed.data.titleId, 'watched', 'auto_from_episode');
  revalidateProgress(parsed.data.slug);
  return { ok: true };
}
