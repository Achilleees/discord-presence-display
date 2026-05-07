# Audit Decisions

Disputed findings from verified audit reports that require human judgment.

---

### 3.1 -- `CONTROL_CHAR` regex does not reject all invisible Unicode characters (RESOLVED, 2026-05-01)
- **Location:** `src/config.ts — sanitizeCustomWords()`
- **Issue:** Regex missed U+2060-2064, U+2066-2069, U+FFF9-FFFB (invisible/formatting Unicode)
- **Resolution:** Fixed — replaced hand-rolled character class with `\p{Cc}\p{Cf}` Unicode property escapes. Covers all current and future control/format characters.
- **Decided by:** Achille

---

### 46-B5 — `state.startTimestamp` is never refreshed across disable→enable cycles (RESOLVED, 2026-05-06)
- **File:** `src/extension.ts`
- **Issue:** Disable→enable kept counting through the disabled period.
- **Resolution:** Kept current behavior. README clarified to document the "since VS Code opened" semantics. Added to non-issues.md so future audits skip it.
- **Decided by:** Achille

---

### 46-B9 — `applyIdleBehavior('slow')` doesn't push fresh presence on engagement (RESOLVED, 2026-05-06)
- **File:** `src/extension.ts:405-410`
- **Issue:** Slow-mode idle entry doesn't fire an immediate push.
- **Resolution:** Dismissed. Engagement (focus regain) push is at `onWindowStateChange` line 388-394, not in `applyIdleBehavior`. The auditor cited the wrong location and conflated "idle entry" (intentional slowdown) with "engagement" (already handled). Added to non-issues.md.
- **Decided by:** Achille

---

### 47-E2 — `pushImmediate` cycling-mode commits to `recentWords` regardless of `delivered` (RESOLVED, 2026-05-06)
- **File:** `src/extension.ts:117-156`
- **Issue:** Cycling mode added the picked word to `recentWords` unconditionally, while pinned mode gated `pinnedWord` assignment on `delivered`. Asymmetric.
- **Resolution:** Made cycling symmetric with pinned — both now gate on `delivered`. The previous comment defending the unconditional add is replaced with one explaining the new symmetric contract: a failed IPC write doesn't burn a slot in the ring, and the next cycle tick can re-pick the same word (which is fine since Discord doesn't currently hold it).
- **Decided by:** Achille

---

### B2 — `resumeAfterReady` reconnect during idle-pause picks fresh word instead of `lastWord` (RESOLVED, 2026-05-06)
- **File:** `src/extension.ts:316-336`, `src/discord-client.ts`
- **Issue:** Reconnect during idle-pause violated the README "last presence stays visible" contract.
- **Resolution:** Added `invalidateDedupCache()` export to discord-client. `resumeAfterReady` now calls it before pushing and passes `useLastWord: true`. Centralizes cache invalidation at the reconnect boundary — production and test paths converge on the same behavior. Test mock no longer needs to reset cache externally.
- **Decided by:** Achille
