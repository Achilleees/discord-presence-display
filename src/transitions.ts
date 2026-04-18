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

export function computeConfigTransition(
  prev: Config | undefined,
  next: Config,
  ctx: TransitionContext,
): ConfigTransition {
  if (!next.enabled) return { ...NO_OP, shutdown: true };
  if (prev && !prev.enabled && next.enabled) return { ...NO_OP, reconnect: true };
  if (!prev) return { ...NO_OP, schedulePush: true };

  return {
    ...NO_OP,
    clearPinnedWord: prev.cycleWords && !next.cycleWords,
    restartCycle: prev.cycleSpeed !== next.cycleSpeed || prev.cycleWords !== next.cycleWords,
    restartIdleTimer: prev.idleThresholdMinutes !== next.idleThresholdMinutes && ctx.idleTimerArmed,
    applyIdleBehavior: prev.idleBehavior !== next.idleBehavior && ctx.isIdle,
    schedulePush: true,
  };
}
