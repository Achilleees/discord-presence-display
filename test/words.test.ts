import { describe, it, expect } from 'vitest';
import {
  WORDS,
  rarityOf,
  classifyTimeTier,
  buildPool,
  getNextWord,
} from '../src/words';

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

describe('rarityOf', () => {
  it('classifies rare words', () => {
    expect(rarityOf('Flibbertigibbeting')).toBe('rare');
    expect(rarityOf('Razzle-dazzling')).toBe('rare');
    expect(rarityOf('Whatchamacalliting')).toBe('rare');
  });

  it('classifies uncommon words', () => {
    expect(rarityOf('Moonwalking')).toBe('uncommon');
    expect(rarityOf('Spelunking')).toBe('uncommon');
    expect(rarityOf("Beboppin'")).toBe('uncommon');
  });

  it('classifies common words (default tier)', () => {
    expect(rarityOf('Thinking')).toBe('common');
    expect(rarityOf('Working')).toBe('common');
    expect(rarityOf('Cooking')).toBe('common');
  });

  it('classifies unknown / custom words as common', () => {
    expect(rarityOf('TotallyMadeUp')).toBe('common');
  });
});

describe('classifyTimeTier', () => {
  it('returns warming under 30 min', () => {
    expect(classifyTimeTier(0)).toBe('warming');
    expect(classifyTimeTier(29 * 60_000)).toBe('warming');
  });
  it('returns zone between 30 and 120 min', () => {
    expect(classifyTimeTier(30 * 60_000)).toBe('zone');
    expect(classifyTimeTier(119 * 60_000)).toBe('zone');
  });
  it('returns deep at 120+ min', () => {
    expect(classifyTimeTier(120 * 60_000)).toBe('deep');
    expect(classifyTimeTier(500 * 60_000)).toBe('deep');
  });
});

describe('buildPool', () => {
  const base = {
    wordRarity: false,
    timeBasedPools: false,
    customWords: [] as readonly string[],
    elapsedMs: 0,
  };

  it('includes every built-in word with uniform weight when flags off', () => {
    const pool = buildPool(base);
    expect(pool).toHaveLength(WORDS.length);
    for (const entry of pool) {
      expect(entry.weight).toBe(1);
    }
  });

  it('appends custom words not already in built-in list', () => {
    const pool = buildPool({ ...base, customWords: ['Zooming', 'Working', 'Frobnicating'] });
    const words = pool.map((w) => w.word);
    expect(words).toContain('Zooming');
    expect(words).toContain('Frobnicating');
    expect(words.filter((w) => w === 'Working')).toHaveLength(1);
  });

  it('rarity-only: mass per group sums to 70/25/5', () => {
    const pool = buildPool({ ...base, wordRarity: true });
    const sumOf = (r: 'common' | 'uncommon' | 'rare') =>
      pool.filter((p) => rarityOf(p.word) === r).reduce((s, p) => s + p.weight, 0);
    expect(sumOf('common')).toBeCloseTo(0.7, 5);
    expect(sumOf('uncommon')).toBeCloseTo(0.25, 5);
    expect(sumOf('rare')).toBeCloseTo(0.05, 5);
  });

  it('biases in-tier words 3× when timeBasedPools=true (rarity off)', () => {
    const zonePool = buildPool({ ...base, timeBasedPools: true, elapsedMs: 60 * 60_000 });
    const zoneWord = zonePool.find((p) => p.word === 'Computing')!;
    const outWord = zonePool.find((p) => p.word === 'Baking')!;
    expect(zoneWord.weight).toBe(3);
    expect(outWord.weight).toBe(1);
  });

  it('treats custom words as always-eligible with no time bias (rarity off)', () => {
    const pool = buildPool({
      ...base,
      timeBasedPools: true,
      elapsedMs: 60 * 60_000,
      customWords: ['CustomVerb'],
    });
    const entry = pool.find((p) => p.word === 'CustomVerb')!;
    expect(entry.weight).toBe(1);
  });

  it('composes rarity × time so rare stays ~5% in deep tier (audit 3.5)', () => {
    const pool = buildPool({
      wordRarity: true,
      timeBasedPools: true,
      customWords: [],
      elapsedMs: 180 * 60_000,
    });
    const sumOf = (r: 'common' | 'uncommon' | 'rare') =>
      pool.filter((p) => rarityOf(p.word) === r).reduce((s, p) => s + p.weight, 0);
    expect(sumOf('common')).toBeCloseTo(0.7, 5);
    expect(sumOf('uncommon')).toBeCloseTo(0.25, 5);
    expect(sumOf('rare')).toBeCloseTo(0.05, 5);
  });

  it('gives in-tier words higher weight than out-tier within same rarity, under both flags', () => {
    const pool = buildPool({
      wordRarity: true,
      timeBasedPools: true,
      customWords: [],
      elapsedMs: 180 * 60_000,
    });
    const inTierRare = pool.find((p) => p.word === 'Flibbertigibbeting')!; // in deep
    const outTierRare = pool.find((p) => p.word === 'Topsy-turvying')!;    // not in deep
    expect(inTierRare.weight).toBeGreaterThan(outTierRare.weight);
  });
});

describe('getNextWord', () => {
  it('never returns a word present in recent across 10_000 picks', () => {
    const pool = buildPool({
      wordRarity: false,
      timeBasedPools: false,
      customWords: [],
      elapsedMs: 0,
    });
    const recent: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      const word = getNextWord(pool, recent);
      expect(recent.slice(-3).includes(word)).toBe(false);
      recent.push(word);
      if (recent.length > 3) recent.shift();
    }
  });

  it('short-circuits on single-word pool', () => {
    const pool = [{ word: 'Only', weight: 1 }];
    expect(getNextWord(pool, ['Only'])).toBe('Only');
  });

  it('handles tiny pool without looping (exclusion capped by pool size)', () => {
    const pool = [
      { word: 'A', weight: 1 },
      { word: 'B', weight: 1 },
    ];
    // pool.length=2 → maxExclude=1. recent.slice(-1)=['A']. A excluded, only B eligible.
    expect(getNextWord(pool, ['A', 'B', 'A'])).toBe('B');
  });

  it('throws on empty pool', () => {
    expect(() => getNextWord([], [])).toThrow();
  });

  it('respects weights across many picks', () => {
    const pool = [
      { word: 'Common', weight: 10 },
      { word: 'Rare', weight: 1 },
    ];
    let commonCount = 0;
    let rareCount = 0;
    for (let i = 0; i < 5000; i++) {
      const w = getNextWord(pool, []);
      if (w === 'Common') commonCount++;
      else rareCount++;
    }
    expect(commonCount).toBeGreaterThan(rareCount * 5);
  });
});
