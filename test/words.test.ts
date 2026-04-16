import { describe, it, expect } from 'vitest';
import { WORDS, getRandomWord } from '../src/words';

describe('WORDS', () => {
  it('contains exactly 187 words', () => {
    expect(WORDS).toHaveLength(187);
  });

  it('has no duplicates', () => {
    expect(new Set(WORDS).size).toBe(WORDS.length);
  });

  it('contains only non-empty strings', () => {
    for (const word of WORDS) {
      expect(word.length).toBeGreaterThan(0);
    }
  });
});

describe('getRandomWord', () => {
  it('returns a word from the list', () => {
    const word = getRandomWord();
    expect(WORDS as readonly string[]).toContain(word);
  });
});
