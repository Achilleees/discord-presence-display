# Test Inventory — 2026-05-06 (post-deep-audit)

**Language:** TypeScript (VS Code extension)
**Test framework:** vitest 3.2.4
**Test command:** `npm test` → `vitest run`
**Coverage tool:** not configured

**Total test files:** 8
**Total test cases:** 214 (all passing)

## Per-Module Breakdown

| Module | Tests | File |
|---|---|---|
| Configuration parsing | 21 | `test/config.test.ts` |
| Discord IPC client | 20 | `test/discord-client.test.ts` |
| Extension orchestration | 51 | `test/extension.test.ts` |
| Instance lock (FS-race recovery) | 8 | `test/instance-lock.test.ts` |
| Presence payload + word picker | 46 | `test/presence.test.ts` |
| State / RingBuffer | 9 | `test/state.test.ts` |
| Pure transitions | 37 | `test/transitions.test.ts` |
| Word pool / weighted pick | 22 | `test/words.test.ts` |

## Recent code changes (since last audit)

The deep audit on 2026-05-06 fixed 14 findings across 6 clusters and was followed by a 20-test regression sweep (commit `4471ec9`, 194 → 214). New behaviors covered:
- `!config.enabled` post-await guard in `pushImmediate` (extension.ts)
- `RingBuffer.add` tail-dedup (state.ts) — covered by the new `state.test.ts`
- `discord.invalidateDedupCache()` in `applyIdleBehavior('pause')` (extension.ts)
- `state.lastWord` clear on `togglePaused.pause` (extension.ts)
- `clearLastWord` trigger on `cycleWords` mode flip (transitions.ts)
- Per-push `state.workspaceName` re-read (extension.ts)
- `lastInteractedSource` reset on focus regain (extension.ts)
- `startLockCheck` no longer unconditionally writes `state.isIdle` (extension.ts)
- Literal "undefined" languageId filtering (presence.ts)
- Hybrid id+identity check for debug session survivor (extension.ts)
- `pushDirty*` defensive reset on `togglePaused.resume` (extension.ts)
- `configListeners.clear()` in test mock (test/mocks/vscode.ts)
