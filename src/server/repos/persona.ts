import { sql } from 'drizzle-orm';
import { withUser, type Tx } from '../db/client';
import { tasteSummary, tasteByPredicate } from './taste';

/**
 * A watcher, described from their own graph.
 *
 * Every line is a fact with a query behind it. No model, no adjectives the
 * data cannot support, and no archetype quiz -- the point of this app is that
 * its claims are checkable, and a persona card is the single most shareable
 * place for that to be true or to be obviously false.
 *
 * The headline is the strongest thing the graph will say about somebody, and
 * COVERAGE is what makes it worth saying: "4 of Villeneuve's 11" is a
 * statement about you against the whole corpus, where "4 films" is a statement
 * about a list. That contrast is the thesis of the personal layer, and it is
 * the line most likely to make somebody post the card.
 */
export interface PersonaLine {
  label: string;
  value: string;
}

export interface Persona {
  /** The one sentence. Derived, never generated. */
  headline: string;
  /** The evidence for the headline, in a phrase. Null when it has none. */
  subhead: string | null;
  lines: PersonaLine[];
  /** Enough history for any of this to mean something. */
  ready: boolean;
  /**
   * The card's color and its piece of art, taken from ONE title: the thing
   * you rated highest, most recently.
   *
   * Not an invented palette and not a hash of a name. The accent is extracted
   * from that poster's own most chromatic region and stored on the title, so
   * two people whose favorite is the same film get the same color, and a
   * person whose taste moves sees their card move with it.
   *
   * Null on a library with nothing rated, or when the poster is black and
   * white and genuinely has no hue. The card falls back to gold, which is
   * what every surface reading accent_color has always done.
   */
  accent: string | null;
  posterPath: string | null;
  posterTitle: string | null;
}

async function rows<T>(tx: Tx, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await tx.execute(query)) as unknown as T[];
}

/** The highest-rated thing you have watched, most recent first among ties. */
async function favorite(
  accountId: string,
): Promise<{ accent: string | null; poster: string | null; title: string | null }> {
  const found = await withUser(accountId, async (tx) =>
    rows<{ accent_color: string | null; poster_path: string | null; title: string }>(
      tx,
      sql`
        SELECT t.accent_color, t.poster_path, t.title
        FROM sem.user_title ut
        JOIN sem.title t ON t.id = ut.title_id
        WHERE ut.account_id = ${accountId}
          AND ut.status = 'watched'
          AND t.poster_path IS NOT NULL
        ORDER BY ut.rating DESC NULLS LAST, ut.last_watched_on DESC NULLS LAST
        LIMIT 1`,
    ),
  );
  const f = found[0];
  return {
    accent: f?.accent_color ?? null,
    poster: f?.poster_path ?? null,
    title: f?.title ?? null,
  };
}

/** Percentage, rounded, guarding the zero-corpus case. */
function share(seen: number, total: number): number {
  return total > 0 ? Math.round((seen / total) * 100) : 0;
}

export async function persona(accountId: string): Promise<Persona> {
  const [summary, directors, themes, actors, fav] = await Promise.all([
    tasteSummary(accountId),
    tasteByPredicate(accountId, 'directed_by', 3),
    tasteByPredicate(accountId, 'explores_theme', 3),
    tasteByPredicate(accountId, 'features_actor', 3),
    favorite(accountId),
  ]);

  /* Five is where the affinity view stops being noise: below it one film with
     three credited writers can outrank everything. Better to say "not yet"
     than to describe somebody from four data points. */
  const ready = summary.watched >= 5;

  const topDirector = directors[0];
  const topTheme = themes[0];
  const topActor = actors[0];

  let headline = 'A watcher in progress';
  let subhead: string | null = null;
  /* When the headline is already the theme, repeating it as a stat reads as
     a bug rather than as emphasis -- "Drawn to Obsession / thread: Obsession". */
  let themeUsed = false;

  if (ready && topDirector && topDirector.n_titles >= 3) {
    const pct = share(topDirector.n_titles, topDirector.corpus_titles);
    // "Completist" has to be earned. Half a filmography of three films is not
    // the same claim as half of thirty, so both conditions are required.
    headline =
      pct >= 50 && topDirector.corpus_titles >= 4
        ? `${topDirector.label} completist`
        : `Follows ${topDirector.label}`;
    subhead = `${topDirector.n_titles} of ${topDirector.corpus_titles}`;
  } else if (ready && topTheme) {
    headline = `Drawn to ${topTheme.label}`;
    subhead = `a theme in ${topTheme.n_titles} you've watched`;
    themeUsed = true;
  } else if (ready && topActor && topActor.n_titles >= 3) {
    headline = `Turns up for ${topActor.label}`;
    subhead = `${topActor.n_titles} of ${topActor.corpus_titles}`;
  }

  const lines: PersonaLine[] = [
    { label: 'watched', value: summary.watched.toLocaleString('en-US') },
    { label: 'hours', value: summary.hours.toLocaleString('en-US') },
    { label: 'directors', value: summary.distinct_directors.toLocaleString('en-US') },
  ];
  if (summary.top_theme && !themeUsed) lines.push({ label: 'thread', value: summary.top_theme });
  else if (summary.mean_rating) lines.push({ label: 'average', value: summary.mean_rating });

  return {
    headline,
    subhead,
    lines,
    ready,
    accent: fav.accent,
    posterPath: fav.poster,
    posterTitle: fav.title,
  };
}
