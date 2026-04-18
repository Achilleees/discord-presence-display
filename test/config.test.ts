import { describe, it, expect, beforeEach } from 'vitest';
import { readConfig, onConfigChange } from '../src/config';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error mock module resolved via vitest alias
import { __setConfig, __resetConfig, __emitConfigChange } from 'vscode';

beforeEach(() => {
  __resetConfig();
});

describe('readConfig defaults', () => {
  it('returns plan defaults when no overrides set', () => {
    const cfg = readConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.cycleSpeed).toBe(15);
    expect(cfg.cycleWords).toBe(true);
    expect(cfg.customWords).toEqual([]);
    expect(cfg.showLanguage).toBe(true);
    expect(cfg.showWorkspace).toBe(false);
    expect(cfg.showElapsedTime).toBe(true);
    expect(cfg.showLanguageIcon).toBe(true);
    expect(cfg.smartState).toBe(true);
    expect(cfg.idleBehavior).toBe('slow');
    expect(cfg.idleThresholdMinutes).toBe(5);
    expect(cfg.wordRarity).toBe(false);
    expect(cfg.timeBasedPools).toBe(false);
  });
});

describe('cycleSpeed bounds', () => {
  it('clamps below 5 to 5', () => {
    __setConfig({ 'claudeSpinner.cycleSpeed': 1 });
    expect(readConfig().cycleSpeed).toBe(5);
  });
  it('clamps above 120 to 120', () => {
    __setConfig({ 'claudeSpinner.cycleSpeed': 500 });
    expect(readConfig().cycleSpeed).toBe(120);
  });
  it('accepts mid-range values', () => {
    __setConfig({ 'claudeSpinner.cycleSpeed': 42 });
    expect(readConfig().cycleSpeed).toBe(42);
  });
  it('coerces numeric strings (user hand-edited settings.json)', () => {
    __setConfig({ 'claudeSpinner.cycleSpeed': '42' });
    expect(readConfig().cycleSpeed).toBe(42);
  });
  it('falls back to min on non-numeric strings', () => {
    __setConfig({ 'claudeSpinner.cycleSpeed': 'fast' });
    expect(readConfig().cycleSpeed).toBe(5);
  });
});

describe('idleThresholdMinutes bounds', () => {
  it('clamps 0 to 1', () => {
    __setConfig({ 'claudeSpinner.idleThresholdMinutes': 0 });
    expect(readConfig().idleThresholdMinutes).toBe(1);
  });
  it('clamps above 60 to 60', () => {
    __setConfig({ 'claudeSpinner.idleThresholdMinutes': 999 });
    expect(readConfig().idleThresholdMinutes).toBe(60);
  });
});

describe('idleBehavior enum', () => {
  it('accepts valid enum values', () => {
    for (const v of ['slow', 'pause', 'clear', 'none']) {
      __setConfig({ 'claudeSpinner.idleBehavior': v });
      expect(readConfig().idleBehavior).toBe(v);
    }
  });
  it('coerces invalid values to slow', () => {
    __setConfig({ 'claudeSpinner.idleBehavior': 'explode' });
    expect(readConfig().idleBehavior).toBe('slow');
  });
});

describe('customWords sanitization', () => {
  it('filters empty and overly-long entries', () => {
    __setConfig({
      'claudeSpinner.customWords': [
        'Zooming',
        '',
        '   ',
        'x'.repeat(200),
        'Crafting',
      ],
    });
    const cfg = readConfig();
    expect(cfg.customWords).toEqual(['Zooming', 'Crafting']);
  });

  it('dedupes entries and strips whitespace', () => {
    __setConfig({
      'claudeSpinner.customWords': [' Zooming ', 'Zooming', 'Zooming'],
    });
    expect(readConfig().customWords).toEqual(['Zooming']);
  });

  it('ignores non-array values', () => {
    __setConfig({ 'claudeSpinner.customWords': 'not-an-array' });
    expect(readConfig().customWords).toEqual([]);
  });

  it('drops non-string entries', () => {
    __setConfig({ 'claudeSpinner.customWords': ['ok', 42, null, { bad: true }, 'also-ok'] });
    expect(readConfig().customWords).toEqual(['ok', 'also-ok']);
  });
});

describe('onConfigChange', () => {
  it('fires callback with fresh config when section changes', () => {
    __setConfig({ 'claudeSpinner.cycleSpeed': 20 });
    let observed: number | null = null;
    const d = onConfigChange((c) => {
      observed = c.cycleSpeed;
    });
    __setConfig({ 'claudeSpinner.cycleSpeed': 45 });
    __emitConfigChange(['claudeSpinner']);
    expect(observed).toBe(45);
    d.dispose();
  });

  it('does not fire callback for unrelated section changes', () => {
    let calls = 0;
    const d = onConfigChange(() => {
      calls++;
    });
    __emitConfigChange(['editor']);
    expect(calls).toBe(0);
    d.dispose();
  });
});
