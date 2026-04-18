# Claude Spinner v1.0 Polish — Design Spec

## Status

- **Date:** 2026-04-18
- **Target version:** `1.0.0` (bump from pre-release `0.1.0`)
- **Supersedes:** settings + Discord app + module structure sections of `2026-04-16-claude-spinner-design.md`
- **Approved:** yes (bundled scope, Discord name = "Claude Spinner", elapsed-time = session-total, 6-file module split)

## Goal

Transform the pre-release `0.1.0` prototype into a polished, bug-free `1.0.0` public release that reflects "this is a VS Code extension" visually and exposes sensible user configuration — shippable to the VS Code Marketplace without requiring an immediate v1.1 patch.

## Context

The extension works functionally but ships with three quality gaps that block a credible first impression:

1. **No user configuration.** Cycle speed is hardcoded at 15s (visibly too slow on first run), and no settings schema is registered. Users can't customize or pause the presence.
2. **Discord application identity is incoherent.** The backing Discord app is currently named "Attention" and the only image is labeled "Claude" — viewers see "Playing Attention" with no visual indication this is tied to VS Code.
3. **Known bugs present.** Back-to-back duplicate words are possible at slow cycle speeds; the reconnect path leaks the prior Discord client instance; no-editor-focus edge cases are unhandled.

We bundle all three into a single v1.0 polish pass rather than shipping `0.1.0` and iterating, because the settings schema and Discord identity are first-impression surfaces — iterating them after first publish looks more amateurish than delaying.

## Scope

### In scope for v1.0

| Track | Content |
|---|---|
| **Settings infrastructure** | `contributes.configuration` schema, config reader, live reload on change |
| **Settings** | `cycleSpeed`, `customWords`, `showLanguage`, `showElapsedTime`, `showWorkspace` |
| **Commands** | `claudeSpinner.toggle` — pause / resume presence |
| **Discord rebrand** | New app name "Claude Spinner", restructured large/small image roles, new CLIENT_ID in code |
| **Bug fixes** | Back-to-back duplicate prevention, reconnect resource cleanup, no-editor-focus behavior |
| **Module split** | Refactor from 2 files → 6 files with clear single-responsibility boundaries |
| **Tests** | Unit tests per module; integration smoke test for activate→presence push |
| **Docs** | CHANGELOG entry, README updated to reflect settings + new Discord identity, version bump to 1.0.0 |

### Deferred to v1.1+

- Idle detection (window focus → slow/pause cycle)
- Language-specific small icons (needs ~20 Discord assets uploaded manually)
- Smart state text ("Debugging in X", "Reviewing in X", "Terminal")
- Workspace-name display in state line (setting is present but behavior ships v1.1)
- Word streaks, rarity tiers, community word packs (Phase 3 experimental)

## Architecture

### Module split

Current structure (2 files, 275 total lines) has `extension.ts` carrying lifecycle, client management, presence payload construction, and language tracking. This concentrates responsibilities that should be isolated for testability.

Target structure:

```
src/
├── extension.ts        Thin entry — activate/deactivate wiring only
├── discord-client.ts   Discord RPC connection, reconnect, cleanup lifecycle
├── presence.ts         Presence payload construction from current state
├── config.ts           Settings reader + change listener
├── commands.ts         Command registrations (toggle)
├── state.ts            Mutable runtime state (paused flag, current language, start timestamp, last word)
└── words.ts            Word list + anti-duplicate picker accepting an arbitrary word pool
```

### Module responsibilities

| Module | Exports | Depends on |
|---|---|---|
| `extension.ts` | `activate`, `deactivate` | all others |
| `discord-client.ts` | `connect()`, `disconnect()`, `isReady()`, `pushPresence(payload)` | — |
| `presence.ts` | `buildPresencePayload(state, config)` → `SetActivity` object or `null` | `words.ts`, types from `discord-client.ts` |
| `config.ts` | `readConfig()` → `Config`, `onConfigChange(cb)` → Disposable | `vscode` API |
| `commands.ts` | `registerCommands(context)` → Disposable[] | `state.ts`, `discord-client.ts`, `presence.ts` |
| `state.ts` | `state: MutableState` singleton + setters (`paused`, `currentLanguage`, `startTimestamp`, `lastWord`) | — |
| `words.ts` | `WORDS` const, `getNextWord(pool: readonly string[], prev?: string)` → string | — |

### Data flow

```
activate()
  → config.readConfig()
  → state.initialize(startTimestamp, initialLanguage)
  → discord-client.connect()
    on 'ready' → cycle interval → presence.buildPresencePayload → discord-client.pushPresence
  → config.onConfigChange → restart interval if cycleSpeed changed, push new payload otherwise
  → commands.registerCommands
  → vscode.window.onDidChangeActiveTextEditor → state.setLanguage → immediate payload push

toggle command
  → state.setPaused(!state.isPaused)
  → if paused: clear interval, push static "Paused" payload (or clear presence)
  → if resumed: push fresh payload, restart interval

deactivate()
  → discord-client.disconnect() (destroys client cleanly)
  → clear all intervals / timeouts
```

## Settings Schema

Registered under `contributes.configuration` in `package.json`:

| Key | Type | Default | Bounds / values | Applied |
|---|---|---|---|---|
| `claudeSpinner.cycleSpeed` | number (seconds) | `10` | min `5`, max `120` | Live: restart interval |
| `claudeSpinner.customWords` | string[] | `[]` | Each item 1-128 chars | Live: next cycle picks from merged pool |
| `claudeSpinner.showLanguage` | boolean | `true` | — | Live: next payload push |
| `claudeSpinner.showElapsedTime` | boolean | `true` | — | Live: next payload push |
| `claudeSpinner.showWorkspace` | boolean | `true` | — | Live: reserved for v1.1 (registered now, no effect in v1.0) |

### Defaults reasoning

- `cycleSpeed: 10` — 15s felt too slow in user testing; 10s is snappy without spam. Discord rate limit is ~1 update / 4s, so `min: 5` is safe.
- `customWords: []` — additive to the built-in 187 words, not replacement. Users can extend the list without losing defaults.
- All display toggles default `true` — first-run shows the richest presence.
- `showWorkspace` registered in v1.0 schema with a no-op implementation so users see a full settings surface and we avoid schema churn on v1.1.

### Live-reload semantics

`vscode.workspace.onDidChangeConfiguration` triggers a re-read. Change response:

- `cycleSpeed` changed → clear existing interval, start new one at new speed, push immediate payload.
- Any display toggle changed → rebuild payload, push immediately.
- `customWords` changed → no side effect until next cycle tick (word pool is read per-tick).

## Discord Application Identity

### Rebrand targets

| Field | Before | After |
|---|---|---|
| Discord app name | "Attention" | **"Claude Spinner"** |
| App Client ID | `1494346699861397636` (in code) | New ID from new Discord app (recommended clean slate) |
| `largeImageKey` | `claude-logo` | `vscode-spinner` (new custom icon) |
| `largeImageText` | `"Claude"` | `"Visual Studio Code"` |
| `smallImageKey` | — (unused) | `claude-logo` (reuse existing asset) |
| `smallImageText` | — | `"Powered by Claude Code"` |

### Why "Claude Spinner" and not "Visual Studio Code"

Discord's detectable-applications list includes Visual Studio Code as an official first-party entry. Naming a user-created application "Visual Studio Code" (or close variants like "VS Code", "Code") triggers Discord's impersonation rules and gets the app rejected or invisible. "Claude Spinner" is distinct, matches the VS Code Marketplace listing name, and VS Code identity comes through visually via the large-image tooltip and icon design rather than the "Playing X" line.

### Presence display — before / after

**Before (member-list sidebar):**
```
Playing Attention
Ruminating...
```

**After (member-list sidebar):**
```
Playing Claude Spinner
Ruminating...
```

**Before (profile popup):**
```
Playing Attention
Ruminating...
Working in TypeScript
03:12 elapsed
[Claude logo, tooltip: Claude]
```

**After (profile popup):**
```
Playing Claude Spinner
Ruminating...
Working in TypeScript
03:12 elapsed
[VS Code icon, tooltip: Visual Studio Code]
  [Claude logo overlay, tooltip: Powered by Claude Code]
```

### Icon design direction (user deliverable)

The large-image icon should communicate "VS Code" visually. Design direction:

- Evoke an editor cursor, bracket, or file icon — **not** a pixel-accurate VS Code logo reproduction
- Use a blue accent that vibes with VS Code without replicating Microsoft's exact hex
- Keep the 512×512 canvas with transparent background
- Small image (overlay) stays as the existing Claude logo

**Trademark note:** directly compositing Microsoft's VS Code logo + Anthropic's Claude logo into a single derivative icon is technically against both companies' brand guidelines. An original icon that *evokes* "code editor with a Claude accent" is legally safer and usually reads just as clearly.

### User actions (manual, Discord Developer Portal)

Recommended path: **create a new Discord application** rather than renaming the existing "Attention" one. Reason: clean slate, no baggage, easy to delete the old app.

1. Go to https://discord.com/developers/applications → **New Application**
2. Name: **`Claude Spinner`**
3. General Information → **Application Icon** → upload 512×512 PNG (new custom icon)
4. Copy the **Application ID** — this becomes the new `CLIENT_ID` constant
5. Rich Presence → **Art Assets** → Add Image(s):
   - Key: `vscode-spinner` → upload the large-image icon
   - Key: `claude-logo` → upload or reuse existing Claude logo (becomes the small-image overlay)
6. Share the new Application ID with the implementation flow

Delete the old "Attention" app from the portal after the new one is confirmed working.

## Commands

### `claudeSpinner.toggle`

Registered under `contributes.commands` in package.json. No default keybinding — users bind if they want.

- **When active (resumed, default):** behaves as before
- **When paused:** clears the cycle interval, pushes a final `buildPresencePayload(..., { paused: true })` which renders as `details: "Paused"` with other fields intact (language, elapsed time, icons)
- Toggle flips the `state.isPaused` flag and re-triggers the appropriate path

## Bug Fixes

### Fix 1 — Back-to-back duplicate words

**Problem:** `getRandomWord` uses uniform random sampling, so identical consecutive picks are possible (probability 1/187 ≈ 0.53% per transition). At 10s cycle speed, a real user hits this ~3× per hour of coding. It reads as "the spinner is frozen" even when it isn't.

**Fix:** Replace `getRandomWord()` with `getNextWord(pool: readonly string[], prev?: string)` that re-rolls when the pick equals `prev`. Loop bound is bounded — re-roll probability is ~0.53% per iteration (or higher if `pool` is small after custom-word filtering), so the expected number of re-rolls is ~0.005 on the default pool. In practice loops once 99.47% of the time. The `pool` parameter is the concatenation of built-in `WORDS` + `config.customWords`, computed per-tick so config changes take effect on the next cycle. Caller passes `state.lastWord` as `prev`; after the pick, caller writes back to `state.lastWord`.

**Edge case:** if `pool.length === 1`, the anti-duplicate re-roll would infinite-loop. Short-circuit: if `pool.length <= 1`, return `pool[0]` without the re-roll check.

**Test:** Call `getNextWord(WORDS, prev)` 10,000 times in a loop, assert no consecutive match. Separate test for `pool.length === 1` returns that single word. Separate test for merging built-in + custom words.

### Fix 2 — Reconnect resource leak

**Problem:** `connectToDiscord()` overwrites `client = new Client(...)` without destroying the prior instance. If reconnection fires mid-flight (rapid Discord restart, unstable IPC), the old client's IPC socket and event listeners never get cleaned up. Not crash-level but real.

**Fix:** At the top of `connect()` in `discord-client.ts`, if a client instance exists, call `client.destroy().catch(() => {})` and null it before creating the new one. Similarly in the `catch` block of the login attempt.

**Test:** Vitest mock for `Client` with a spy on `destroy`. Call `connect()` twice in sequence, assert `destroy` called once on the first client.

### Fix 3 — No-editor-focus edge case

**Problem:** When focus is on the terminal, output panel, debug console, or no open editors, `currentLanguage` is `undefined` and the `state` line silently disappears from the presence payload. Not broken per se, but surprising when the presence appears to "half-update."

**Fix:** When `currentLanguage` is undefined, omit the state field cleanly (Discord renders missing fields well — no empty line artifact). Document this behavior so it's not mistaken for a bug later. Future v1.1 work may add an "Exploring" fallback, but v1.0 keeps behavior clean and minimal.

**Test:** Pass `undefined` language to `buildPresencePayload`, assert returned object has no `state` key (not `state: undefined`).

### Elapsed-time semantics (documentation, not a fix)

`startTimestamp` is captured once on `activate()` and survives Discord reconnects. This is the intended behavior — matches Discord's convention across apps and games — and is documented here so future work doesn't "fix" it.

## Testing Strategy

### Unit tests (vitest)

- `words.test.ts` — list integrity + anti-duplicate behavior of `getNextWord`
- `config.test.ts` — default values, bounds enforcement, change-notification plumbing (mock `vscode.workspace.getConfiguration`)
- `presence.test.ts` — payload structure for each toggle combination (showLanguage on/off, paused on/off, etc.), missing-language behavior
- `discord-client.test.ts` — mock `Client`, assert cleanup on reconnect, assert interval clears on disconnect

### Integration smoke test

- Launch VS Code extension host with a mock Discord IPC server
- Assert `activate()` triggers connection and pushes at least one presence within 2s
- Assert `deactivate()` cleanly tears down without throwing

Manual verification before shipping: install the packaged `.vsix` locally via `code --install-extension`, open a real Discord client, verify presence appears with correct rebranded name/icons.

## Deployment sequencing

### User actions (blocking)

1. Create new Discord Application named "Claude Spinner" in the Developer Portal
2. Upload new custom icon as the application icon (512×512 PNG)
3. Upload Rich Presence art assets (`vscode-spinner` large, `claude-logo` small)
4. Share the new Application ID with the implementation flow

These can happen in parallel with code implementation — the Client ID only needs to be swapped in near the end.

### Code actions (in implementation plan)

1. Module split refactor (no behavior change — pure restructure)
2. Settings schema + config reader + change listener
3. Commands module + toggle implementation
4. Presence module (uses config flags, supports paused state)
5. Anti-duplicate word picker
6. Reconnect cleanup fix
7. Swap CLIENT_ID + update presence payload keys/texts (blocked on step 4 of user actions)
8. CHANGELOG + README + version bump to 1.0.0
9. Build + test + `vsce package` + local .vsix install verification
10. `vsce publish`

## Non-goals

Explicit non-goals to prevent scope creep during implementation:

- **Idle detection.** Window-focus-based cycling changes — deferred to v1.1.
- **Language-specific small icons.** Requires 15-20 Discord assets uploaded manually and a mapping table — deferred.
- **Smart state text** (debugging, reviewing, terminal) — deferred.
- **Workspace name in state line** — setting registered now, behavior ships v1.1.
- **Status bar item** for paused/active indicator — deferred; the setting + command are enough.
- **Telemetry.** None, ever.
- **Network calls beyond Discord IPC.** None.

## Risks & open items

| Risk | Mitigation |
|---|---|
| Discord rejects "Claude Spinner" as similar to detectable apps | Very unlikely (it's clearly distinct), but fallback name could be "Claude Code Spinner" or "Claude's Spinner" |
| Icon design drags the project | Acceptable minimum is a simple "cursor-in-a-square" shape in VS Code blue — doesn't need to be art |
| Trademark complaint from Microsoft or Anthropic | Original icon (not logo composite) + descriptive text ("Visual Studio Code" as tooltip) keeps the risk low. If a complaint comes, swap icon + app name — the code doesn't care |
| Discord rate-limit violation on cycleSpeed=5 | 5s is above the documented ~4s minimum; add a runtime guard that clamps invalid settings values |
| User sets `customWords` to empty strings or `null` | Config reader filters invalid entries silently; no crash |

## Success criteria

v1.0 is ready to publish when:

- [ ] All 5 settings keys work and live-reload
- [ ] `claudeSpinner.toggle` pauses and resumes cleanly
- [ ] Discord presence shows "Playing Claude Spinner" with the new large icon + Claude small overlay
- [ ] Same word never appears twice in a row across 10,000 simulated cycles
- [ ] Reconnect cycles don't leak client instances (verified via mock)
- [ ] All unit tests pass; integration smoke test passes
- [ ] `.vsix` packages cleanly and installs locally
- [ ] README reflects new Discord identity + settings
- [ ] CHANGELOG has a complete `1.0.0` entry
- [ ] README has the approved screenshot/GIF uncommented
