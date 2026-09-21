import { describe, it, expect } from 'vitest';
import {
  normalizeTitle,
  normalizePersonName,
  personSortName,
  slugify,
  trigramSimilarity,
} from '@/server/ingest/normalize';

describe('normalizeTitle', () => {
  it.each([
    ['The Matrix (1999)', 'matrix'],
    ['L’Étranger', 'letranger'],
    ["L'Étranger", 'letranger'],
    ['WALL·E', 'walle'],
    ['Amélie', 'amelie'],
    ['A Clockwork Orange', 'clockworkorange'],
    ['An American Werewolf in London', 'americanwerewolfinlondon'],
    ['Das Boot', 'boot'],
    ['Blade Runner 2049', 'bladerunner2049'],
    ['Spider-Man: Into the Spider-Verse', 'spidermanintothespiderverse'],
    ['  Arrival  ', 'arrival'],
    ['', ''],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeTitle(input)).toBe(expected);
  });

  it('collapses titles that differ only in punctuation or case', () => {
    expect(normalizeTitle('Dr. Strangelove')).toBe(normalizeTitle('DR STRANGELOVE'));
    expect(normalizeTitle('Se7en')).toBe(normalizeTitle('se7en'));
  });

  it('does NOT collapse genuinely different titles', () => {
    // The whole point of a blocking key is that it still discriminates.
    expect(normalizeTitle('The Office')).not.toBe(normalizeTitle('The Officer'));
    expect(normalizeTitle('Dune')).not.toBe(normalizeTitle('Dunes'));
  });
});

describe('normalizePersonName', () => {
  it('keeps word boundaries, unlike titles', () => {
    expect(normalizePersonName('Denis Villeneuve')).toBe('denis villeneuve');
    expect(normalizePersonName('Jóhann Jóhannsson')).toBe('johann johannsson');
    expect(normalizePersonName("Conan O'Brien")).toBe('conan o brien');
  });
});

describe('personSortName', () => {
  it('puts the surname first', () => {
    expect(personSortName('Denis Villeneuve')).toBe('villeneuve denis');
    expect(personSortName('Cher')).toBe('cher');
  });
});

describe('slugify', () => {
  it('produces url-safe slugs with an optional disambiguator', () => {
    expect(slugify('Blade Runner 2049')).toBe('blade-runner-2049');
    expect(slugify('Arrival', 2016)).toBe('arrival-2016');
    expect(slugify('WALL·E')).toBe('wall-e');
    expect(slugify('???')).toBe('untitled');
  });
});

describe('trigramSimilarity', () => {
  it('scores identical strings at 1 and unrelated ones low', () => {
    expect(trigramSimilarity('bladerunner', 'bladerunner')).toBe(1);
    expect(trigramSimilarity('arrival', 'dune')).toBeLessThan(0.2);
  });

  it('scores near-misses high enough to reach the review band', () => {
    expect(trigramSimilarity('theoffice', 'theoffice')).toBe(1);
    expect(trigramSimilarity('spiderman', 'spidermen')).toBeGreaterThan(0.5);
  });
});
