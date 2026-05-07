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

---

### B1+E1 — `lastInteractedSource = 'editor'` flip on focus-regain and active-editor-change is a heuristic trade-off (NEEDS DECISION, 2026-05-06)
- **File:** `src/extension.ts:437-440` (B1, focus-regain branch in `onWindowStateChange`) and `src/extension.ts:597` (E1, `onDidChangeActiveTextEditor` handler)
- **Issue:** The A-E3 fix at commit fb6c393 (2026-05-06 deep audit) added the unconditional `lastInteractedSource = 'editor'` flip on focus regain at lines 437-440 to solve "stuck at 'In the terminal' after alt-tab back to editor". A symmetric flip already existed at line 597 (`onDidChangeActiveTextEditor`). Both flips have an asymmetric edge case: alt-tabbing back into VS Code with the terminal panel still focused (B1), or third-party `showTextDocument(uri, { preserveFocus: true })` while user is in terminal (E1), incorrectly flips to 'editor' and surfaces "Working in X" instead of "In the terminal" until the next terminal change.

  Both are heuristic-driven trade-offs given that VS Code does not expose which panel currently has focus. The verifier classified both as DISPUTED because the A-E3 fix author already accepted this trade — choosing the more common scenario over the rarer one.

- **Options:**
  - **(A) Dismiss as documented trade-off (RECOMMENDED).** Add the heuristic-cluster entry to `NON-ISSUES.md` (already done by verifier). Acknowledges that neither heuristic is universally correct; current behavior favors the more common alt-tab-back-to-editor scenario. Recovery is automatic on next terminal change. No code change.
  - **(B) Gate both flips on `!vscode.window.activeTerminal`.** Closes B1 and E1 simultaneously. Symmetric fix: line 437 becomes `if (vscode.window.activeTextEditor && !vscode.window.activeTerminal)` and line 597 becomes `if (editor && !vscode.window.activeTerminal)`. **Trade-off cost:** resurrects A-E3 in a new form — alt-tab back to editor while a terminal still exists (which is most users with an open terminal panel) would no longer reset `lastInteractedSource`, leaving status stuck at "In the terminal" until next selection event. Likely worse than the current trade-off because most active users keep a terminal panel open during normal editing.
  - **(C) Gate only on terminal-panel-focus signal IF VS Code adds an API for it later.** Track as a roadmap item; don't change today.

- **Verifier recommendation:** Option A. The current trade-off is the better one because (1) the rare scenario (terminal-still-focused after alt-tab) self-corrects on next terminal change, while (2) Option B's resurrected A-E3 case is the common one (any user with an open terminal panel) and self-corrects only on a selection event. Option A is also consistent with how the audit framed the finding: "a 'fix' here is really a design choice, not a defect."

- **Decided by:** *(pending Achille)*
