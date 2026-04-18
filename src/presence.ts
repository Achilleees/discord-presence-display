import type { SetActivity } from '@xhayper/discord-rpc';
import type { Config } from './config';
import type { State } from './state';

const LARGE_IMAGE_KEY = 'vscode-spinner';
const LARGE_IMAGE_TEXT = 'Visual Studio Code';
const FALLBACK_SMALL_IMAGE = 'claude-logo';
const FALLBACK_SMALL_TEXT = 'Powered by Claude Code';

const LANG_SUPPORTED: ReadonlySet<string> = new Set<string>([
  'typescript',
  'javascript',
  'python',
  'rust',
  'go',
  'java',
  'cpp',
  'csharp',
  'html',
  'css',
  'ruby',
  'php',
  'swift',
  'kotlin',
  'dart',
  'lua',
  'elixir',
  'haskell',
  'scala',
  'shell',
  'sql',
  'json',
  'yaml',
  'markdown',
  'c',
]);

const LANG_ID_OVERRIDES: Readonly<Record<string, string>> = {
  typescriptreact: 'typescript',
  javascriptreact: 'javascript',
  shellscript: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  jsonc: 'json',
  scss: 'css',
  less: 'css',
};

const LANG_DISPLAY: Readonly<Record<string, string>> = {
  typescript: 'TypeScript',
  typescriptreact: 'TypeScript',
  javascript: 'JavaScript',
  javascriptreact: 'JavaScript',
  python: 'Python',
  rust: 'Rust',
  go: 'Go',
  java: 'Java',
  cpp: 'C++',
  c: 'C',
  csharp: 'C#',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  less: 'Less',
  ruby: 'Ruby',
  php: 'PHP',
  swift: 'Swift',
  kotlin: 'Kotlin',
  dart: 'Dart',
  lua: 'Lua',
  elixir: 'Elixir',
  haskell: 'Haskell',
  scala: 'Scala',
  shell: 'Shell',
  shellscript: 'Shell',
  bash: 'Bash',
  zsh: 'Zsh',
  fish: 'Fish',
  powershell: 'PowerShell',
  sql: 'SQL',
  json: 'JSON',
  jsonc: 'JSON',
  yaml: 'YAML',
  markdown: 'Markdown',
  'objective-c': 'Objective-C',
  'objective-cpp': 'Objective-C++',
  hlsl: 'HLSL',
};

function normalizeLang(languageId: string): string {
  const lower = languageId.toLowerCase();
  return LANG_ID_OVERRIDES[lower] ?? lower;
}

export function getLanguageIconKey(languageId: string | undefined): string {
  if (!languageId) return FALLBACK_SMALL_IMAGE;
  const normalized = normalizeLang(languageId);
  return LANG_SUPPORTED.has(normalized) ? `lang-${normalized}` : FALLBACK_SMALL_IMAGE;
}

export function getLanguageDisplayName(languageId: string): string {
  const direct = LANG_DISPLAY[languageId];
  if (direct) return direct;
  const normalized = normalizeLang(languageId);
  const viaNormal = LANG_DISPLAY[normalized];
  if (viaNormal) return viaNormal;
  return languageId.charAt(0).toUpperCase() + languageId.slice(1);
}

export function buildStateLine(state: State, config: Config): string | undefined {
  if (!config.showLanguage) return undefined;

  const language = state.currentLanguage;
  const displayName = language ? getLanguageDisplayName(language) : undefined;

  let base: string | undefined;

  if (config.smartState) {
    if (state.debugActive && displayName) {
      base = `Debugging in ${displayName}`;
    } else if (state.focusContext === 'diff' && displayName) {
      base = `Reviewing in ${displayName}`;
    } else if (state.focusContext === 'terminal') {
      base = 'In the terminal';
    }
  }

  if (base === undefined) {
    if (!displayName) return undefined;
    base = `Working in ${displayName}`;
  }

  if (config.showWorkspace && state.workspaceName) {
    base += ` — ${state.workspaceName}`;
  }

  return base;
}

export function buildPresencePayload(
  state: State,
  config: Config,
  word: string,
): SetActivity | null {
  if (state.paused) return null;
  if (!config.enabled) return null;

  const activity: SetActivity = {
    type: 0,
    statusDisplayType: 2,
    details: `${word}...`,
    largeImageKey: LARGE_IMAGE_KEY,
    largeImageText: LARGE_IMAGE_TEXT,
  };

  const stateLine = buildStateLine(state, config);
  if (stateLine !== undefined) {
    activity.state = stateLine;
  }

  if (config.showElapsedTime) {
    activity.startTimestamp = state.startTimestamp;
  }

  if (config.showLanguageIcon) {
    const iconKey = getLanguageIconKey(state.currentLanguage);
    activity.smallImageKey = iconKey;
    activity.smallImageText =
      iconKey !== FALLBACK_SMALL_IMAGE && state.currentLanguage
        ? getLanguageDisplayName(state.currentLanguage)
        : FALLBACK_SMALL_TEXT;
  }

  return activity;
}
