const RECENT_RING_SIZE = 3;

export class RingBuffer<T> {
  private buf: T[] = [];
  constructor(private readonly capacity: number) {}
  add(value: T): void {
    this.buf.push(value);
    if (this.buf.length > this.capacity) this.buf.shift();
  }
  values(): readonly T[] {
    return this.buf;
  }
}

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
