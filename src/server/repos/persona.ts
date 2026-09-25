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

/** Percentage, rounded, guarding the zero-corpus case. */
function share(seen: number, total: number): number {
  return total > 0 ? Math.round((seen / total) * 100) : 0;
}

/**
 * A poster for the thing the headline is ABOUT.
 *
 * The first version took the highest-rated title in the library, full stop --
 * which produced a card reading "Joel Coen completist" beside a poster of
 * Severance. Both facts were true and they had nothing to do with each other,
 * so the card looked like a bug. The art, the color and the sentence have to
 * come from one subject or the card is three unrelated claims in a frame.
 *
 * So: the best-rated title YOU have watched that connects to the headline's
 * node, by the same relationship the headline is about. A Coen headline gets
 * a Coen film. An Obsession headline gets something that explores Obsession.
 */
async function artFor(
  accountId: string,
  node: { node_type: string; node_id: string; canonical_predicate?: string } | null,
): Promise<{ accent: string | null; poster: string | null; title: string | null }> {
  const found = await withUser(accountId, async (tx) =>
    rows<{ accent_color: string | null; poster_path: string | null; title: string }>(
      tx,
      node
        ? sql`
            SELECT t.accent_color, t.poster_path, t.title
            FROM sem.user_title ut
            JOIN sem.title t ON t.id = ut.title_id
            JOIN sem.edge_bidirectional e
              ON e.subject_type = 'title' AND e.subject_id = ut.title_id
             AND e.object_type = ${node.node_type} AND e.object_id = ${node.node_id}::uuid
            WHERE ut.account_id = ${accountId}
              AND ut.status = 'watched'
              AND t.poster_path IS NOT NULL
            ORDER BY ut.rating DESC NULLS LAST, ut.last_watched_on DESC NULLS LAST
            LIMIT 1`
        : /* No headline node -- a library too thin for one. Fall back to the
             best-rated thing overall, which at least is still THEIRS. */
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

export async function persona(accountId: string): Promise<Persona> {
  const [summary, directors, themes, actors] = await Promise.all([
    tasteSummary(accountId),
    tasteByPredicate(accountId, 'directed_by', 3),
    tasteByPredicate(accountId, 'explores_theme', 3),
    tasteByPredicate(accountId, 'features_actor', 3),
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

  /* Whatever the headline ends up being about. The art is fetched for THIS,
     after the branch below decides, so the two cannot disagree. */
  let lead: { node_type: string; node_id: string } | null = null;

  if (ready && topDirector && topDirector.n_titles >= 3) {
    const pct = share(topDirector.n_titles, topDirector.corpus_titles);
    // "Completist" has to be earned. Half a filmography of three films is not
    // the same claim as half of thirty, so both conditions are required.
    headline =
      pct >= 50 && topDirector.corpus_titles >= 4
        ? `${topDirector.label} completist`
        : `Follows ${topDirector.label}`;
    subhead = `${topDirector.n_titles} of ${topDirector.corpus_titles}`;
    lead = topDirector;
  } else if (ready && topTheme) {
    headline = `Drawn to ${topTheme.label}`;
    subhead = `a theme in ${topTheme.n_titles} you've watched`;
    lead = topTheme;
  } else if (ready && topActor && topActor.n_titles >= 3) {
    headline = `Turns up for ${topActor.label}`;
    subhead = `${topActor.n_titles} of ${topActor.corpus_titles}`;
    lead = topActor;
  }

  const fav = await artFor(accountId, lead);

  /**
   * Numbers only, and short ones.
   *
   * This row used to carry a `thread` whose value was a theme name, and
   * "Monsters & the Monstrous" is twenty-four characters in a row laid out
   * for "4.25". It ran off the card. The fix is not a smaller font or an
   * ellipsis: a theme is a different kind of fact from a count, and putting
   * it in a rank of counts was the mistake. When a theme is worth saying it
   * is already the headline; when it is not, it does not belong on the card.
   */
  const lines: PersonaLine[] = [
    { label: 'watched', value: summary.watched.toLocaleString('en-US') },
    { label: 'hours', value: summary.hours.toLocaleString('en-US') },
    { label: 'directors', value: summary.distinct_directors.toLocaleString('en-US') },
  ];
  if (summary.mean_rating) lines.push({ label: 'average', value: summary.mean_rating });

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
