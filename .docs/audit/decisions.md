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
