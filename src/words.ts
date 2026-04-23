export const WORDS = [
  'Accomplishing',
  'Actioning',
  'Actualizing',
  'Architecting',
  'Baking',
  'Beaming',
  "Beboppin'",
  'Befuddling',
  'Billowing',
  'Blanching',
  'Bloviating',
  'Boogieing',
  'Boondoggling',
  'Booping',
  'Bootstrapping',
  'Brewing',
  'Bunning',
  'Burrowing',
  'Calculating',
  'Canoodling',
  'Caramelizing',
  'Cascading',
  'Catapulting',
  'Cerebrating',
  'Channeling',
  'Channelling',
  'Choreographing',
  'Churning',
  'Clauding',
  'Coalescing',
  'Cogitating',
  'Combobulating',
  'Composing',
  'Computing',
  'Concocting',
  'Considering',
  'Contemplating',
  'Cooking',
  'Crafting',
  'Creating',
  'Crunching',
  'Crystallizing',
  'Cultivating',
  'Deciphering',
  'Deliberating',
  'Determining',
  'Dilly-dallying',
  'Discombobulating',
  'Doing',
  'Doodling',
  'Drizzling',
  'Ebbing',
  'Effecting',
  'Elucidating',
  'Embellishing',
  'Enchanting',
  'Envisioning',
  'Evaporating',
  'Fermenting',
  'Fiddle-faddling',
  'Finagling',
  'Flambéing',
  'Flibbertigibbeting',
  'Flowing',
  'Flummoxing',
  'Fluttering',
  'Forging',
  'Forming',
  'Frolicking',
  'Frosting',
  'Gallivanting',
  'Galloping',
  'Garnishing',
  'Generating',
  'Gesticulating',
  'Germinating',
  'Gitifying',
  'Grooving',
  'Gusting',
  'Harmonizing',
  'Hashing',
  'Hatching',
  'Herding',
  'Honking',
  'Hullaballooing',
  'Hyperspacing',
  'Ideating',
  'Imagining',
  'Improvising',
  'Incubating',
  'Inferring',
  'Infusing',
  'Ionizing',
  'Jitterbugging',
  'Julienning',
  'Kneading',
  'Leavening',
  'Levitating',
  'Lollygagging',
  'Manifesting',
  'Marinating',
  'Meandering',
  'Metamorphosing',
  'Misting',
  'Moonwalking',
  'Moseying',
  'Mulling',
  'Mustering',
  'Musing',
  'Nebulizing',
  'Nesting',
  'Newspapering',
  'Noodling',
  'Nucleating',
  'Orbiting',
  'Orchestrating',
  'Osmosing',
  'Perambulating',
  'Percolating',
  'Perusing',
  'Philosophising',
  'Photosynthesizing',
  'Pollinating',
  'Pondering',
  'Pontificating',
  'Pouncing',
  'Precipitating',
  'Prestidigitating',
  'Processing',
  'Proofing',
  'Propagating',
  'Puttering',
  'Puzzling',
  'Quantumizing',
  'Razzle-dazzling',
  'Razzmatazzing',
  'Recombobulating',
  'Reticulating',
  'Roosting',
  'Ruminating',
  'Sautéing',
  'Scampering',
  'Schlepping',
  'Scurrying',
  'Seasoning',
  'Shenaniganing',
  'Shimmying',
  'Simmering',
  'Skedaddling',
  'Sketching',
  'Slithering',
  'Smooshing',
  'Sock-hopping',
  'Spelunking',
  'Spinning',
  'Sprouting',
  'Stewing',
  'Sublimating',
  'Swirling',
  'Swooping',
  'Symbioting',
  'Synthesizing',
  'Tempering',
  'Thinking',
  'Thundering',
  'Tinkering',
  'Tomfoolering',
  'Topsy-turvying',
  'Transfiguring',
  'Transmuting',
  'Twisting',
  'Undulating',
  'Unfurling',
  'Unravelling',
  'Vibing',
  'Waddling',
  'Wandering',
  'Warping',
  'Whatchamacalliting',
  'Whirlpooling',
  'Whirring',
  'Whisking',
  'Wibbling',
  'Working',
  'Wrangling',
  'Zesting',
  'Zigzagging',
] as const;

export type Rarity = 'common' | 'uncommon' | 'rare';
type TimeTier = 'warming' | 'zone' | 'deep';

const RARE_WORDS: ReadonlySet<string> = new Set<string>([
  'Flibbertigibbeting',
  'Prestidigitating',
  'Whatchamacalliting',
  'Discombobulating',
  'Fiddle-faddling',
  'Hullaballooing',
  'Razzle-dazzling',
  'Topsy-turvying',
  'Razzmatazzing',
]);

const UNCOMMON_WORDS: ReadonlySet<string> = new Set<string>([
  "Beboppin'",
  'Befuddling',
  'Bloviating',
  'Boogieing',
  'Boondoggling',
  'Booping',
  'Canoodling',
  'Caramelizing',
  'Catapulting',
  'Cerebrating',
  'Choreographing',
  'Clauding',
  'Cogitating',
  'Combobulating',
  'Dilly-dallying',
  'Doodling',
  'Finagling',
  'Flambéing',
  'Flummoxing',
  'Gallivanting',
  'Gesticulating',
  'Gitifying',
  'Hyperspacing',
  'Ionizing',
  'Jitterbugging',
  'Julienning',
  'Levitating',
  'Lollygagging',
  'Moonwalking',
  'Moseying',
  'Newspapering',
  'Noodling',
  'Osmosing',
  'Perambulating',
  'Philosophising',
  'Photosynthesizing',
  'Pontificating',
  'Quantumizing',
  'Recombobulating',
  'Sautéing',
  'Schlepping',
  'Shenaniganing',
  'Sock-hopping',
  'Spelunking',
  'Symbioting',
  'Tomfoolering',
  'Wibbling',
]);

const WARMING_WORDS: ReadonlySet<string> = new Set<string>([
  'Baking',
  'Blanching',
  'Brewing',
  'Bunning',
  'Caramelizing',
  'Drizzling',
  'Fermenting',
  'Germinating',
  'Hatching',
  'Incubating',
  'Kneading',
  'Leavening',
  'Marinating',
  'Misting',
  'Nesting',
  'Percolating',
  'Pollinating',
  'Proofing',
  'Roosting',
  'Seasoning',
  'Simmering',
  'Sprouting',
  'Stewing',
  'Tempering',
]);

const ZONE_WORDS: ReadonlySet<string> = new Set<string>([
  'Architecting',
  'Bootstrapping',
  'Calculating',
  'Cascading',
  'Composing',
  'Computing',
  'Contemplating',
  'Crafting',
  'Creating',
  'Crunching',
  'Crystallizing',
  'Cultivating',
  'Deciphering',
  'Determining',
  'Forging',
  'Forming',
  'Generating',
  'Hashing',
  'Manifesting',
  'Orchestrating',
  'Processing',
  'Reticulating',
  'Synthesizing',
  'Working',
  'Wrangling',
]);

const DEEP_WORDS: ReadonlySet<string> = new Set<string>([
  'Cerebrating',
  'Discombobulating',
  'Flibbertigibbeting',
  'Gesticulating',
  'Hyperspacing',
  'Ionizing',
  'Levitating',
  'Metamorphosing',
  'Osmosing',
  'Photosynthesizing',
  'Pontificating',
  'Prestidigitating',
  'Quantumizing',
  'Razzle-dazzling',
  'Recombobulating',
  'Sublimating',
  'Symbioting',
  'Transfiguring',
  'Transmuting',
  'Warping',
  'Whatchamacalliting',
]);

export function rarityOf(word: string): Rarity {
  if (RARE_WORDS.has(word)) return 'rare';
  if (UNCOMMON_WORDS.has(word)) return 'uncommon';
  return 'common';
}

export function classifyTimeTier(elapsedMs: number): TimeTier {
  const minutes = elapsedMs / 60_000;
  if (minutes < 30) return 'warming';
  if (minutes < 120) return 'zone';
  return 'deep';
}

function tierPoolWords(tier: TimeTier): ReadonlySet<string> {
  switch (tier) {
    case 'warming':
      return WARMING_WORDS;
    case 'zone':
      return ZONE_WORDS;
    case 'deep':
      return DEEP_WORDS;
  }
}

const RARITY_MASS: Record<Rarity, number> = {
  common: 0.7,
  uncommon: 0.25,
  rare: 0.05,
};

const TIME_BIAS = 3;

interface WeightedWord {
  readonly word: string;
  readonly weight: number;
}

interface PoolConfig {
  readonly wordRarity: boolean;
  readonly timeBasedPools: boolean;
  readonly customWords: readonly string[];
  readonly elapsedMs: number;
}

interface WordMeta {
  readonly word: string;
  readonly rarity: Rarity;
  readonly timeMult: number;
}

export function buildPool(config: PoolConfig): WeightedWord[] {
  const { wordRarity, timeBasedPools, customWords, elapsedMs } = config;
  const tier = classifyTimeTier(elapsedMs);
  const tierPool = tierPoolWords(tier);
  const builtIn = new Set<string>(WORDS);

  const metas: WordMeta[] = [];
  for (const word of WORDS) {
    metas.push({
      word,
      rarity: rarityOf(word),
      timeMult: timeBasedPools && tierPool.has(word) ? TIME_BIAS : 1,
    });
  }
  for (const word of customWords) {
    if (builtIn.has(word)) continue;
    metas.push({ word, rarity: 'common', timeMult: 1 });
  }

  if (!wordRarity) {
    return metas.map(({ word, timeMult }) => ({ word, weight: timeMult }));
  }

  // Normalize each rarity group to its target mass so that the total
  // probability per rarity matches the spec (70/25/5) regardless of
  // how time-bias shifts per-word weights.
  const groupTotals: Record<Rarity, number> = { common: 0, uncommon: 0, rare: 0 };
  for (const m of metas) groupTotals[m.rarity] += m.timeMult;

  return metas.map(({ word, rarity, timeMult }) => {
    const denom = groupTotals[rarity];
    const weight = denom > 0 ? (RARITY_MASS[rarity] * timeMult) / denom : 0;
    return { word, weight };
  });
}

const EXCLUSION_CAP = 3;

export function getNextWord(pool: readonly WeightedWord[], recent: readonly string[]): string {
  if (pool.length === 0) throw new Error('getNextWord called with empty pool');
  if (pool.length === 1) return pool[0].word;

  const maxExclude = Math.floor(pool.length / 2);
  const excludeCount = Math.min(EXCLUSION_CAP, maxExclude, recent.length);
  const excluded = excludeCount > 0 ? new Set(recent.slice(-excludeCount)) : null;

  const eligible = excluded === null ? pool : pool.filter((w) => !excluded.has(w.word));
  const picks = eligible.length > 0 ? eligible : pool;

  return weightedPick(picks);
}

function weightedPick(pool: readonly WeightedWord[]): string {
  let total = 0;
  for (const { weight } of pool) total += weight;
  if (total <= 0) {
    return pool[Math.floor(Math.random() * pool.length)].word;
  }
  let r = Math.random() * total;
  for (const { word, weight } of pool) {
    r -= weight;
    if (r < 0) return word;
  }
  return pool[pool.length - 1].word;
}
