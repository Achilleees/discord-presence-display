import * as vscode from 'vscode';

export const CONFIG_SECTION = 'claudeSpinner';

export type IdleBehavior = 'slow' | 'pause' | 'clear' | 'none';

export interface Config {
  enabled: boolean;
  cycleSpeed: number;
  cycleWords: boolean;
  customWords: readonly string[];
  showLanguage: boolean;
  showWorkspace: boolean;
  showElapsedTime: boolean;
  showLanguageIcon: boolean;
  smartState: boolean;
  idleBehavior: IdleBehavior;
  idleThresholdMinutes: number;
  wordRarity: boolean;
  timeBasedPools: boolean;
}

function clamp(raw: unknown, min: number, max: number, def: number): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  const value = Number.isFinite(n) ? n : def;
  return Math.min(max, Math.max(min, value));
}

function toBool(raw: unknown, def: boolean): boolean {
  return typeof raw === 'boolean' ? raw : def;
}

const CUSTOM_WORDS_MAX = 500;
// Match Cc (control) and Cf (format) characters that should be filtered
// from custom words, but allow U+200D (ZWJ) \u2014 it's the connective glue
// in profession emoji (woman technologist), family emoji, and gendered
// emoji sequences. Filtering ZWJ silently breaks legitimate emoji custom
// words with no diagnostic. eslint-disable for the bracketed control
// class.
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR = /[\p{Cc}\p{Cf}\u2028\u2029\u202f]/u;
const ZWJ = '\u200d';

function sanitizeCustomWords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (out.length >= CUSTOM_WORDS_MAX) break;
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (trimmed.length === 0 || trimmed.length > 125) continue;
    // Strip ZWJ before testing — it's a legitimate emoji-sequence glue
    // character that \p{Cf} would otherwise reject. Any remaining Cc/Cf
    // is a real control/format character to filter.
    const stripped = trimmed.split(ZWJ).join('');
    if (stripped.length === 0) continue;  // all ZWJ → no real content
    if (CONTROL_CHAR.test(stripped)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function asIdleBehavior(v: unknown): IdleBehavior {
  return v === 'slow' || v === 'pause' || v === 'clear' || v === 'none' ? v : 'slow';
}

export function readConfig(): Config {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return {
    enabled: toBool(cfg.get<unknown>('enabled', true), true),
    cycleSpeed: clamp(cfg.get<unknown>('cycleSpeed', 15), 5, 120, 15),
    cycleWords: toBool(cfg.get<unknown>('cycleWords', true), true),
    customWords: sanitizeCustomWords(cfg.get<unknown>('customWords', [])),
    showLanguage: toBool(cfg.get<unknown>('showLanguage', true), true),
    showWorkspace: toBool(cfg.get<unknown>('showWorkspace', false), false),
    showElapsedTime: toBool(cfg.get<unknown>('showElapsedTime', true), true),
    showLanguageIcon: toBool(cfg.get<unknown>('showLanguageIcon', true), true),
    smartState: toBool(cfg.get<unknown>('smartState', true), true),
    idleBehavior: asIdleBehavior(cfg.get<unknown>('idleBehavior', 'slow')),
    idleThresholdMinutes: clamp(cfg.get<unknown>('idleThresholdMinutes', 5), 1, 60, 5),
    wordRarity: toBool(cfg.get<unknown>('wordRarity', false), false),
    timeBasedPools: toBool(cfg.get<unknown>('timeBasedPools', false), false),
  };
}

export function onConfigChange(cb: (config: Config) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(CONFIG_SECTION)) {
      cb(readConfig());
    }
  });
}
