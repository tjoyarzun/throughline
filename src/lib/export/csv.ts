import type { AccountExport } from '@/server/repos/account';

/**
 * RFC 4180 quoting.
 *
 * Every field is quoted rather than only the ones that need it. Conditional
 * quoting means a rule deciding which fields are dangerous, and a film called
 * *Nope, "Nope"* or a note containing a newline is exactly the row that would
 * shift every subsequent column by one and corrupt the file silently. Quoting
 * unconditionally removes the decision.
 */
function field(v: unknown): string {
  if (v === null || v === undefined) return '""';
  const s = Array.isArray(v) ? v.join('; ') : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * One row per title, which is the shape a person can actually open.
 *
 * The first six columns are Title, Year, Rating, WatchedDate, Rewatch and
 * Review -- the columns Letterboxd's importer reads -- so this file can be
 * fed straight into it. The remaining columns are ours and are ignored by any
 * importer that does not know them.
 *
 * Rating is halved back to the 0.5-5.0 scale people see, not the 1-10 smallint
 * the database stores. Exporting the storage representation would be exporting
 * an implementation detail.
 */
export function titlesCsv(data: AccountExport): string {
  const header = [
    'Title',
    'Year',
    'Rating',
    'WatchedDate',
    'Rewatch',
    'Review',
    'Status',
    'Favorite',
    'Kind',
    'Views',
    'EpisodesWatched',
    'AddedDate',
    'TMDbID',
  ];

  // Notes live on the viewing, so the most recent one per title is the review.
  const review = new Map<string, string>();
  for (const v of data.viewings) {
    if (v.note && !review.has(v.title)) review.set(v.title, v.note);
  }

  const lines = [header.map(field).join(',')];
  for (const t of data.titles) {
    lines.push(
      [
        t.title,
        t.year,
        t.rating === null ? null : t.rating / 2,
        t.last_watched_on,
        t.view_count > 1,
        review.get(t.title) ?? null,
        t.status,
        t.is_favorite,
        t.kind,
        t.view_count,
        t.episodes_watched,
        // A spreadsheet column, so a date -- not the microsecond timestamp
        // with offset that the database stores. The JSON export keeps the
        // full value for anyone who needs it.
        t.added_at?.slice(0, 10) ?? null,
        t.tmdb_id,
      ]
        .map(field)
        .join(','),
    );
  }
  // A trailing newline: without it the last row is a partial line and some
  // parsers drop it.
  return lines.join('\r\n') + '\r\n';
}
