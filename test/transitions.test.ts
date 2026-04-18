import { describe, it, expect } from 'vitest';
import { computeConfigTransition } from '../src/transitions';
import type { Config } from '../src/config';

function cfg(overrides: Partial<Config> = {}): Config {
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

const IDLE_CTX = { isIdle: true, idleTimerArmed: false };
const ACTIVE_CTX = { isIdle: false, idleTimerArmed: false };
const ARMED_CTX = { isIdle: false, idleTimerArmed: true };

describe('computeConfigTransition', () => {
  it('returns shutdown when next.enabled=false', () => {
    const t = computeConfigTransition(cfg(), cfg({ enabled: false }), ACTIVE_CTX);
    expect(t.shutdown).toBe(true);
    expect(t.reconnect).toBe(false);
    expect(t.schedulePush).toBe(false);
  });

  it('returns reconnect on disabled→enabled transition', () => {
    const t = computeConfigTransition(cfg({ enabled: false }), cfg({ enabled: true }), ACTIVE_CTX);
    expect(t.reconnect).toBe(true);
    expect(t.shutdown).toBe(false);
  });

  it('returns schedulePush with no other actions on first run (prev undefined)', () => {
    const t = computeConfigTransition(undefined, cfg(), ACTIVE_CTX);
    expect(t.schedulePush).toBe(true);
    expect(t.clearPinnedWord).toBe(false);
    expect(t.restartCycle).toBe(false);
  });

  describe('pinnedWord reset (audit 3.1 regression)', () => {
    it('clears pinnedWord on cycleWords true→false transition', () => {
      const t = computeConfigTransition(cfg({ cycleWords: true }), cfg({ cycleWords: false }), ACTIVE_CTX);
      expect(t.clearPinnedWord).toBe(true);
    });

    it('does NOT clear pinnedWord when cycleWords stays false (unrelated setting change)', () => {
      const prev = cfg({ cycleWords: false, showWorkspace: false });
      const next = cfg({ cycleWords: false, showWorkspace: true });
      const t = computeConfigTransition(prev, next, ACTIVE_CTX);
      expect(t.clearPinnedWord).toBe(false);
    });

    it('does NOT clear pinnedWord on cycleWords false→true transition', () => {
      const t = computeConfigTransition(cfg({ cycleWords: false }), cfg({ cycleWords: true }), ACTIVE_CTX);
      expect(t.clearPinnedWord).toBe(false);
    });

    it('does NOT clear pinnedWord when cycleWords stays true', () => {
      const t = computeConfigTransition(cfg({ cycleWords: true }), cfg({ cycleWords: true }), ACTIVE_CTX);
      expect(t.clearPinnedWord).toBe(false);
    });

    it('clears pinnedWord when customWords changes in pinned mode', () => {
      const prev = cfg({ cycleWords: false, customWords: ['A'] });
      const next = cfg({ cycleWords: false, customWords: ['A', 'B'] });
      const t = computeConfigTransition(prev, next, ACTIVE_CTX);
      expect(t.clearPinnedWord).toBe(true);
    });

    it('clears pinnedWord when wordRarity flips in pinned mode', () => {
      const prev = cfg({ cycleWords: false, wordRarity: false });
      const next = cfg({ cycleWords: false, wordRarity: true });
      const t = computeConfigTransition(prev, next, ACTIVE_CTX);
      expect(t.clearPinnedWord).toBe(true);
    });

    it('clears pinnedWord when timeBasedPools flips in pinned mode', () => {
      const prev = cfg({ cycleWords: false, timeBasedPools: false });
      const next = cfg({ cycleWords: false, timeBasedPools: true });
      const t = computeConfigTransition(prev, next, ACTIVE_CTX);
      expect(t.clearPinnedWord).toBe(true);
    });

    it('does NOT clear pinnedWord when pool-affecting change happens in cycling mode', () => {
      const prev = cfg({ cycleWords: true, wordRarity: false });
      const next = cfg({ cycleWords: true, wordRarity: true });
      const t = computeConfigTransition(prev, next, ACTIVE_CTX);
      expect(t.clearPinnedWord).toBe(false);
    });
  });

  describe('cycle restart', () => {
    it('restarts cycle when cycleSpeed changes', () => {
      const t = computeConfigTransition(cfg({ cycleSpeed: 15 }), cfg({ cycleSpeed: 30 }), ACTIVE_CTX);
      expect(t.restartCycle).toBe(true);
    });

    it('restarts cycle when cycleWords flips', () => {
      const t = computeConfigTransition(cfg({ cycleWords: true }), cfg({ cycleWords: false }), ACTIVE_CTX);
      expect(t.restartCycle).toBe(true);
    });

    it('does not restart cycle on unrelated setting change', () => {
      const t = computeConfigTransition(cfg({ showWorkspace: false }), cfg({ showWorkspace: true }), ACTIVE_CTX);
      expect(t.restartCycle).toBe(false);
    });
  });

  describe('idle timer restart', () => {
    it('restarts idle timer when threshold changes and timer is armed', () => {
      const t = computeConfigTransition(cfg({ idleThresholdMinutes: 5 }), cfg({ idleThresholdMinutes: 10 }), ARMED_CTX);
      expect(t.restartIdleTimer).toBe(true);
    });

    it('does NOT restart idle timer when threshold changes and timer is NOT armed', () => {
      const t = computeConfigTransition(cfg({ idleThresholdMinutes: 5 }), cfg({ idleThresholdMinutes: 10 }), ACTIVE_CTX);
      expect(t.restartIdleTimer).toBe(false);
    });
  });

  describe('idleBehavior live-reload', () => {
    it('applies new idleBehavior when changed while idle', () => {
      const t = computeConfigTransition(cfg({ idleBehavior: 'slow' }), cfg({ idleBehavior: 'clear' }), IDLE_CTX);
      expect(t.applyIdleBehavior).toBe(true);
    });

    it('does NOT apply new idleBehavior when not idle', () => {
      const t = computeConfigTransition(cfg({ idleBehavior: 'slow' }), cfg({ idleBehavior: 'clear' }), ACTIVE_CTX);
      expect(t.applyIdleBehavior).toBe(false);
    });
  });

  it('always schedules push for any non-shutdown/non-reconnect change', () => {
    const t = computeConfigTransition(cfg({ showWorkspace: false }), cfg({ showWorkspace: true }), ACTIVE_CTX);
    expect(t.schedulePush).toBe(true);
  });
});
