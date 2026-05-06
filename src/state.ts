const RECENT_RING_SIZE = 3;

export class RingBuffer<T> {
  private buf: T[] = [];
  constructor(private readonly capacity: number) {}
  add(value: T): void {
    this.buf.push(value);
    if (this.buf.length > this.capacity) this.buf.shift();
  }
  values(): readonly T[] {
    // Copy so callers can't mutate the internal buffer via a widened cast.
    return this.buf.slice();
  }
  clear(): void {
    this.buf = [];
  }
}

// 'terminal' and 'diff' drive smart-state rules 3 and 4 in presence.ts.
// 'editor' and 'none' are kept for forward-compatibility (the presence
// renderer treats them identically — Working-in fallthrough — but the
// distinction documents the underlying focus shape for future consumers).
export type FocusContext = 'editor' | 'terminal' | 'diff' | 'none';

export interface State {
  paused: boolean;
  currentLanguage: string | undefined;
  // Wall-clock activation moment. Sent verbatim to Discord as
  // timestamps.start (Discord interprets this as Unix epoch). Do NOT use
  // this for elapsed-time math — wall clock can jump (NTP, manual clock
  // changes, sleep/resume) and would corrupt time-tier classification.
  startTimestamp: Date;
  // Monotonic baseline for elapsed-time math (used by timeBasedPools to
  // pick warming/zone/deep tiers). performance.now() is monotonic across
  // wall-clock changes; activation captures this baseline once and the
  // delta is what classifyTimeTier consumes.
  startMonotonicMs: number;
  recentWords: RingBuffer<string>;
  isIdle: boolean;
  debugActive: boolean;
  focusContext: FocusContext;
  workspaceName: string | undefined;
  pinnedWord: string | undefined;
  // Last word actually delivered to Discord — used to keep the displayed
  // word stable across transitions like idle→pause where the README
  // promises "last presence stays visible." Distinct from recentWords
  // (anti-duplicate ring) and pinnedWord (cycling=false sticky).
  lastWord: string | undefined;
}

export function createState(
  startTimestamp: Date,
  initialLanguage: string | undefined,
  workspaceName: string | undefined,
): State {
  return {
    paused: false,
    currentLanguage: initialLanguage,
    startTimestamp,
    startMonotonicMs: performance.now(),
    recentWords: new RingBuffer<string>(RECENT_RING_SIZE),
    isIdle: false,
    debugActive: false,
    focusContext: 'none',
    workspaceName,
    pinnedWord: undefined,
    lastWord: undefined,
  };
}
