# Non-Issues Registry

Patterns verified as intentional for this codebase. The hostile-code-auditor
reads this file and skips matching patterns in future audits.

---

## Error Handling

### Silent Discord failures are intentional
- **Location:** `src/discord-client.ts, src/extension.ts — catch blocks (codebase-wide)`
- **Pattern:** `.catch(() => {})`, empty catch blocks, no user-visible error reporting
- **Why it's correct:** Project invariant -- "Discord is optional...never surfaces errors to the user." All Discord operations are fire-and-forget with silent fallbacks.
- **Verified:** 2026-04-20

## Data Structures

### `sameStringSet` assumes deduplicated inputs
- **Location:** `src/transitions.ts — sameStringSet()`
- **Pattern:** `sameStringSet(a, b)` could be fooled by duplicate entries in `a`
- **Why it's correct:** `sanitizeCustomWords` deduplicates before values reach config, so the path cannot trigger with duplicate inputs.
- **Verified:** 2026-04-20

### `RECENT_RING_SIZE` and `EXCLUSION_CAP` are independent by design
- **Location:** `src/state.ts — RECENT_RING_SIZE; src/words.ts — EXCLUSION_CAP`
- **Pattern:** Two constants with the same value (3) in separate modules with no cross-reference.
- **Why it's correct:** `getNextWord` uses `Math.min(EXCLUSION_CAP, maxExclude, recent.length)` -- mismatches in either direction degrade gracefully. Ring size controls memory (how many to track), exclusion cap controls policy (how many to skip). They serve different purposes and neither constrains the other. Equal today by coincidence of a reasonable default, not by invariant.
- **Verified:** 2026-04-20

## Concurrency

### Instance-lock heartbeat TOCTOU is acceptable for best-effort locking
- **Location:** `src/instance-lock.ts — startHeartbeat()`
- **Pattern:** Heartbeat reads lock PID, then writes updated timestamp -- no atomic check-and-write.
- **Why it's correct:** The read and write are adjacent synchronous calls in a single event-loop tick (microsecond gap). The competing `tryAcquire()` would need to complete 4+ filesystem syscalls in that window from a separate process. The lock is a best-effort single-instance mechanism, not a distributed consensus protocol. The worst case (brief presence flickering) is cosmetic and self-correcting on the next heartbeat. The audit report's own notes acknowledged this as acceptable.
- **Verified:** 2026-04-23

### Corrupted lock file JSON treated as "no lock" is consistent with best-effort design
- **Location:** `src/instance-lock.ts — readLock()`
- **Pattern:** `readLock()` catches `JSON.parse` failures and returns `null`, which `tryAcquire()` interprets as "no existing lock."
- **Why it's correct:** This is a variant of the TOCTOU non-issue already registered. The corruption scenario requires process kill during a microsecond-scale `writeFileSync` window. Self-corrects within one heartbeat (30s). Impact is brief cosmetic flickering, identical to the registered lock-race non-issue. Additionally, `tryAcquire()` uses `mkdirSync` (atomic directory creation) as a secondary mutual-exclusion mechanism.
- **Verified:** 2026-05-01

## Library Patterns

### `formatActivity` omitting unused `SetActivity` fields is intentional
- **Location:** `src/discord-client.ts — formatActivity()`
- **Pattern:** Custom `formatActivity` function only formats the fields actually used by `buildPresencePayload` (`type`, `details`, `state`, `startTimestamp`, `endTimestamp`, `largeImageKey`, `smallImageKey`, `largeImageText`, `smallImageText`, `statusDisplayType`), omitting library fields like `name`, `url`, `partyId`, `buttons`, `secrets`, `supportedPlatforms`.
- **Why it's correct:** The function exists to fix the `created_at: Date.now()` flicker bug. It handles every field that `buildPresencePayload()` can produce. The omitted fields are Discord features for game lobbies, streaming, and invites that are permanently out of scope for a coding-status presence display. The bypass is documented in the module header comment.
- **Verified:** 2026-04-22

### Optional chaining on `client.user` follows library convention
- **Location:** `src/discord-client.ts — pushPresence(), clearPresence()`
- **Pattern:** `if (!c.user) return false` (pushPresence), `c.user?.clearActivity(...)` (clearPresence)
- **Why it's correct:** The `@xhayper/discord-rpc` library types `user` as `ClientUser | undefined` and its own README uses `client.user?.setActivity(...)`. The optional chaining is the expected access pattern. NOTE: the *return value semantics* of `pushPresence` when `user` is undefined are a separate concern -- the chaining itself is not the bug.
- **Verified:** 2026-04-20

### `clearPresence` void return is acceptable given library call ordering
- **Location:** `src/discord-client.ts — clearPresence()`
- **Pattern:** `clearPresence()` returns `void` and uses optional chaining `c.user?.clearActivity()` without reporting whether the clear succeeded.
- **Why it's correct:** All call sites in `extension.ts` that invoke `clearPresence` are reachable only after the library's "ready" event fires, at which point `client.user` is already populated. The `@xhayper/discord-rpc` library sets `user` from the DISPATCH/READY message synchronously before emitting "connected", and `login()` without scopes emits "ready" immediately after. There is no production code path where `clearPresence` runs with `isConnected=true` but `user=undefined`. The asymmetry with `pushPresence` (which returns `boolean`) is a style choice, not a bug. If this is ever revisited, it should be treated as a LOW-priority defensive hardening, not a HIGH-severity issue.
- **Verified:** 2026-04-20

## Configuration

### `CUSTOM_WORDS_MAX = 500` silent truncation is intentional defensive ceiling
- **Location:** `src/config.ts — CUSTOM_WORDS_MAX`
- **Pattern:** `sanitizeCustomWords` silently stops adding entries after 500 with no user diagnostic.
- **Why it's correct:** This is a sanity bound to prevent memory/performance issues from pathological config, not a user-facing feature constraint. VS Code extensions routinely apply internal defensive limits without diagnostics. No user will manually enter 500+ words into a settings.json array. Per-item validation (type, length) is enforced via `package.json` schema.
- **Verified:** 2026-04-20

## Test Infrastructure

### `mockDebugSessionCounter` monotonic increment is intentional
- **Location:** `test/mocks/vscode.ts — mockDebugSessionCounter`
- **Pattern:** Counter increments across test cases and is not reset by `__resetEvents()`.
- **Why it's correct:** The counter generates unique session IDs. No test asserts on numeric ID values -- they capture the returned ID by reference. Monotonic increment guarantees uniqueness across tests, which is the desired property. Resetting would risk collisions.
- **Verified:** 2026-04-20

## Naming / Comments

### Smart-state rule numbering differs between README and internal code
- **Location:** `test/presence.test.ts — smart-state rule tests; README.md — smart state table`
- **Pattern:** README uses a simplified 1-4 numbering (debug=1, diff=2, terminal=3, working=4). Test names use a fuller scheme (rule 2=debug, rule 3=diff, rule 4=terminal, rule 5=undefined-language, rule 6=working) that includes implementation-only steps not relevant to end users.
- **Why it's correct:** The README numbering is a user-facing simplification that intentionally omits internal-only rules (rule 1: showLanguage=false gate, rule 5: undefined language fallback). The `presence.test.ts` test names use the internal numbering consistently. Two numbering schemes (user-facing vs internal) is normal for documented software. Note: `state.ts` formerly referenced "rule 6" but was updated to use a descriptive reference ("Working-in fallthrough") in audit 2026-04-23.
- **Verified:** 2026-04-23

## Language / Display

### `LANG_DISPLAY` raw-key-first lookup in `getLanguageDisplayName` is intentional
- **Location:** `src/presence.ts — getLanguageDisplayName(), LANG_DISPLAY, LANG_ID_OVERRIDES`
- **Pattern:** `getLanguageDisplayName` checks `LANG_DISPLAY[languageId]` before normalizing via `LANG_ID_OVERRIDES`. Dialect entries like `less` and `scss` return their own display names ("Less", "SCSS") rather than their parent icon group's name ("CSS").
- **Why it's correct:** This is the entire point of the two-step lookup. LANG_ID_OVERRIDES routes icons (less -> css icon), while LANG_DISPLAY preserves correct display names. The comment block above LANG_DISPLAY explicitly documents this pattern. A refactor to normalize-first would change the function's semantics, not expose a latent bug.
- **Verified:** 2026-04-23

### Empty-string `languageId` is correctly handled by falsy guards
- **Location:** `src/presence.ts — buildStateLine(), buildPresencePayload(); src/extension.ts — pushImmediate()`
- **Pattern:** `language ? getLanguageDisplayName(language) : undefined` appears to pass empty string to `getLanguageDisplayName`.
- **Why it's correct:** Empty string `""` is falsy in JavaScript. The ternary in `buildStateLine()` evaluates to `undefined` when `language` is `""`, so `getLanguageDisplayName` is never called with an empty string. The downstream `displayName` guard in `buildStateLine()` correctly omits the state line. Same pattern in `buildPresencePayload()`. Any finding claiming `""` is truthy in JS is based on a factual error.
- **Verified:** 2026-05-01

## Discord API

### Discord silently truncates long `state`/`details` fields -- extension does not need to
- **Location:** `src/presence.ts — buildStateLine(), buildPresencePayload()`
- **Pattern:** `buildStateLine` appends workspace name without a length check. The `state` field sent to Discord can exceed 128 characters with long folder names.
- **Why it's correct:** Discord's Rich Presence API silently truncates overlong fields. The extension delegates display-length enforcement to Discord rather than hardcoding assumptions about field limits (which have changed historically). The `showWorkspace` setting defaults to `false` (README: "Off by default for privacy"), so users who enable it are opting into user-controlled workspace names. Graceful truncation by Discord is the expected degradation path.
- **Verified:** 2026-04-23

### Case-sensitive custom word dedup is documented and intentional
- **Location:** `src/words.ts — buildPool(); README.md — custom words section`
- **Pattern:** `buildPool` uses `builtIn.has(word)` (case-sensitive) to dedup custom words against built-in WORDS.
- **Why it's correct:** README.md explicitly documents this: `Case-sensitive -- "working" and built-in "Working" both appear.` This is a deliberate feature allowing users to add lowercase variants of built-in words. All built-in words are capitalized; a lowercase custom word is a distinct user choice.
- **Verified:** 2026-04-23

## Repository Hygiene

### `convert.sh` in assets/discord/ is a developer utility, not dead code
- **Location:** `assets/discord/convert.sh`
- **Pattern:** Shell script for converting SVG assets to PNG for Discord Developer Portal upload. Not referenced by npm scripts or build pipeline. Excluded from VSIX by `.vscodeignore`.
- **Why it's correct:** This is a one-shot developer utility run manually when assets change. It is not part of the build pipeline by design. The script has a clear header comment explaining its purpose. Utility scripts in a repo are normal and do not constitute dead code.
- **Verified:** 2026-05-01

### `.vscodeignore` entry for `assets/screenshots/**` is forward-looking, not stale
- **Location:** `.vscodeignore — assets/screenshots/** entry`
- **Pattern:** Scanner flags `assets/screenshots/**` as stale because the directory was deleted in commit 36ad11a.
- **Why it's correct:** ROADMAP.md plans "Hero screenshot/GIF at the top of the README." When screenshots are re-added, this `.vscodeignore` entry will correctly exclude them from the VSIX. `vsce package` silently ignores unmatched patterns, so the entry has zero build impact. Preemptive ignore entries for roadmap items are a reasonable practice.
- **Verified:** 2026-05-01

### Missing issue templates / CONTRIBUTING.md is a tracked roadmap item, not a finding
- **Location:** `ROADMAP.md — issue templates item`
- **Pattern:** Scanner suggests adding issue templates and a contributing guide before marketplace publication.
- **Why it's correct:** ROADMAP.md explicitly tracks this: "Issue template for bug reports and language requests." The repo has a single maintainer. Inconsistent issue formatting is a non-problem at this scale. Restating a roadmap item as an audit finding adds no information.
- **Verified:** 2026-05-01

### `.gitignore` line-comment grouping is stylistic polish, not a hygiene issue
- **Location:** `.gitignore — assets/discord/png/, submission/ entries (lines 10-11)`
- **Pattern:** Scanner suggests adding an inline comment to `.gitignore` explaining why `assets/discord/png/` (convert.sh output) and `submission/` (developer-only marketplace correspondence) are ignored.
- **Why it's not a hygiene issue:** The `.gitignore` entries are correct and harmless. Intent is preserved in `.docs/audit/non-issues.md` (the `convert.sh` non-issue is registered) and the README/script headers, which is the canonical place for project context. Inline comments in `.gitignore` files are stylistic preference, not a hygiene defect. This pattern is "polish, not load-bearing" and should be treated as a SUGGESTION rather than a CLEAN-UP finding.
- **Verified:** 2026-05-05

### ~~Committed `.vsix` binary~~ (RESOLVED)
- **Resolution:** Moved to GitHub Releases. `*.vsix` now gitignored, `release.sh` creates GitHub releases with attached VSIX automatically.
- **Resolved:** 2026-05-01

### Untracked `coding-status-for-discord-*.vsix` in repo root is a release artifact, not a hygiene defect
- **Location:** Repo root — `coding-status-for-discord-${version}.vsix`
- **Pattern:** Scanner may flag a `.vsix` file present in the repo root. It is correctly gitignored via `*.vsix` (line 12 of `.gitignore`).
- **Why it's correct:** `release.sh` builds a VSIX via `vsce package`, attaches it to the GitHub Release via `gh release create`, then deletes it via `rm -f "$VSIX"` on line 68. If the script is interrupted or the VSIX is rebuilt locally, the file may remain. `git status --ignored` confirms the file is properly ignored — it's a build artifact, not committed content. Safe to delete manually whenever it shows up.
- **Verified:** 2026-05-05

### Disable→enable corrupt-lock-file race during the disabled-period gap
- **Location:** `src/instance-lock.ts — acquireOrWatch() + release() in handleConfigChange.shutdown`
- **Pattern:** Auditor flagged that toggling `claudeSpinner.enabled` off then on rapidly could hit a corrupt-lock-file race window between `release()` and the next `acquireOrWatch()`.
- **Why it's correct:** The auditor self-downgraded this finding to LOW with "None required" and noted "this is theoretical." The race window is microseconds wide, and any failure outcome is benign (presence falls back to secondary mode and recovers on the next 30s lock check). Both verifiers (Opus 4.6 and 4.7) classified this as FALSE-POSITIVE in the deep audit.
- **Verified:** 2026-05-05

### `weightedPick` floating-point cumulative drift across very heavy weights
- **Location:** `src/words.ts:437-449 — weightedPick()`
- **Pattern:** Auditor noted that summing many large weights cumulatively could cause `pick > total` due to FP rounding, picking the "wrong" word.
- **Why it's correct:** The auditor self-rejected this with "Already handled by the trailing fallback. No action needed. Drop-candidate." The function's last-resort fallback returns the final element when no cumulative bucket matches — making any FP drift cosmetic at most. Both verifiers (Opus 4.6 and 4.7) classified this as FALSE-POSITIVE in the deep audit.
- **Verified:** 2026-05-05

## Behavior Contracts

### `state.startTimestamp` counts from VS Code session, not from extension enable
- **Location:** `src/extension.ts — activate(), togglePaused(), handleConfigChange()`
- **Pattern:** Auditors flag that `state.startTimestamp` is set once at activation and never refreshed when `claudeSpinner.enabled` toggles off→on. The Discord-side elapsed time keeps counting through the disabled period.
- **Why it's correct:** This is the documented contract. The README explicitly states "Counts from when VS Code opened, not from when the extension was last enabled — disabling and re-enabling does not reset the timer." Resetting on enable would conflict with the "session = VS Code session" interpretation that several other constants (e.g., `startMonotonicMs`, time-tier classification) already encode.
- **Verified:** 2026-05-06 (originally 46-B5 from 2026-05-05 deep audit)

### `applyIdleBehavior('slow')` engagement push lives at `onWindowStateChange`, not in the idle-behavior switch
- **Location:** `src/extension.ts:441-445 (onWindowStateChange focus-regain branch)`
- **Pattern:** Auditors flag that the `case 'slow'` arm of `applyIdleBehavior()` only calls `startCycle()` without pushing fresh presence — the displayed word stays until the next slow tick (up to 120s).
- **Why it's correct:** Engagement (focus regain) is handled at `onWindowStateChange`'s `else { ... if (state.isIdle) { ... } }` branch, which fires `pushImmediate()` and `startCycle()` (now at normal interval, since `state.isIdle = false` is set first and `computeIntervalMs` reads it). The "stale word during idle" period is by design — the user has stepped away. If they want responsive updates while unfocused, they pick `idleBehavior: 'none'`. The switch arm intentionally does not push: the user is not watching at idle entry.
- **Verified:** 2026-05-06 (originally 46-B9 from 2026-05-05 deep audit)

### `applyIdleBehavior('clear')` does not reset `state.lastWord`; clear→pause flip restores pre-clear word
- **Location:** `src/extension.ts:435-438 (applyIdleBehavior 'clear' branch)`
- **Pattern:** Auditors flag that when `idleBehavior=clear` engages, `state.lastWord` is not cleared. A subsequent `idleBehavior` flip from `clear` to `pause` while still idle re-uses `state.lastWord` via `useLastWord:true`, surfacing the pre-clear word that Discord just had cleared.
- **Why it's correct:** Matches the README "last presence stays visible" contract for the `pause` semantics — the last delivered word is restored on pause re-engagement. The behavior is codified by the existing test `idleBehavior clear→pause while idle restores presence` at `test/extension.test.ts:333-350`. Auditor itself admits the alternative interpretation is "consistent with README literal reading." Both verifiers in the deep audit (A-B2, 2026-05-06) classified as DISPUTED with the dismiss recommendation.
- **Verified:** 2026-05-06 (originally A-B2 from 2026-05-06 deep audit)
