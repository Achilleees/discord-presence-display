import { describe, it, expect } from 'vitest';
import {
  buildPresencePayload,
  buildStateLine,
  getLanguageIconKey,
  getLanguageDisplayName,
  pickCandidateWord,
} from '../src/presence';
import type { Config } from '../src/config';
import type { State } from '../src/state';
import { createState } from '../src/state';
import { WORDS } from '../src/words';

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    enabled: true,
    cycleSpeed: 15,
    cycleWords: true,
    customWords: [],
    showLanguage: true,
    showWorkspace: false,
    showElapsedTime: true,
    showLanguageIcon: true,
    smartState: true,
    idleBehavior: 'slow',
    idleThresholdMinutes: 5,
    wordRarity: false,
    timeBasedPools: false,
    ...overrides,
  };
}

function baseState(overrides: Partial<State> = {}): State {
  const s = createState(new Date('2026-04-18T12:00:00Z'), 'typescript', 'my-project');
  Object.assign(s, overrides);
  return s;
}

describe('getLanguageIconKey', () => {
  it('maps supported languages to lang-* keys', () => {
    expect(getLanguageIconKey('typescript')).toBe('lang-typescript');
    expect(getLanguageIconKey('python')).toBe('lang-python');
    expect(getLanguageIconKey('rust')).toBe('lang-rust');
  });

  it('normalizes overrides (typescriptreact → react)', () => {
    expect(getLanguageIconKey('typescriptreact')).toBe('lang-react');
    expect(getLanguageIconKey('javascriptreact')).toBe('lang-react');
    expect(getLanguageIconKey('shellscript')).toBe('lang-shell');
    expect(getLanguageIconKey('scss')).toBe('lang-css');
    expect(getLanguageIconKey('dockerfile')).toBe('lang-docker');
    expect(getLanguageIconKey('objective-c')).toBe('lang-objectivec');
  });

  it('falls back to claude-logo for unknown languages', () => {
    expect(getLanguageIconKey('cobol')).toBe('claude-logo');
    expect(getLanguageIconKey('somelang')).toBe('claude-logo');
  });

  it('falls back to claude-logo when undefined', () => {
    expect(getLanguageIconKey(undefined)).toBe('claude-logo');
  });
});

describe('getLanguageDisplayName', () => {
  it('returns pretty names for known ids', () => {
    expect(getLanguageDisplayName('typescript')).toBe('TypeScript');
    expect(getLanguageDisplayName('csharp')).toBe('C#');
    expect(getLanguageDisplayName('cpp')).toBe('C++');
  });

  it('renders React for typescriptreact / javascriptreact', () => {
    expect(getLanguageDisplayName('typescriptreact')).toBe('React');
    expect(getLanguageDisplayName('javascriptreact')).toBe('React');
  });

  it('renders Docker for dockerfile and Objective-C for objective-c', () => {
    expect(getLanguageDisplayName('dockerfile')).toBe('Docker');
    expect(getLanguageDisplayName('objective-c')).toBe('Objective-C');
    expect(getLanguageDisplayName('objective-cpp')).toBe('Objective-C++');
  });

  it('renders pretty names for expanded langs (OCaml, F#, MATLAB, LaTeX)', () => {
    expect(getLanguageDisplayName('ocaml')).toBe('OCaml');
    expect(getLanguageDisplayName('fsharp')).toBe('F#');
    expect(getLanguageDisplayName('matlab')).toBe('MATLAB');
    expect(getLanguageDisplayName('latex')).toBe('LaTeX');
  });

  it('capitalizes truly unknown ids', () => {
    expect(getLanguageDisplayName('cobol')).toBe('Cobol');
  });
});

describe('buildStateLine', () => {
  it('returns "Working in X" by default', () => {
    expect(buildStateLine(baseState(), baseConfig())).toBe('Working in TypeScript');
  });

  it('returns undefined when showLanguage=false', () => {
    expect(buildStateLine(baseState(), baseConfig({ showLanguage: false }))).toBeUndefined();
  });

  it('returns undefined when language is unknown and smartState has no trigger', () => {
    const state = baseState({ currentLanguage: undefined });
    expect(buildStateLine(state, baseConfig())).toBeUndefined();
  });

  it('returns "Debugging in X" when smart+debugActive', () => {
    const state = baseState({ debugActive: true });
    expect(buildStateLine(state, baseConfig())).toBe('Debugging in TypeScript');
  });

  it('returns "Reviewing in X" when smart+diff focus', () => {
    const state = baseState({ focusContext: 'diff' });
    expect(buildStateLine(state, baseConfig())).toBe('Reviewing in TypeScript');
  });

  it('returns "In the terminal" whether or not a language is set', () => {
    const noLang = baseState({ focusContext: 'terminal', currentLanguage: undefined });
    expect(buildStateLine(noLang, baseConfig())).toBe('In the terminal');
    const withLang = baseState({ focusContext: 'terminal', currentLanguage: 'typescript' });
    expect(buildStateLine(withLang, baseConfig())).toBe('In the terminal');
  });

  it('appends workspace to rule 6 (Working in X)', () => {
    const line = buildStateLine(baseState(), baseConfig({ showWorkspace: true }));
    expect(line).toBe('Working in TypeScript — my-project');
  });

  it('appends workspace to rule 2 (Debugging in X)', () => {
    const state = baseState({ debugActive: true });
    const line = buildStateLine(state, baseConfig({ showWorkspace: true }));
    expect(line).toBe('Debugging in TypeScript — my-project');
  });

  it('appends workspace to rule 3 (Reviewing in X)', () => {
    const state = baseState({ focusContext: 'diff' });
    const line = buildStateLine(state, baseConfig({ showWorkspace: true }));
    expect(line).toBe('Reviewing in TypeScript — my-project');
  });

  it('appends workspace to rule 4 (In the terminal)', () => {
    const state = baseState({ focusContext: 'terminal' });
    const line = buildStateLine(state, baseConfig({ showWorkspace: true }));
    expect(line).toBe('In the terminal — my-project');
  });

  it('does not append workspace to terminal state when name missing', () => {
    const state = baseState({ focusContext: 'terminal', workspaceName: undefined });
    const line = buildStateLine(state, baseConfig({ showWorkspace: true }));
    expect(line).toBe('In the terminal');
  });

  it('omits state line on rule 5 (undefined language) even when showWorkspace=true', () => {
    // Plan §State line priority rule 7: "Step 5 has nothing to append to."
    const state = baseState({ currentLanguage: undefined });
    expect(buildStateLine(state, baseConfig({ showWorkspace: true }))).toBeUndefined();
  });

  it('shows "Debugging" (no language) when debug is active but language is unknown', () => {
    const state = baseState({ debugActive: true, currentLanguage: undefined });
    expect(buildStateLine(state, baseConfig())).toBe('Debugging');
  });

  it('shows "Reviewing" (no language) when in diff but language is unknown', () => {
    const state = baseState({ focusContext: 'diff', currentLanguage: undefined });
    expect(buildStateLine(state, baseConfig())).toBe('Reviewing');
  });

  it('rule 2 (debug) beats rule 4 (terminal) even when language is unknown', () => {
    const state = baseState({
      debugActive: true,
      focusContext: 'terminal',
      currentLanguage: undefined,
    });
    expect(buildStateLine(state, baseConfig())).toBe('Debugging');
  });

  it('rule 3 (diff) beats rule 4 (terminal) even when language is unknown', () => {
    const state = baseState({
      focusContext: 'diff',
      currentLanguage: undefined,
    });
    expect(buildStateLine(state, baseConfig())).toBe('Reviewing');
  });

  it('ignores smart triggers when smartState=false', () => {
    const state = baseState({ debugActive: true });
    expect(buildStateLine(state, baseConfig({ smartState: false }))).toBe('Working in TypeScript');
  });
});

describe('buildPresencePayload', () => {
  it('returns null when paused', () => {
    expect(buildPresencePayload(baseState({ paused: true }), baseConfig(), 'Thinking')).toBeNull();
  });

  it('returns null when enabled=false', () => {
    expect(buildPresencePayload(baseState(), baseConfig({ enabled: false }), 'Thinking')).toBeNull();
  });

  it('sets cycling word with ellipsis as details', () => {
    const p = buildPresencePayload(baseState(), baseConfig(), 'Cogitating');
    expect(p?.details).toBe('Cogitating...');
  });

  it('omits elapsed time when showElapsedTime=false', () => {
    const p = buildPresencePayload(baseState(), baseConfig({ showElapsedTime: false }), 'Thinking');
    expect(p?.startTimestamp).toBeUndefined();
  });

  it('includes elapsed time by default, from startTimestamp', () => {
    const state = baseState();
    const p = buildPresencePayload(state, baseConfig(), 'Thinking');
    expect(p?.startTimestamp).toBe(state.startTimestamp);
  });

  it('sets large image to vscode-spinner with "Visual Studio Code" tooltip', () => {
    const p = buildPresencePayload(baseState(), baseConfig(), 'Working');
    expect(p?.largeImageKey).toBe('vscode-spinner');
    expect(p?.largeImageText).toBe('Visual Studio Code');
  });

  it('sets small image to lang-* key for known language with language tooltip', () => {
    const p = buildPresencePayload(baseState(), baseConfig(), 'Working');
    expect(p?.smallImageKey).toBe('lang-typescript');
    expect(p?.smallImageText).toBe('TypeScript');
  });

  it('falls back small image to claude-logo but still names the language in the tooltip', () => {
    const state = baseState({ currentLanguage: 'cobol' });
    const p = buildPresencePayload(state, baseConfig(), 'Working');
    expect(p?.smallImageKey).toBe('claude-logo');
    // Tooltip should match the state line — both say the language is Cobol-ish.
    expect(p?.smallImageText).toBe('Cobol');
  });

  it('uses "Powered by Claude Code" tooltip only when there is no language', () => {
    const state = baseState({ currentLanguage: undefined });
    const p = buildPresencePayload(state, baseConfig(), 'Working');
    expect(p?.smallImageKey).toBe('claude-logo');
    expect(p?.smallImageText).toBe('Powered by Claude Code');
  });

  it('omits small image entirely when showLanguageIcon=false', () => {
    const p = buildPresencePayload(baseState(), baseConfig({ showLanguageIcon: false }), 'Working');
    expect(p?.smallImageKey).toBeUndefined();
    expect(p?.smallImageText).toBeUndefined();
  });

  it('omits state line when showLanguage=false', () => {
    const p = buildPresencePayload(baseState(), baseConfig({ showLanguage: false }), 'Working');
    expect(p?.state).toBeUndefined();
  });

  it('sets status display type to 2 and type to 0', () => {
    const p = buildPresencePayload(baseState(), baseConfig(), 'Working');
    expect(p?.type).toBe(0);
    expect(p?.statusDisplayType).toBe(2);
  });
});

describe('pickCandidateWord', () => {
  const now = new Date('2026-04-18T12:05:00Z').getTime();

  it('returns the pinned word when cycleWords=false and pinnedWord is set', () => {
    const state = baseState({ pinnedWord: 'PinnedForever' });
    const word = pickCandidateWord(state, baseConfig({ cycleWords: false }), now);
    expect(word).toBe('PinnedForever');
  });

  it('ignores pinnedWord when cycleWords=true', () => {
    const state = baseState({ pinnedWord: 'Stale' });
    const word = pickCandidateWord(state, baseConfig({ cycleWords: true }), now);
    expect(WORDS as readonly string[]).toContain(word);
  });

  it('picks a fresh word from WORDS when cycleWords=false and pinnedWord is undefined', () => {
    const state = baseState({ pinnedWord: undefined });
    const word = pickCandidateWord(state, baseConfig({ cycleWords: false }), now);
    expect(WORDS as readonly string[]).toContain(word);
  });

  it('picks from WORDS ∪ customWords when cycleWords=false and customWords supplied', () => {
    const state = baseState({ pinnedWord: undefined });
    const config = baseConfig({ cycleWords: false, customWords: ['Nebulating'] });
    // Force low randomness so we sometimes get the custom word; assert
    // membership in either set over many iterations.
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      seen.add(pickCandidateWord(state, config, now));
    }
    for (const w of seen) {
      expect((WORDS as readonly string[]).includes(w) || w === 'Nebulating').toBe(true);
    }
  });

  it('avoids words in the recent ring', () => {
    const state = baseState();
    state.recentWords.add('Thinking');
    state.recentWords.add('Working');
    state.recentWords.add('Crafting');
    for (let i = 0; i < 200; i++) {
      const word = pickCandidateWord(state, baseConfig(), now)!;
      expect(['Thinking', 'Working', 'Crafting']).not.toContain(word);
    }
  });
});
