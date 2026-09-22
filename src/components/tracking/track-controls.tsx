'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { StarRating } from './star-rating';
import {
  markWatchedAction,
  setRatingAction,
  setStatusAction,
  toggleFavoriteAction,
} from '@/actions/tracking';
import type { Status } from '@/lib/tracking';

export interface TrackState {
  status: Status | null;
  isFavorite: boolean;
  rating: number | null;
}

/**
 * The primary action row: the single most-used UI in the app.
 *
 * Status, favorite and rating sit side by side but are three orthogonal facts
 * (docs/adr/0005): a favorite is affinity, a rating is judgment, a status is
 * where you are with it. The layout says so by keeping the heart visually
 * apart from the status pill.
 *
 * Every mutation is optimistic, because a 300ms round trip on "mark watched"
 * is felt. A failure reverts and says so rather than leaving the UI lying.
 */
export function TrackControls({
  titleId,
  slug,
  kind,
  initial,
}: {
  titleId: string;
  slug: string;
  kind: string;
  initial: TrackState;
}) {
  const [confirmed, setConfirmed] = useState<TrackState>(initial);
  const [state, setOptimistic] = useOptimistic(confirmed);
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  /**
   * Apply optimistically, then reconcile. useOptimistic only holds its value
   * for the life of the transition, so the confirmed state has to be updated
   * too or the UI snaps back the moment the action resolves.
   */
  function run(next: TrackState, action: () => Promise<{ ok: boolean }>): void {
    setError(null);
    startTransition(async () => {
      setOptimistic(next);
      const prev = confirmed;
      setConfirmed(next);
      try {
        const res = await action();
        if (!res.ok) throw new Error('rejected');
      } catch {
        setConfirmed(prev);
        setError('Could not save that. Try again.');
      }
    });
  }

  const statuses: { value: Status; label: string }[] = [
    { value: 'watchlist', label: 'Watchlist' },
    { value: 'watching', label: kind === 'show' ? 'Watching' : 'Started' },
    { value: 'watched', label: 'Watched' },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div
          role="group"
          aria-label="Status"
          className="flex overflow-hidden rounded-full"
          style={{ border: '1px solid var(--tl-border-strong)' }}
        >
          {statuses.map((s) => {
            const active = state.status === s.value;
            return (
              <button
                key={s.value}
                type="button"
                aria-pressed={active}
                className="min-h-11 px-4 text-sm"
                style={{
                  background: active ? 'var(--tl-accent)' : 'transparent',
                  // Accent is a NON-TEXT token in light mode (3.2:1), so text
                  // on it must be the dark ground, never the accent itself.
                  color: active ? 'var(--tl-bg)' : 'var(--tl-text)',
                  fontWeight: active ? 600 : 400,
                }}
                onClick={() => {
                  // Tapping the active status clears it: the way out of the
                  // library should be the same control that got you in.
                  if (active) {
                    run({ ...state, status: null }, () =>
                      import('@/actions/tracking').then((m) =>
                        m.removeFromLibraryAction({ titleId, slug }),
                      ),
                    );
                    return;
                  }
                  if (s.value === 'watched') {
                    run({ ...state, status: 'watched' }, () =>
                      markWatchedAction({ titleId, slug }),
                    );
                  } else {
                    run({ ...state, status: s.value }, () =>
                      setStatusAction({ titleId, status: s.value, slug }),
                    );
                  }
                }}
              >
                {s.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          aria-pressed={state.isFavorite}
          aria-label={state.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full"
          style={{ border: '1px solid var(--tl-border-strong)' }}
          onClick={() =>
            run({ ...state, isFavorite: !state.isFavorite }, () =>
              toggleFavoriteAction({ titleId, slug }),
            )
          }
        >
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
            <path
              d="M12 20.5l-1.45-1.32C5.4 14.5 2 11.4 2 7.6 2 4.9 4.1 3 6.75 3c1.54 0 3.03.72 4 1.87C11.72 3.72 13.2 3 14.75 3 17.4 3 19.5 4.9 19.5 7.6c0 3.8-3.4 6.9-8.55 11.58z"
              fill={state.isFavorite ? 'var(--tl-accent)' : 'transparent'}
              stroke="var(--tl-accent)"
              strokeWidth="1.6"
              opacity={state.isFavorite ? 1 : 0.55}
            />
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-3">
        <StarRating
          value={state.rating}
          onChange={(starsValue) => {
            // Rating something implies you watched it. Making the person mark
            // it watched first would be the app arguing with them.
            const next: TrackState = {
              ...state,
              rating: starsValue,
              status: starsValue !== null && state.status === null ? 'watched' : state.status,
            };
            run(next, () =>
              starsValue !== null && state.status === null
                ? markWatchedAction({ titleId, stars: starsValue, slug })
                : setRatingAction({ titleId, stars: starsValue, slug }),
            );
          }}
        />
        <span className="text-sm" style={{ color: 'var(--tl-text-dim)' }}>
          {state.rating === null ? 'Rate it' : state.rating.toFixed(1).replace('.0', '')}
        </span>
      </div>

      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--tl-negative)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
