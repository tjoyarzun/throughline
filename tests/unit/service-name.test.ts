import { describe, it, expect } from 'vitest';
import { serviceName } from '@/server/repos/titles';

/**
 * TMDB lists every tier and every resale channel as a separate provider, so
 * "where can I watch Arrival" comes back with Paramount four times. Collapsing
 * them is the difference between an answer and a list.
 *
 * The cases below are real strings from the live API, not invented ones.
 */
describe('provider name collapsing', () => {
  it.each([
    ['Paramount Plus Essential', 'Paramount+'],
    ['Paramount Plus Premium', 'Paramount+'],
    ['Paramount+ Amazon Channel', 'Paramount+'],
    ['Paramount+ Roku Premium Channel', 'Paramount+'],
    ['Amazon Prime Video with Ads', 'Amazon Prime Video'],
    ['Max Basic with Ads', 'Max'],
    ['Disney Plus', 'Disney+'],
  ])('collapses %s to %s', (raw, want) => {
    expect(serviceName(raw)).toBe(want);
  });

  it.each([
    // Distinct services that merely look similar. Over-collapsing loses a real
    // answer: the Apple TV Store sells a film that Apple TV+ does not stream.
    ['Apple TV Store', 'Apple TV Store'],
    ['Apple TV+', 'Apple TV+'],
    ['Netflix', 'Netflix'],
    ['Kanopy', 'Kanopy'],
    ['Hoopla', 'Hoopla'],
    ['FlixFling', 'FlixFling'],
  ])('leaves %s alone', (raw, want) => {
    expect(serviceName(raw)).toBe(want);
  });
});
