import type { Config } from './config';

export interface ConfigTransition {
  readonly shutdown: boolean;
  readonly reconnect: boolean;
  readonly clearPinnedWord: boolean;
  readonly restartCycle: boolean;
  readonly restartIdleTimer: boolean;
  readonly applyIdleBehavior: boolean;
  readonly schedulePush: boolean;
}

export interface TransitionContext {
  readonly isIdle: boolean;
  readonly idleTimerArmed: boolean;
}

const NO_OP: ConfigTransition = {
  shutdown: false,
  reconnect: false,
  clearPinnedWord: false,
  restartCycle: false,
  restartIdleTimer: false,
  applyIdleBehavior: false,
  schedulePush: false,
};

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const set = new Set(a);
  for (const v of b) if (!set.has(v)) return false;
  return true;
}

export function computeConfigTransition(
  prev: Config | undefined,
  next: Config,
  ctx: TransitionContext,
): ConfigTransition {
  if (!next.enabled) return { ...NO_OP, shutdown: true };
  if (prev && !prev.enabled && next.enabled) return { ...NO_OP, reconnect: true };
  // Defensive: prev is always defined in production (activate() sets config
  // before the change listener can fire). Kept so the pure function works
  // standalone in tests and doesn't NPE if invoked out of order.
  if (!prev) return { ...NO_OP, schedulePush: true };

  const poolAffectingChanged =
    !sameStringSet(prev.customWords, next.customWords) ||
    prev.wordRarity !== next.wordRarity ||
    prev.timeBasedPools !== next.timeBasedPools;

  // Clear the pinned word so pickCandidateWord will re-roll on next push.
  // Two triggers:
  //   1. Entering pinned mode (cycleWords true→false): drop any stale pin.
  //   2. Already in pinned mode and the word pool changed (customWords,
  //      wordRarity, or timeBasedPools): otherwise the pinned word would
  //      silently ignore the new pool until cycleWords is toggled.
  const clearPinnedWord =
    (prev.cycleWords && !next.cycleWords) ||
    (!next.cycleWords && poolAffectingChanged);

  return {
    ...NO_OP,
    clearPinnedWord,
    restartCycle: prev.cycleSpeed !== next.cycleSpeed || prev.cycleWords !== next.cycleWords,
    restartIdleTimer: prev.idleThresholdMinutes !== next.idleThresholdMinutes && ctx.idleTimerArmed,
    applyIdleBehavior: prev.idleBehavior !== next.idleBehavior && ctx.isIdle,
    schedulePush: true,
  };
}
