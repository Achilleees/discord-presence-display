# Non-Issues Registry

Patterns verified as intentional for this codebase. The hostile-code-auditor
reads this file and skips matching patterns in future audits.

---

## Error Handling

### Silent Discord failures are intentional
- **Location:** codebase-wide (`src/discord-client.ts`, `src/extension.ts`)
- **Pattern:** `.catch(() => {})`, empty catch blocks, no user-visible error reporting
- **Why it's correct:** Project invariant -- "Discord is optional...never surfaces errors to the user." All Discord operations are fire-and-forget with silent fallbacks.
- **Verified:** 2026-04-20

## Data Structures

### `sameStringSet` assumes deduplicated inputs
- **Location:** `src/transitions.ts`
- **Pattern:** `sameStringSet(a, b)` could be fooled by duplicate entries in `a`
- **Why it's correct:** `sanitizeCustomWords` deduplicates before values reach config, so the path cannot trigger with duplicate inputs.
- **Verified:** 2026-04-20

### `RECENT_RING_SIZE` and `EXCLUSION_CAP` are independent by design
- **Location:** `src/state.ts:1`, `src/words.ts:421`
- **Pattern:** Two constants with the same value (3) in separate modules with no cross-reference.
- **Why it's correct:** `getNextWord` uses `Math.min(EXCLUSION_CAP, maxExclude, recent.length)` -- mismatches in either direction degrade gracefully. Ring size controls memory (how many to track), exclusion cap controls policy (how many to skip). They serve different purposes and neither constrains the other. Equal today by coincidence of a reasonable default, not by invariant.
- **Verified:** 2026-04-20

## Library Patterns

### `formatActivity` omitting unused `SetActivity` fields is intentional
- **Location:** `src/discord-client.ts:34-74`
- **Pattern:** Custom `formatActivity` function only formats the fields actually used by `buildPresencePayload` (`type`, `details`, `state`, `startTimestamp`, `endTimestamp`, `largeImageKey`, `smallImageKey`, `largeImageText`, `smallImageText`, `statusDisplayType`), omitting library fields like `name`, `url`, `partyId`, `buttons`, `secrets`, `supportedPlatforms`.
- **Why it's correct:** The function exists to fix the `created_at: Date.now()` flicker bug. It handles every field that `buildPresencePayload` (src/presence.ts:198-235) can produce. The omitted fields are Discord features for game lobbies, streaming, and invites that are permanently out of scope for a coding-status presence display. The bypass is documented in the module comment (lines 16-18).
- **Verified:** 2026-04-22

### Optional chaining on `client.user` follows library convention
- **Location:** `src/discord-client.ts:146`, `src/discord-client.ts:167`
- **Pattern:** `if (!c.user) return false` (pushPresence), `c.user?.clearActivity(...)` (clearPresence)
- **Why it's correct:** The `@xhayper/discord-rpc` library types `user` as `ClientUser | undefined` and its own README uses `client.user?.setActivity(...)`. The optional chaining is the expected access pattern. NOTE: the *return value semantics* of `pushPresence` when `user` is undefined are a separate concern -- the chaining itself is not the bug.
- **Verified:** 2026-04-20

### `clearPresence` void return is acceptable given library call ordering
- **Location:** `src/discord-client.ts:163-168`
- **Pattern:** `clearPresence()` returns `void` and uses optional chaining `c.user?.clearActivity()` without reporting whether the clear succeeded.
- **Why it's correct:** All call sites in `extension.ts` that invoke `clearPresence` are reachable only after the library's "ready" event fires, at which point `client.user` is already populated. The `@xhayper/discord-rpc` library sets `user` from the DISPATCH/READY message synchronously before emitting "connected", and `login()` without scopes emits "ready" immediately after. There is no production code path where `clearPresence` runs with `isConnected=true` but `user=undefined`. The asymmetry with `pushPresence` (which returns `boolean`) is a style choice, not a bug. If this is ever revisited, it should be treated as a LOW-priority defensive hardening, not a HIGH-severity issue.
- **Verified:** 2026-04-20

## Configuration

### `CUSTOM_WORDS_MAX = 500` silent truncation is intentional defensive ceiling
- **Location:** `src/config.ts:33`
- **Pattern:** `sanitizeCustomWords` silently stops adding entries after 500 with no user diagnostic.
- **Why it's correct:** This is a sanity bound to prevent memory/performance issues from pathological config, not a user-facing feature constraint. VS Code extensions routinely apply internal defensive limits without diagnostics. No user will manually enter 500+ words into a settings.json array. Per-item validation (type, length) is enforced via `package.json` schema.
- **Verified:** 2026-04-20

## Test Infrastructure

### `mockDebugSessionCounter` monotonic increment is intentional
- **Location:** `test/mocks/vscode.ts:66`
- **Pattern:** Counter increments across test cases and is not reset by `__resetEvents()`.
- **Why it's correct:** The counter generates unique session IDs. No test asserts on numeric ID values -- they capture the returned ID by reference. Monotonic increment guarantees uniqueness across tests, which is the desired property. Resetting would risk collisions.
- **Verified:** 2026-04-20

## Naming / Comments

### Smart-state rule numbering differs between README and internal code
- **Location:** `src/state.ts:19-21`, `test/presence.test.ts:126-181`, `README.md:58-67`
- **Pattern:** README uses a simplified 1-4 numbering (debug=1, diff=2, terminal=3, working=4). Internal code and tests use a fuller scheme (rule 2=debug, rule 3=diff, rule 4=terminal, rule 5=undefined-language, rule 6=working) that includes implementation-only steps not relevant to end users.
- **Why it's correct:** The README numbering is a user-facing simplification that intentionally omits internal-only rules (rule 1: showLanguage=false gate, rule 5: undefined language fallback). The `state.ts` comments and `presence.test.ts` test names use the same internal numbering and are consistent with each other. Two numbering schemes (user-facing vs internal) is normal for documented software.
- **Verified:** 2026-04-20
