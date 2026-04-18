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

function clamp(raw: unknown, min: number, max: number): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function sanitizeCustomWords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (trimmed.length === 0 || trimmed.length > 128) continue;
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
    enabled: cfg.get<boolean>('enabled', true),
    cycleSpeed: clamp(cfg.get<unknown>('cycleSpeed', 15), 5, 120),
    cycleWords: cfg.get<boolean>('cycleWords', true),
    customWords: sanitizeCustomWords(cfg.get<unknown>('customWords', [])),
    showLanguage: cfg.get<boolean>('showLanguage', true),
    showWorkspace: cfg.get<boolean>('showWorkspace', false),
    showElapsedTime: cfg.get<boolean>('showElapsedTime', true),
    showLanguageIcon: cfg.get<boolean>('showLanguageIcon', true),
    smartState: cfg.get<boolean>('smartState', true),
    idleBehavior: asIdleBehavior(cfg.get<string>('idleBehavior', 'slow')),
    idleThresholdMinutes: clamp(cfg.get<unknown>('idleThresholdMinutes', 5), 1, 60),
    wordRarity: cfg.get<boolean>('wordRarity', false),
    timeBasedPools: cfg.get<boolean>('timeBasedPools', false),
  };
}

export function onConfigChange(cb: (config: Config) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(CONFIG_SECTION)) {
      cb(readConfig());
    }
  });
}
