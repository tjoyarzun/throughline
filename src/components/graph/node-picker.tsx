'use client';

import { useEffect, useRef, useState } from 'react';

export interface PickedNode {
  type: string;
  id: string;
  label: string;
  sublabel: string | null;
}

/**
 * Typeahead over every graph node type.
 *
 * Deliberately not restricted to titles: the most interesting question is
 * often between a person and a film, or a theme and a franchise, and
 * restricting the picker would quietly narrow the product to "similar movies".
 */
export function NodePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: PickedNode | null;
  onChange: (n: PickedNode | null) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PickedNode[]>([]);
  const [open, setOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const res = await fetch(`/api/graph/search?q=${encodeURIComponent(query)}`, {
          signal: ac.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { results: PickedNode[] };
        setResults(data.results);
        setOpen(true);
      } catch {
        // Aborted or offline; leave whatever is shown.
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-xs" style={{ color: 'var(--tl-text-dim)' }}>
          {label}
        </span>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setQ('');
            setResults([]);
          }}
          className="flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left"
          style={{ borderColor: 'var(--tl-accent)', background: 'var(--tl-surface)' }}
        >
          <span className="flex min-w-0 flex-col">
            <span className="line-clamp-1 text-sm">{value.label}</span>
            <span
              className="text-[10px] uppercase tracking-wide"
              style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
            >
              {value.type}
              {value.sublabel ? ` · ${value.sublabel}` : ''}
            </span>
          </span>
          <span aria-hidden style={{ color: 'var(--tl-text-dim)' }}>
            ×
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col gap-1.5">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs" style={{ color: 'var(--tl-text-dim)' }}>
          {label}
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="A film, a person, a theme…"
          className="min-h-11 rounded-lg border px-3 py-2 text-base"
          style={{
            background: 'var(--tl-surface)',
            borderColor: 'var(--tl-border-strong)',
            color: 'var(--tl-text)',
          }}
        />
      </label>

      {open && results.length > 0 && (
        <ul
          className="absolute top-full z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border"
          style={{ background: 'var(--tl-surface)', borderColor: 'var(--tl-border-strong)' }}
        >
          {results.map((r) => (
            <li key={`${r.type}-${r.id}`}>
              <button
                type="button"
                onClick={() => {
                  onChange(r);
                  setOpen(false);
                }}
                className="flex w-full min-h-11 flex-col items-start px-3 py-2 text-left"
              >
                <span className="line-clamp-1 text-sm">{r.label}</span>
                <span
                  className="text-[10px] uppercase tracking-wide"
                  style={{ color: 'var(--tl-text-dim)', fontFamily: 'var(--font-mono)' }}
                >
                  {r.type}
                  {r.sublabel ? ` · ${r.sublabel}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
