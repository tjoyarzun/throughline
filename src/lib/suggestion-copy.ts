import type { SuggestionReason } from '@/server/repos/suggestions';

/**
 * A reason, in English.
 *
 * The reason IS the product here: a recommendation you cannot interrogate is
 * indistinguishable from a guess, and the claim this whole app makes is that
 * the connections are declared rather than inferred. So each one names the
 * thing and says how much of it you have already watched -- "Denis Villeneuve
 * · directed 4 you've seen" -- which is checkable, unlike a score.
 *
 * Phrased from the TITLE's point of view, because that is what the reader is
 * looking at. The predicate stored on the edge points the other way (a person
 * `directed` a title), so the sentence reads as the inverse without saying
 * the word "directed by", which does not fit under a poster.
 */
const PHRASE: Record<string, (n: number) => string> = {
  directed: (n) => `directed ${n} you've seen`,
  wrote: (n) => `wrote ${n} you've seen`,
  acted_in: (n) => `in ${n} you've seen`,
  composed_for: (n) => `scored ${n} you've seen`,
  shot: (n) => `shot ${n} you've seen`,
  explores_theme: (n) => `a theme in ${n} you've seen`,
  part_of_franchise: (n) => `${n} of these you've seen`,
  based_on: (n) => `source of ${n} you've seen`,
  features_character: (n) => `appears in ${n} you've seen`,
  portrayed_by: (n) => `plays ${n} you've seen`,
  sequel_to: (n) => `leads to ${n} you've seen`,
};

export function reasonPhrase(r: SuggestionReason): string {
  const f = PHRASE[r.predicate];
  // An unmapped predicate says something true and unremarkable rather than
  // printing a raw identifier at a reader.
  return f ? f(r.n) : `connected to ${r.n} you've seen`;
}
