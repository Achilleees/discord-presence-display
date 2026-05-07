import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../src/state';

describe('RingBuffer.add', () => {
  // P-11 (deferred from prior audit): direct unit tests for the public ring
  // surface, previously only exercised transitively through pickCandidateWord.

  it('appends values up to capacity', () => {
    const ring = new RingBuffer<string>(3);
    ring.add('A');
    ring.add('B');
    ring.add('C');
    expect(ring.values()).toEqual(['A', 'B', 'C']);
  });

  it('drops the oldest entry when capacity is exceeded (FIFO eviction)', () => {
    const ring = new RingBuffer<string>(3);
    ring.add('A');
    ring.add('B');
    ring.add('C');
    ring.add('D');
    expect(ring.values()).toEqual(['B', 'C', 'D']);
  });

  it('dedups against the current tail (P-3 audit 2026-05-06)', () => {
    // state.ts:12 — without this guard, a useLastWord push that hits the
    // discord-client dedup cache still resolves with delivered=true and
    // calls back into add() with the same word, shrinking the effective
    // anti-duplicate window from 3 to 2.
    const ring = new RingBuffer<string>(3);
    ring.add('Thinking');
    ring.add('Thinking');
    expect(ring.values()).toEqual(['Thinking']);
  });

  it('only dedups against the immediate tail, not earlier entries (P-3 audit 2026-05-06)', () => {
    // The dedup is a tail-only check. A repeated value separated by a
    // different value is allowed — that's a legitimate cycle return.
    const ring = new RingBuffer<string>(3);
    ring.add('A');
    ring.add('B');
    ring.add('A');
    expect(ring.values()).toEqual(['A', 'B', 'A']);
  });

  it('dedups even when the tail entry is the only entry', () => {
    const ring = new RingBuffer<string>(3);
    ring.add('Solo');
    ring.add('Solo');
    ring.add('Solo');
    expect(ring.values()).toEqual(['Solo']);
  });
});

describe('RingBuffer.values', () => {
  it('returns a defensive copy that callers cannot use to mutate the buffer (P-11 audit 2026-05-06)', () => {
    // state.ts:18 — `.slice()` keeps consumers from widening the readonly
    // type and pushing into the internal buffer. A revert to `return this.buf`
    // would let pickCandidateWord callers shrink the recent ring window.
    const ring = new RingBuffer<string>(3);
    ring.add('A');
    ring.add('B');
    const snapshot = ring.values() as string[];
    snapshot.push('C');
    snapshot[0] = 'mutated';
    // Internal buffer must remain untouched.
    expect(ring.values()).toEqual(['A', 'B']);
  });

  it('returns an empty array on a fresh buffer', () => {
    const ring = new RingBuffer<string>(3);
    expect(ring.values()).toEqual([]);
  });
});

describe('RingBuffer.clear', () => {
  it('empties the buffer so values() returns [] post-clear (P-11 audit 2026-05-06)', () => {
    const ring = new RingBuffer<string>(3);
    ring.add('A');
    ring.add('B');
    ring.clear();
    expect(ring.values()).toEqual([]);
  });

  it('allows fresh adds after clear (P-11 audit 2026-05-06)', () => {
    // Asserts clear() resets state, not just hides it — a regression that
    // simply nulled .values()' return without resetting the underlying
    // buffer would fail this test on the post-clear .add().
    const ring = new RingBuffer<string>(3);
    ring.add('A');
    ring.add('B');
    ring.add('C');
    ring.clear();
    ring.add('D');
    expect(ring.values()).toEqual(['D']);
  });
});
