# Audit Decisions

Disputed findings from verified audit reports that require human judgment.

---

### 3.1 -- `CONTROL_CHAR` regex does not reject all invisible Unicode characters (RESOLVED, 2026-05-01)
- **Location:** `src/config.ts — sanitizeCustomWords()`
- **Issue:** Regex missed U+2060-2064, U+2066-2069, U+FFF9-FFFB (invisible/formatting Unicode)
- **Resolution:** Fixed — replaced hand-rolled character class with `\p{Cc}\p{Cf}` Unicode property escapes. Covers all current and future control/format characters.
- **Decided by:** Achille

---

### 46-B5 — `state.startTimestamp` is never refreshed across disable→enable cycles (DISPUTED, 2026-05-05)
- **File:** `src/extension.ts:393-414`
- **Issue:** When `claudeSpinner.enabled` toggles off then on, `state.startTimestamp` retains the original timestamp from extension activation. The Discord-side elapsed time keeps counting through the disabled period.
- **Auditor says:** User-facing "session elapsed time" should reset on re-enable — the disabled period wasn't a session.
- **Verifier says:** Both verifiers said DISPUTED — depends on what "session" semantics the README intends. Currently undocumented.
- **Options:**
  - Reset `startTimestamp` on enable transition (matches "session" word meaning)
  - Keep current behavior (matches "since VS Code opened" interpretation)
  - Document the intended semantics either way
- **Recommend:** Decide README contract first, then code follows.

---

### 46-B9 — `applyIdleBehavior('slow')` doesn't push fresh presence on engagement (DISPUTED, 2026-05-05)
- **File:** `src/extension.ts:362-365`
- **Issue:** `slow` mode quadruples the cycle interval but doesn't push a fresh presence on engagement — the visible word stays stale until the next slow tick (up to 120s).
- **Auditor says:** User just re-engaged, expects responsiveness.
- **Verifier says:** Both verifiers said DISPUTED — auditor itself admits "Probably intentional — 'slow' means less network traffic".
- **Options:**
  - Push immediately on engagement, then continue slow cycle (responsive)
  - Keep current behavior (consistent with "slow == less traffic")
- **Recommend:** Probably keep current behavior — the asymmetry is consistent with the mode's stated intent.

---

### 47-E2 — `pushImmediate` cycling-mode commits to `recentWords` regardless of `delivered` (DISPUTED-SPLIT, 2026-05-05)
- **File:** `src/extension.ts:117-121`
- **Issue:** Pinned mode (line 122) gates `state.pinnedWord` assignment on `delivered`; cycling mode (line 121) commits `state.recentWords.add(word)` unconditionally. Means the picker tracks words Discord may never have displayed.
- **Verifiers split:**
  - 4.6 verifier said DISPUTED — cited an explicit comment at extension.ts:117-120 documenting the unconditional add as intentional.
  - 4.7 verifier said CONFIRMED — argued the missing `delivered` gate is asymmetric with pinned mode and probably a bug.
- **Options:**
  - Trust the comment (4.6 view): leave as-is, document intent more clearly if needed
  - Trust the symmetry argument (4.7 view): add `&& delivered` to line 121
- **Recommend:** Read the comment in context — the documented intent should win unless the comment itself is wrong.

---

### B2 — `resumeAfterReady` reconnect during idle-pause picks fresh word instead of `lastWord` (NEEDS-HUMAN, 2026-05-06)
- **File:** `src/extension.ts:316-323` (specifically line 320)
- **Issue:** Per audit: `resumeAfterReady` calls `pushImmediate({ bypassIdleSilence: true })` without `useLastWord: true`. When reconnect happens during idle-pause in cycling mode, the picker excludes the recent ring and forces a fresh word, violating the README "last presence stays visible" contract.
- **Why NEEDS-HUMAN:** The recommended fix (`useLastWord: true`) was attempted and broke the existing test `'reconnect during idle "pause" pushes once but does not start cycling'`. Investigation: in production, a real reconnect goes through `discord.connect()` which resets `lastPayloadJson` (the dedup cache). The fixed code re-uses `state.lastWord`, builds the same payload as the prior idle-engagement push, and would correctly bypass dedup in production because the cache was reset on reconnect. But the test simulates reconnect by directly invoking the `onReady` callback — without going through `discord.connect`, the dedup cache still holds the prior payload, so the second push gets dedup-skipped and `setActivity` is never called.
- **Options:**
  - Update the test to reset the dedup cache before triggering `onReady` (model real reconnect behavior)
  - Add a `bypassDedup` option to pushImmediate/pushPresence that resumeAfterReady opts into
  - Refactor: have `resumeAfterReady` reset the dedup cache itself before pushing (matches discord-client.connect's existing reset)
  - Move the idle-pause branch to call `applyIdleBehavior('pause')` directly (centralizes the lastWord pinning, but still hits the same dedup cache issue)
- **Recommend:** Either update the test (the test is asserting buggy behavior — it cares that exactly 1 setActivity call happens, but in production with a real reconnect, the cache is cleared and that push goes through unchanged) OR add a dedup-bypass to `resumeAfterReady`'s push since reconnect is a known cache-invalidation moment.
