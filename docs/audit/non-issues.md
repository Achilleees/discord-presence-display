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

## Library Patterns

### Optional chaining on `client.user` follows library convention
- **Location:** `src/discord-client.ts:97`, `src/discord-client.ts:107`
- **Pattern:** `c.user?.setActivity(...)`, `c.user?.clearActivity(...)`
- **Why it's correct:** The `@xhayper/discord-rpc` library types `user` as `ClientUser | undefined` and its own README uses `client.user?.setActivity(...)`. The optional chaining is the expected access pattern. NOTE: the *return value semantics* of `pushPresence` when `user` is undefined are a separate concern (see finding 3.1 in audit-2026-04-20.md) -- the chaining itself is not the bug.
- **Verified:** 2026-04-20
