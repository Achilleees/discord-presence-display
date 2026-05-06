import type { SetActivity } from '@xhayper/discord-rpc';
import type { Config } from './config';
import type { State } from './state';
import { buildPool, getNextWord } from './words';

export function pickCandidateWord(state: State, config: Config, elapsedMs: number): string {
  if (!config.cycleWords && state.pinnedWord) return state.pinnedWord;

  // elapsedMs is supplied by the caller (must be monotonic-derived to
  // avoid wall-clock jumps reclassifying time tiers mid-session — see
  // state.startMonotonicMs and src/extension.ts).
  const pool = buildPool({
    wordRarity: config.wordRarity,
    timeBasedPools: config.timeBasedPools,
    customWords: config.customWords,
    elapsedMs,
  });
  return getNextWord(pool, state.recentWords.values());
}

const LARGE_IMAGE_KEY = 'vscode-spinner';
const LARGE_IMAGE_TEXT = 'Visual Studio Code';
const FALLBACK_SMALL_IMAGE = 'claude-logo';
const FALLBACK_SMALL_TEXT = 'Powered by Claude Code';

const LANG_SUPPORTED: ReadonlySet<string> = new Set<string>([
  'typescript',
  'javascript',
  'react',
  'vue',
  'svelte',
  'astro',
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
  'r',
  'matlab',
  'julia',
  'ocaml',
  'fsharp',
  'clojure',
  'erlang',
  'perl',
  'groovy',
  'powershell',
  'objectivec',
  'graphql',
  'docker',
  'latex',
]);

const LANG_ID_OVERRIDES: Readonly<Record<string, string>> = {
  typescriptreact: 'react',
  javascriptreact: 'react',
  shellscript: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  jsonc: 'json',
  scss: 'css',
  less: 'css',
  dockerfile: 'docker',
  'objective-c': 'objectivec',
  'objective-cpp': 'objectivec',
};

// Superset of LANG_SUPPORTED. Includes display names for dialect languageIds
// that route to a parent icon via LANG_ID_OVERRIDES (bash → shell, jsonc →
// json, scss → css, dockerfile → docker, objective-c → objectivec) plus any
// languageId without a dedicated icon (HLSL). The latter renders the
// claude-logo fallback but keeps a correct language name in the tooltip.
const LANG_DISPLAY: Readonly<Record<string, string>> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  react: 'React',
  typescriptreact: 'React',
  javascriptreact: 'React',
  vue: 'Vue',
  svelte: 'Svelte',
  astro: 'Astro',
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
  r: 'R',
  matlab: 'MATLAB',
  julia: 'Julia',
  ocaml: 'OCaml',
  fsharp: 'F#',
  clojure: 'Clojure',
  erlang: 'Erlang',
  perl: 'Perl',
  groovy: 'Groovy',
  objectivec: 'Objective-C',
  'objective-c': 'Objective-C',
  'objective-cpp': 'Objective-C++',
  graphql: 'GraphQL',
  docker: 'Docker',
  dockerfile: 'Docker',
  latex: 'LaTeX',
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

  // Treat the literal string "undefined" as no language. It's a valid
  // VS Code languageId, but its truthy-ness slips past getLanguageDisplayName's
  // LANG_DISPLAY/normalizeLang lookups and falls through to title-case
  // → renders as "Working in Undefined" on Discord.
  const language = state.currentLanguage === 'undefined' ? undefined : state.currentLanguage;
  const displayName = language ? getLanguageDisplayName(language) : undefined;

  let base: string | undefined;

  if (config.smartState) {
    if (state.debugActive) {
      base = displayName ? `Debugging in ${displayName}` : 'Debugging';
    } else if (state.focusContext === 'diff') {
      base = displayName ? `Reviewing in ${displayName}` : 'Reviewing';
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
    // Same literal-"undefined" filter as buildStateLine — keeps the icon
    // tooltip and the state line consistent (both fall through to the
    // Claude-logo fallback when the editor reports "undefined").
    const language = state.currentLanguage === 'undefined' ? undefined : state.currentLanguage;
    const iconKey = getLanguageIconKey(language);
    activity.smallImageKey = iconKey;
    // Tooltip names the language whenever we know its display name, even
    // when the icon falls back to the Claude logo — otherwise the state
    // line ("Working in HLSL") would disagree with the tooltip.
    activity.smallImageText = language
      ? getLanguageDisplayName(language)
      : FALLBACK_SMALL_TEXT;
  }

  return activity;
}
