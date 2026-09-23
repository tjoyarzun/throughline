'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { posterUrl, profileUrl } from '@/lib/tmdb-image';
import { PosterSkeleton } from '@/components/ui/skeleton';

interface LocalResult {
  id: string;
  slug: string;
  kind: string;
  title: string;
  release_year: number | null;
  poster_path: string | null;
  genres: string[];
}
interface PersonResult {
  id: string;
  slug: string;
  name: string;
  known_for_department: string | null;
  profile_path: string | null;
}
interface RemoteResult {
  tmdbId: number;
  kind: string;
  title: string;
  year: number | null;
  posterPath: string | null;
}

/**
 * Search as you type.
 *
 * 250ms debounce and a 2-character minimum, with every in-flight request
 * aborted when the query changes — otherwise a slow response for "ar" can land
 * after a fast one for "arrival" and overwrite it.
 */
export function SearchClient({
  initial = [],
  idle,
}: {
  /**
   * Local rows to show before anything is typed. Empty now that the idle page
   * leads with live trending instead of a frozen popularity ranking -- kept as
   * a prop because the shape is still the right one if a local list ever
   * belongs here again.
   */
  initial?: LocalResult[];
  /**
   * Server-rendered sections shown only when the box is empty. Passed in
   * rather than fetched here so the discovery lists stay on the server, where
   * the TMDB token lives and the response can be cached.
   */
  idle?: React.ReactNode;
}) {
  const [q, setQ] = useState('');
  const [local, setLocal] = useState<LocalResult[]>([]);
  const [remote, setRemote] = useState<RemoteResult[]>([]);
  const [people, setPeople] = useState<PersonResult[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // A query shorter than two characters is handled by DERIVING what to render
  // (see `showing` below), not by clearing state here. Setting state
  // synchronously in an effect body triggers a cascading render, and React's
  // lint rule rejects it.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setBusy(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: ac.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          local: LocalResult[];
          remote: RemoteResult[];
          people: PersonResult[];
        };
        setLocal(data.local);
        setRemote(data.remote);
        setPeople(data.people ?? []);
      } catch {
        // Aborted or offline: keep whatever is on screen rather than blanking it.
      } finally {
        if (!ac.signal.aborted) setBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const showing = q.trim().length >= 2;
  const results = showing ? local : initial;
  // Results from the previous query stay in state when the box is cleared;
  // gating the render on `showing` is what keeps them off screen.
  const remoteResults = showing ? remote : [];
  const loading = busy && showing;

  return (
    <div className="flex flex-col gap-6">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search movies, shows, people"
        aria-label="Search"
        autoFocus
        enterKeyHint="search"
        inputMode="search"
        className="w-full rounded-xl border px-4 py-3 text-base"
        style={{
          background: 'var(--tl-surface)',
          borderColor: 'var(--tl-border-strong)',
          color: 'var(--tl-text)',
        }}
      />

      {!showing && idle}

      {showing && results.length === 0 && remoteResults.length === 0 && !loading && (
        <p className="py-8 text-center text-sm" style={{ color: 'var(--tl-text-dim)' }}>
          Nothing matches “{q.trim()}”.
        </p>
      )}

      {/* Rendered only when it has something in it. An empty grid left in the
          tree is an empty list in the accessibility tree too. */}
      {(results.length > 0 || loading) && (
        <ul className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-6">
          {results.map((t) => (
            <li key={t.id}>
              <Link href={`/title/${t.slug}`} className="group flex flex-col gap-2">
                <Poster path={t.poster_path} alt="" />
                <span className="line-clamp-2 text-sm leading-tight">{t.title}</span>
                {t.release_year && (
                  <span className="text-xs" style={{ color: 'var(--tl-text-dim)' }}>
                    {t.release_year}
                  </span>
                )}
              </Link>
            </li>
          ))}
          {loading &&
            results.length === 0 &&
            [0, 1, 2, 3, 4, 5].map((i) => (
              <li key={`s${i}`}>
                <PosterSkeleton width="100%" />
              </li>
            ))}
        </ul>
      )}

      {showing && people.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2
            className="text-xs uppercase tracking-widest"
            style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
          >
            People
          </h2>
          <ul className="flex flex-col">
            {people.map((p) => (
              <li key={p.id}>
                <Link href={`/person/${p.slug}`} className="flex min-h-14 items-center gap-3 py-2">
                  <span
                    className="block size-10 shrink-0 overflow-hidden rounded-full"
                    style={{ background: 'var(--tl-surface-2)' }}
                  >
                    {p.profile_path && (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={profileUrl(p.profile_path, 80)}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{p.name}</span>
                    {p.known_for_department && (
                      <span className="text-xs" style={{ color: 'var(--tl-text-dim)' }}>
                        {p.known_for_department}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {remoteResults.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2
            className="text-xs uppercase tracking-widest"
            style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
          >
            Not in the library yet
          </h2>
          <ul className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-6">
            {remoteResults.map((r) => (
              <li key={`${r.kind}-${r.tmdbId}`}>
                {/* Opening one of these ingests it. See docs/api.md#ingest. */}
                <Link href={`/title/tmdb-${r.kind}-${r.tmdbId}`} className="flex flex-col gap-2">
                  <Poster path={r.posterPath} alt="" dim />
                  <span className="line-clamp-2 text-sm leading-tight">{r.title}</span>
                  {r.year && (
                    <span className="text-xs" style={{ color: 'var(--tl-text-dim)' }}>
                      {r.year}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Poster({ path, alt, dim }: { path: string | null; alt: string; dim?: boolean }) {
  const src = posterUrl(path, 160);
  return (
    <span
      className="relative block aspect-[2/3] w-full overflow-hidden"
      style={{
        borderRadius: 'var(--radius-poster)',
        background: 'var(--tl-surface-2)',
        boxShadow: 'inset 0 0 0 1px var(--tl-poster-inset)',
        opacity: dim ? 0.75 : 1,
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- TMDB CDN; see docs/adr/0012
        <img src={src} alt={alt} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <span
          aria-hidden
          className="absolute inset-0 grid place-items-center text-xs"
          style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
        >
          no art
        </span>
      )}
    </span>
  );
}
