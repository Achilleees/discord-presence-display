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
}

// 'terminal' and 'diff' drive smart-state rules 3 and 4 in presence.ts.
// 'editor' and 'none' are informational (reserved for diagnostics); the
// presence renderer treats them identically to "use rule 6 fallthrough".
export type FocusContext = 'editor' | 'terminal' | 'diff' | 'none';

export interface State {
  paused: boolean;
  currentLanguage: string | undefined;
  startTimestamp: Date;
  recentWords: RingBuffer<string>;
  isIdle: boolean;
  debugActive: boolean;
  focusContext: FocusContext;
  workspaceName: string | undefined;
  pinnedWord: string | undefined;
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
    recentWords: new RingBuffer<string>(RECENT_RING_SIZE),
    isIdle: false,
    debugActive: false,
    focusContext: 'none',
    workspaceName,
    pinnedWord: undefined,
  };
}
