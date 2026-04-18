import { describe, it, expect } from 'vitest';
import {
  buildPresencePayload,
  buildStateLine,
  getLanguageIconKey,
  getLanguageDisplayName,
} from '../src/presence';
import type { Config } from '../src/config';
import type { State } from '../src/state';
import { createState } from '../src/state';

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

  it('normalizes overrides (typescriptreact → typescript)', () => {
    expect(getLanguageIconKey('typescriptreact')).toBe('lang-typescript');
    expect(getLanguageIconKey('javascriptreact')).toBe('lang-javascript');
    expect(getLanguageIconKey('shellscript')).toBe('lang-shell');
    expect(getLanguageIconKey('scss')).toBe('lang-css');
  });

  it('falls back to claude-logo for unknown languages', () => {
    expect(getLanguageIconKey('ocaml')).toBe('claude-logo');
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

  it('capitalizes unknown ids', () => {
    expect(getLanguageDisplayName('zig')).toBe('Zig');
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

  it('returns "In the terminal" regardless of language', () => {
    const state = baseState({ focusContext: 'terminal', currentLanguage: undefined });
    expect(buildStateLine(state, baseConfig())).toBe('In the terminal');
  });

  it('appends workspace when showWorkspace=true', () => {
    const line = buildStateLine(baseState(), baseConfig({ showWorkspace: true }));
    expect(line).toBe('Working in TypeScript — my-project');
  });

  it('does not append workspace to terminal state when name missing', () => {
    const state = baseState({ focusContext: 'terminal', workspaceName: undefined });
    const line = buildStateLine(state, baseConfig({ showWorkspace: true }));
    expect(line).toBe('In the terminal');
  });

  it('falls through to plain state when debug+no language', () => {
    const state = baseState({ debugActive: true, currentLanguage: undefined });
    expect(buildStateLine(state, baseConfig())).toBeUndefined();
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

  it('falls back small image to claude-logo with "Powered by Claude Code" for unknown language', () => {
    const state = baseState({ currentLanguage: 'ocaml' });
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
