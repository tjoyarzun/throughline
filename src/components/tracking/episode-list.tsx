'use client';

import { useState, useTransition } from 'react';
import {
  setEpisodeWatchedAction,
  markThroughAction,
  markSeasonAction,
  confirmFinishedAction,
} from '@/actions/episodes';
import { stillUrl } from '@/lib/tmdb-image';
import type { EpisodeRow } from '@/server/repos/episodes';

/**
 * A season's episodes, with the two bulk actions that matter.
 *
 * "Mark through here" is the one most trackers omit and the one people
 * actually need: you do not tick forty boxes, you say where you are.
 */
export function EpisodeList({
  titleId,
  slug,
  seasonNumber,
  initial,
}: {
  titleId: string;
  slug: string;
  seasonNumber: number;
  initial: EpisodeRow[];
}) {
  const [eps, setEps] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [finishPrompt, setFinishPrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const airedCount = eps.filter((e) => e.has_aired).length;
  const watchedCount = eps.filter((e) => e.watched).length;

  function apply(
    next: EpisodeRow[],
    run: () => Promise<{ ok: true; justCompleted: boolean } | { ok: false; error: string }>,
  ): void {
    const prev = eps;
    setError(null);
    startTransition(async () => {
      setEps(next);
      const res = await run();
      if (!res.ok) {
        setEps(prev);
        setError('Could not save that.');
        return;
      }
      // Reaching the end REPORTS completion; the person decides.
      if (res.justCompleted) setFinishPrompt(true);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span
          className="text-xs tabular-nums"
          style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          {watchedCount} of {airedCount} aired
        </span>
        <button
          type="button"
          disabled={pending}
          className="min-h-9 rounded-full px-3 text-xs"
          style={{ border: '1px solid var(--tl-border-strong)', color: 'var(--tl-text-dim)' }}
          onClick={() => {
            const all = watchedCount < airedCount;
            apply(
              eps.map((e) => (e.has_aired ? { ...e, watched: all } : e)),
              () => markSeasonAction({ titleId, seasonNumber, watched: all, slug }),
            );
          }}
        >
          {watchedCount < airedCount ? 'Mark season watched' : 'Clear season'}
        </button>
      </div>

      {finishPrompt && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-xl border p-3"
          style={{ borderColor: 'var(--tl-accent)', background: 'var(--tl-surface)' }}
        >
          <span className="text-sm">You’re caught up. Mark the whole show watched?</span>
          <span className="flex shrink-0 gap-2">
            <button
              type="button"
              className="min-h-9 rounded-full px-3 text-xs"
              style={{ background: 'var(--tl-accent)', color: 'var(--tl-bg)', fontWeight: 600 }}
              onClick={() =>
                startTransition(async () => {
                  await confirmFinishedAction({ titleId, slug });
                  setFinishPrompt(false);
                })
              }
            >
              Yes
            </button>
            <button
              type="button"
              className="min-h-9 rounded-full px-3 text-xs"
              style={{ border: '1px solid var(--tl-border-strong)', color: 'var(--tl-text-dim)' }}
              onClick={() => setFinishPrompt(false)}
            >
              Not yet
            </button>
          </span>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--tl-negative)' }}>
          {error}
        </p>
      )}

      <ul className="flex flex-col">
        {eps.map((e) => (
          <li
            key={e.id}
            className="flex items-start gap-3 border-t py-3"
            style={{ borderColor: 'var(--tl-border)' }}
          >
            {/* A real checkbox: it is a checkbox, it must announce itself as
                one and be reachable by keyboard (AC-32). */}
            <input
              type="checkbox"
              checked={e.watched}
              disabled={!e.has_aired || pending}
              aria-label={`Episode ${e.episode_number}${e.name ? `, ${e.name}` : ''}`}
              className="mt-1 h-6 w-6 shrink-0 accent-[var(--tl-accent)]"
              onChange={(ev) => {
                const watched = ev.target.checked;
                apply(
                  eps.map((x) => (x.id === e.id ? { ...x, watched } : x)),
                  () => setEpisodeWatchedAction({ titleId, episodeId: e.id, watched, slug }),
                );
              }}
            />

            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-baseline gap-2">
                <span
                  className="shrink-0 text-xs tabular-nums"
                  style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
                >
                  E{e.episode_number}
                </span>
                <span className="line-clamp-1 text-sm">
                  {e.name ?? `Episode ${e.episode_number}`}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span className="text-[10px]" style={{ color: 'var(--tl-text-dim)' }}>
                  {e.has_aired
                    ? [e.air_date, e.runtime_minutes ? `${e.runtime_minutes} min` : null]
                        .filter(Boolean)
                        .join(' · ')
                    : `airs ${e.air_date ?? 'TBA'}`}
                </span>
                {e.has_aired && !e.watched && (
                  <button
                    type="button"
                    disabled={pending}
                    className="text-[10px] underline-offset-2 hover:underline"
                    style={{ color: 'var(--tl-accent)' }}
                    onClick={() => {
                      const cutoff = e.episode_number;
                      apply(
                        eps.map((x) =>
                          x.has_aired && x.episode_number <= cutoff ? { ...x, watched: true } : x,
                        ),
                        () => markThroughAction({ titleId, episodeId: e.id, slug }),
                      );
                    }}
                  >
                    watched through here
                  </button>
                )}
              </span>
            </span>

            {e.still_path && (
              <span
                className="block w-20 shrink-0 overflow-hidden"
                style={{ borderRadius: 6, background: 'var(--tl-surface-2)', aspectRatio: '16/9' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- TMDB CDN; docs/adr/0012 */}
                <img
                  src={stillUrl(e.still_path, 80)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
