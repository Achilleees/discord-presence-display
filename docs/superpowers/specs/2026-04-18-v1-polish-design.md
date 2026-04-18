# Claude Spinner v1.0 Polish — Design Spec

## Status

- **Date:** 2026-04-18 (revised)
- **Target version:** `1.0.0` (bump from pre-release `0.1.0`); no interim releases
- **Supersedes:** settings + Discord app + module structure sections of `2026-04-16-claude-spinner-design.md`
- **Approved:** yes, with naming and icon design marked as **iterate-in-plan** (see §9)

## Goal

Transform the pre-release `0.1.0` prototype into a polished, feature-complete, bug-free `1.0.0` public release that makes sense to a Discord viewer who has never heard of the extension — rich configuration for power users, sensible defaults for everyone else, and a visual identity that communicates "this person is coding in VS Code" at a glance.

## Context

The extension works functionally but ships with three quality gaps that would make first impressions amateurish:

1. **No user configuration.** All behavior is hardcoded. Users can't tune cycle speed, hide fields, pause, or extend the word list.
2. **Incoherent Discord identity.** The backing Discord application is named "Attention" and the only image is labeled "Claude" — viewers see "Playing Attention" beside an unexplained logo.
3. **Known bugs.** Back-to-back duplicate words, reconnect resource leak, silent state-line disappearance when focus isn't on an editor.

We bundle everything reasonable into v1.0 — no "deferred to v1.1" shelving — because each of these surfaces is first-impression material that's more awkward to fix post-launch than to get right before publish.

---

## 1. Scope

### 1.1 In v1.0

All user-facing functionality ships in this release:

| Subsystem | Content |
|---|---|
| Settings infrastructure | `contributes.configuration` schema, reader, live-reload on change |
| Settings (13 keys) | See §5 |
| Commands | `claudeSpinner.toggle` (pause/resume) |
| Idle detection | Window-focus → slow/pause/clear cycle, configurable |
| Smart state | Detects debug, diff-editor, terminal focus; overrides default "Working in X" line |
| Language icons | Small-image shows language icon for top ~25 languages; Claude logo fallback |
| Workspace name | Optional append to state line (off by default for privacy) |
| Word rarity weighting | Opt-in tiered random (common/uncommon/rare) |
| Time-based word pools | Opt-in bias toward "warming up / in zone / deep session" word groupings |
| Anti-duplicate picker | Never repeat any of the last 3 words |
| Discord application rebrand | New app at Developer Portal, new icon, new Client ID, restructured image slots |
| Extension rebrand | New marketplace display name + `name` package identifier |
| Bug fixes | Duplicates, reconnect leak, no-editor-focus behavior |
| Module split | Refactor from 2 files → 7 files with clear boundaries |
| Tests | Unit per module; integration smoke for activate→push |
| Docs | CHANGELOG, README updated, version bump |
| Gitignore | `docs/superpowers/plans/` becomes local-only |

### 1.2 Non-goals — permanent, not deferred

Things Claude Spinner will **never** do, by design:

- **No telemetry.** Ever.
- **No network calls** beyond the local Discord IPC socket.
- **No external integrations** (GitHub, Slack, Linear, etc.).
- **No AI assistant features.** The extension is about *displaying* coding activity, not augmenting it.
- **No multi-user or team features.** Per-user, per-VS-Code-instance only.
- **No community word packs loaded from remote URLs.** User-provided custom words via settings: yes. Fetching shared packs over the network: no (see "no network calls").

### 1.3 Intentionally skipped from v1.0

Unlike non-goals above, these are features we *might* revisit but chose not to include now — they serve a smaller slice of users than the scope above:

- **User-loaded word pack JSON files** (local files, not network). Covered partially by `customWords` setting. Full pack loading adds file I/O surface for niche benefit.
- **Config profiles.** VS Code's built-in Profiles feature already lets users switch extension settings per workspace.

---

## 2. Architecture

### 2.1 Module split (7 files)

Current structure concentrates 4+ responsibilities in `extension.ts`. Target:

```
src/
├── extension.ts        Thin entry — activate/deactivate wiring only
├── discord-client.ts   Discord RPC connection, reconnect, lifecycle cleanup
├── presence.ts         Presence payload construction from state + config
├── config.ts           Settings reader + change-event listener
├── commands.ts         Command registrations (toggle)
├── state.ts            Mutable runtime state (paused, language, timestamps, recent-word ring buffer, idle status, debug session, focused element)
└── words.ts            Word list + anti-duplicate picker + rarity tiers + time-based pools
```

### 2.2 Module responsibilities

| Module | Exports | Depends on |
|---|---|---|
| `extension.ts` | `activate`, `deactivate` | all others |
| `discord-client.ts` | `connect()`, `disconnect()`, `isReady()`, `pushPresence(payload)`, `clearPresence()` | — |
| `presence.ts` | `buildPresencePayload(state, config)` → `SetActivity \| null` | `words.ts`, shared types |
| `config.ts` | `readConfig()` → `Config`, `onConfigChange(cb)` → Disposable | `vscode` API |
| `commands.ts` | `registerCommands(context, deps)` → Disposable[] | `state.ts`, `discord-client.ts`, `presence.ts` |
| `state.ts` | `state: MutableState` singleton + setters: `paused`, `currentLanguage`, `startTimestamp`, `recentWords` (last 3 ring buffer), `isIdle`, `debugActive`, `focusContext` | — |
| `words.ts` | `WORDS` const, `getNextWord(pool, recentWords, options)` → string, `buildPool(config, state)` → readonly string[] | — |

### 2.3 Data flow

```
activate()
  → config.readConfig()
  → state.initialize(startTimestamp, initialLanguage)
  → discord-client.connect()
    on 'ready' → cycle interval → presence.buildPresencePayload → discord-client.pushPresence
  → config.onConfigChange → restart interval if cycleSpeed changed; push new payload otherwise
  → commands.registerCommands
  → vscode.window.onDidChangeActiveTextEditor → state.setLanguage + update focus context → push
  → vscode.window.onDidChangeWindowState → state.isIdle + idle-behavior handler
  → vscode.debug.onDidStartDebugSession / onDidTerminateDebugSession → state.debugActive → push
  → vscode.window.onDidChangeActiveTerminal → state.focusContext = 'terminal' → push

toggle command
  → state.paused = !state.paused
  → if paused: clear interval, discord-client.clearPresence()
  → if resumed: push fresh, restart interval

deactivate()
  → discord-client.disconnect() (destroys client cleanly)
  → clear all intervals / timeouts
  → dispose all listeners
```

---

## 3. Discord presence display — full field map

### 3.1 Field-by-field breakdown

Every field Discord renders, with its source, config toggle, and default.

| Field | What Discord does with it | Content source | Config toggle | Default |
|---|---|---|---|---|
| Application name | "Playing X" prefix + standalone mentions | Discord Developer Portal (not code) | — | **§9a TBD** |
| `type` | Activity category (Playing/Streaming/etc.) | Constant `0` (Playing) | — | `0` |
| `statusDisplayType` | What shows in the bold member-list label | Constant `2` (details) | — | `2` |
| `details` (line 1) | Big bold line in popup, member-list label | Current cycling word + `"..."` | `cycleWords` | on — word rotates |
| `state` (line 2) | Smaller line under details | `"Working in {language}"` + optional workspace suffix, or smart variant | `showLanguage`, `showWorkspace`, `smartState` | language on, workspace off, smart on |
| `timestamps.start` | "X:XX elapsed" line | Activation timestamp | `showElapsedTime` | on |
| `assets.large_image` (key) | Big icon in popup | Constant key, uploaded to Discord Portal | — | `vscode-spinner` |
| `assets.large_text` | Tooltip on large image hover | Constant string | — | `"Visual Studio Code"` |
| `assets.small_image` (key) | Small overlay in corner of large image | Language icon key if found, else Claude logo | `showLanguageIcon` | on — language icon with fallback |
| `assets.small_text` | Tooltip on small image hover | Display name of language, or `"Powered by Claude Code"` | — | language name if icon shown |

### 3.2 Member list (compact, always visible)

What people see without clicking anyone:

```
Playing {ApplicationName}
{currentWord}...
```

### 3.3 Profile popup (expanded on click)

```
Playing {ApplicationName}
{currentWord}...
{state line — see 3.4}
{elapsed time}
[large image]   [small image overlay]
```

### 3.4 State line composition (priority order)

1. `paused === true` → no payload rendered at all (presence cleared via §7; this entire field map is inapplicable)
2. `smartState === true && debugActive === true` → `"Debugging in {language}"`
3. `smartState === true && focusContext === 'diff'` → `"Reviewing in {language}"`
4. `smartState === true && focusContext === 'terminal'` → `"In the terminal"`
5. `currentLanguage === undefined` → state line omitted (clean — no "Exploring" fallback in v1.0)
6. Default → `"Working in {language}"`
7. After steps 2/3/4/6 complete: if `showWorkspace === true && workspaceName !== undefined` → append `" — {workspaceName}"`. Step 5 (omitted) has nothing to append to.

If `showLanguage === false`, the entire state line is suppressed.

### 3.5 Idle mode

When `idleBehavior` triggers (see §5), presence transitions:

- `"slow"` (default): cycle interval slows from `cycleSpeed` to `cycleSpeed × 4` (max 120s clamped)
- `"pause"`: clear interval, keep last presence visible
- `"clear"`: clear interval + clear presence entirely
- `"none"`: no behavior change

On focus regain: push fresh presence immediately, restore normal cycle.

---

## 4. Settings schema (13 keys)

Registered under `contributes.configuration` in `package.json`. All settings live-reload unless noted.

| Key | Type | Default | Bounds | Description (user-facing) |
|---|---|---|---|---|
| `claudeSpinner.enabled` | boolean | `true` | — | Master switch; when false, disconnects from Discord entirely |
| `claudeSpinner.cycleSpeed` | number (seconds) | `15` | 5–120 | How often the rotating word changes. Minimum 5s respects Discord's rate limit |
| `claudeSpinner.cycleWords` | boolean | `true` | — | If false, picks one word at activation and doesn't rotate |
| `claudeSpinner.customWords` | string[] | `[]` | each 1–128 chars | Extra words added to the built-in list |
| `claudeSpinner.showLanguage` | boolean | `true` | — | Show "Working in X" line |
| `claudeSpinner.showWorkspace` | boolean | **`false`** | — | **Off by default for privacy.** Appends workspace folder name to the state line |
| `claudeSpinner.showElapsedTime` | boolean | `true` | — | Show session elapsed time |
| `claudeSpinner.showLanguageIcon` | boolean | `true` | — | Use language-specific icon as small image; falls back to Claude logo if no icon exists for the language |
| `claudeSpinner.smartState` | boolean | `true` | — | Detects debugging, diff review, and terminal focus to vary the state line |
| `claudeSpinner.idleBehavior` | enum | `"slow"` | `"slow"` / `"pause"` / `"clear"` / `"none"` | What happens when VS Code loses focus for `idleThresholdMinutes` |
| `claudeSpinner.idleThresholdMinutes` | number | `5` | 1–60 | Minutes of inactivity before idle mode engages |
| `claudeSpinner.wordRarity` | boolean | `false` | — | Opt-in weighted random: common words more likely, rare words rarer |
| `claudeSpinner.timeBasedPools` | boolean | `false` | — | Opt-in bias toward warming-up / in-zone / deep-session word groupings based on session length |

### 4.1 Live-reload semantics

`vscode.workspace.onDidChangeConfiguration` re-reads:

- `enabled` off → `discord-client.disconnect()`; on → `connect()`
- `cycleSpeed` → clear + restart interval at new speed + push immediate payload
- `idleThresholdMinutes` → reset idle timer with new threshold
- Any display toggle (`showLanguage`, `showWorkspace`, `showElapsedTime`, `showLanguageIcon`, `smartState`, `cycleWords`) → rebuild and push payload
- `customWords`, `wordRarity`, `timeBasedPools` → no immediate push; next cycle uses new settings

---

## 5. Word selection

### 5.1 Anti-duplicate picker

`getNextWord(pool, recentWords, options)` returns a word from `pool` not in `recentWords`. `recentWords` is a ring buffer of the last 3 emitted words stored in `state`.

Adaptive sizing: effective exclusion window = `min(3, floor(pool.length / 2))`. Prevents infinite loops on tiny pools (e.g., if user sets `customWords` + filters to 2 total, window shrinks to 1).

Short-circuit: if `pool.length === 1`, return `pool[0]` without exclusion check.

### 5.2 Rarity tiers (`wordRarity: true`)

Built-in word classification lives in `words.ts` as a map `word → tier`:

- **Common** (~70% of picks): straightforward action words — `Thinking`, `Working`, `Coding`, `Building`, etc.
- **Uncommon** (~25% of picks): colorful action words — `Beboppin'`, `Moonwalking`, `Spelunking`, etc.
- **Rare** (~5% of picks): absolute bangers — `Flibbertigibbeting`, `Prestidigitating`, `Whatchamacalliting`, etc.

Default (off): uniform random across all words. Custom words classified as common.

### 5.3 Time-based pools (`timeBasedPools: true`)

Session elapsed time determines bias:

- **0–30 min (warming up)**: higher weight for `Brewing`, `Simmering`, `Percolating`, `Incubating`, `Germinating`, etc.
- **30–120 min (in the zone)**: higher weight for `Computing`, `Synthesizing`, `Orchestrating`, `Architecting`, etc.
- **120+ min (deep session)**: higher weight for `Hyperspacing`, `Transmuting`, `Prestidigitating`, etc.

Biased ≠ exclusive; out-of-pool words still appear, just less often. Built-in classification; custom words get "wildcard" tier (always eligible).

Rarity and time-based pools compose: if both are on, rarity tier applies within the biased pool.

---

## 6. Discord application rebrand

### 6.1 Rebrand targets

| Field | Before | After |
|---|---|---|
| Discord app name | `Attention` | **§9a TBD-in-plan** (provisional `Coding`) |
| Client ID | `1494346699861397636` in code | New ID from fresh Discord app |
| `largeImageKey` | `claude-logo` | `vscode-spinner` (new custom icon — see §8) |
| `largeImageText` | `"Claude"` | `"Visual Studio Code"` |
| `smallImageKey` | unused | `lang-{languageId}` (mapped) or `claude-logo` (fallback) |
| `smallImageText` | unused | `"{Language}"` or `"Powered by Claude Code"` |

### 6.2 Language icons inventory (~25)

Small-image keys uploaded to Discord Developer Portal under Rich Presence → Art Assets:

**Tier 1 (top 10):** `lang-typescript`, `lang-javascript`, `lang-python`, `lang-rust`, `lang-go`, `lang-java`, `lang-cpp`, `lang-csharp`, `lang-html`, `lang-css`

**Tier 2 (next 15):** `lang-ruby`, `lang-php`, `lang-swift`, `lang-kotlin`, `lang-dart`, `lang-lua`, `lang-elixir`, `lang-haskell`, `lang-scala`, `lang-shell`, `lang-sql`, `lang-json`, `lang-yaml`, `lang-markdown`, `lang-c`

Mapping: VS Code's `languageId` (lowercase, hyphen-separated) → asset key with `lang-` prefix. Exceptions noted in a translation map in `presence.ts` (e.g., `javascriptreact` → `lang-javascript`).

Fallback chain: `lang-{id}` → `claude-logo`. Never blank.

### 6.3 User actions (Discord Developer Portal)

1. Create new Discord Application at https://discord.com/developers/applications (fresh, not rename)
2. Name it per **§9a** decision
3. Upload 512×512 application icon (per **§8** decision)
4. Upload Rich Presence art assets:
   - `vscode-spinner` (large image per §8 design)
   - `claude-logo` (overlay / fallback)
   - All 25 `lang-*` icons (language overlays)
5. Share the new Application ID → implementation swaps `CLIENT_ID` constant
6. Delete the old "Attention" app

---

## 7. Commands

### 7.1 `claudeSpinner.toggle`

Registered in `contributes.commands`; no default keybinding.

- **Active (default):** normal presence cycling
- **Paused:** clears the cycle interval, calls `discord-client.clearPresence()` — presence disappears from Discord entirely, matching the user intent of "hide my status right now"
- **Resume:** pushes fresh presence, restarts interval

On deactivate, paused state does not persist across VS Code restarts (clean slate each session).

---

## 8. Icon design — first-class deliverable

### 8.1 Why this matters

The icon appears at three sizes:

- **16×16** — Discord member list (tiny)
- **128×128** — marketplace publisher logo slot + Discord activity card
- **512×512** — marketplace listing header + Discord Developer Portal app icon

Each size has different legibility demands. The marketplace listing is where acquisition happens; Discord is where retention happens. The icon carries both.

### 8.2 Design brief

**Primary identity signal:** the icon should make a Discord viewer understand "this is someone coding" in one glance, without reading any text.

**Must:**
- Work at 16×16 (simple silhouette, high-contrast edges)
- Work on both light and dark Discord themes
- Look distinctive at 512×512 (not generic)
- Avoid Microsoft VS Code logo reproduction (trademark)
- Avoid Anthropic Claude logo reproduction (trademark)
- Evoke "code editor" OR "rotating word" visually (user pick)
- Color palette compatible with VS Code's general "blue editor" vibe without copying the specific Microsoft shade

**Nice-to-have:**
- Subtle motion/rotation cue (suggests the cycling-word behavior)
- Accent color that nods to Claude's palette (orange-adjacent)

### 8.3 Iteration process (plan step — §9c)

Not a pre-spec decision. During implementation:

1. I generate 3-5 direction boards (text description + ASCII mock + Unicode glyph composition)
2. You pick a direction (or redirect)
3. I refine chosen direction with 2-3 variants
4. You pick a variant or commission a designer with the brief
5. Final PNG produced at 512×512, 128×128, 16×16 — uploaded to Discord Portal + committed to repo

---

## 9. Iterate-in-plan items

Three naming/design decisions are deliberately **not** resolved in this spec. They get dedicated plan tasks with explicit user-review loops.

### 9a. Discord application name

- **Provisional placeholder:** `Coding`
- **Constraints:** must work as "Playing X" AND standalone "X"; dev-related; no trademark adjacency
- **Iteration task:** brainstorm 5-8 candidates, pick with you, set at Discord Developer Portal
- **Blocking:** icon brief (§8), presence payload wiring (§6)

### 9b. Extension marketplace name + package identifier

- **Provisional placeholder:** `Coding Status for Discord` (displayName) / `coding-status-for-discord` (package `name`)
- **Constraints:** marketplace SEO, doesn't start with "Claude" (Anthropic guidelines), describes what it *does*
- **Iteration task:** brainstorm 3-5 alternatives, pick with you, update package.json
- **Blocking:** CHANGELOG entry, README title, marketplace publish step

### 9c. Icon design

- **Provisional placeholder:** current `assets/icon.png` stays until replaced
- **Iteration task:** direction boards → pick → variant iteration → final PNG
- **Blocking:** Discord Dev Portal upload, marketplace publish step

All three can run in parallel with unrelated implementation work.

---

## 10. Bug fixes

### 10.1 Back-to-back duplicates (expanded to last-N)

**Problem:** uniform random can pick identical consecutive words. At slow cycle speeds this reads as frozen.

**Fix:** `getNextWord(pool, recentWords, options)` re-rolls if pick is in `recentWords`. Ring buffer of last 3 kept in `state`. Adaptive window shrinks on tiny pools.

**Test:** 10,000 calls, assert no pick is in `recentWords` at time of emission; separate test for tiny pool (1 word) doesn't loop.

### 10.2 Reconnect resource leak

**Problem:** `connectToDiscord()` overwrites `client` without destroying the prior instance.

**Fix:** At top of `connect()`, if client exists, `await client.destroy().catch(() => {})` and null it before creating new.

**Test:** Vitest mock for `Client` with spy on `destroy`. Call `connect()` twice; assert destroy called once on first client.

### 10.3 No-editor-focus behavior

**Problem:** When focus isn't on an editor (terminal, output panel, no open tabs), state line silently disappears.

**Fix:** Specified in §3.4 — state line omitted cleanly when language is undefined (no ghost behavior). Smart state (§3.4 steps 2-4) handles terminal/debug/diff cases explicitly.

**Test:** Pass `undefined` language, assert returned payload has no `state` key. Pass with terminal focus, assert state line reflects it.

### 10.4 Elapsed-time semantics (docs only)

`startTimestamp` captured once on `activate()`, survives Discord reconnects. Matches Discord convention; documented here so future changes don't "fix" it.

---

## 11. Testing strategy

### 11.1 Unit tests (vitest)

- `words.test.ts` — list integrity, `getNextWord` anti-duplicate (ring buffer), tiny-pool short-circuit, rarity weighting distribution, time-based pool bias, custom words merging
- `config.test.ts` — default values, bounds clamping, change-notification plumbing (mock `vscode.workspace.getConfiguration`)
- `presence.test.ts` — every field for every toggle combination, smart-state priority ordering, paused behavior (omit state/clear presence), language-icon fallback chain, workspace-name append behavior
- `discord-client.test.ts` — mock `Client`, assert cleanup on reconnect, interval clears on disconnect, enable/disable switch

### 11.2 Integration smoke

Launch VS Code extension host + mock Discord IPC:

- `activate()` connects and pushes at least one presence within 2s
- `deactivate()` tears down without throwing
- Toggle command flips state correctly

Manual verification: install packaged `.vsix` via `code --install-extension`, open real Discord, verify rebranded presence.

---

## 12. Deployment sequencing

### 12.1 User actions (unblock-in-parallel)

- Create new Discord Application per §6.3 (blocked on §9a naming)
- Upload icon per §8 (blocked on §9c design iteration)
- Upload 25 language icons (can be outsourced to any open-source icon set, Devicon, Simple Icons, etc.)
- Approve §9a / §9b / §9c during plan execution

### 12.2 Code actions (plan order)

1. Gitignore `docs/superpowers/plans/` + untrack existing plan
2. Module split refactor (no behavior change — pure restructure)
3. Settings schema + config reader + live-reload
4. `state.ts` expansion (paused, recent-words, idle, focus context)
5. Anti-duplicate picker + rarity tiers + time-based pools
6. Idle detection + smart state listeners
7. Language icon mapping + small-image fallback
8. `toggle` command + pause/resume presence handling
9. Reconnect cleanup bug fix
10. Discord payload restructure with language-icon logic
11. §9a naming iteration → Discord app created → Client ID swapped
12. §9b extension rename → package.json updated
13. §9c icon iteration → PNG produced → asset uploaded
14. CHANGELOG + README updates
15. Version bump to 1.0.0
16. Build + test + `vsce package` + local install verification
17. `vsce publish`

Steps 11-13 are the "iterate-in-plan" checkpoints where user review is required.

---

## 13. Risks & open items

| Risk | Mitigation |
|---|---|
| Discord rejects provisional name "Coding" as a reserved / impersonation term | Low risk, but §9a produces 5-8 candidates to fall back on |
| Icon design drags timeline | Minimum viable: a single-glyph geometric shape on solid color is acceptable; doesn't need to be art |
| Language-icon uploads tedious (25 manual uploads) | Recommend using Devicon or Simple Icons PNGs at 128×128 — pre-built, open license |
| Trademark complaint from Microsoft or Anthropic | Design brief explicitly avoids logo reproduction; name doesn't use "VS Code" or "Claude X"; "Powered by Claude Code" attribution is within Anthropic's published guidelines |
| User sets `customWords` to empty strings or oversized entries | Config reader filters: non-string, empty, >128 chars → silently dropped |
| `idleThresholdMinutes` set to 0 | Clamped to minimum 1 at read time |
| VS Code Profiles feature conflicts with our settings | Our settings are workspace-scoped by default; Profiles handles switching per-workspace already |

---

## 14. Success criteria

v1.0 is ready to publish when:

- [ ] All 13 settings work and live-reload correctly
- [ ] `claudeSpinner.toggle` pauses (clears presence) and resumes cleanly
- [ ] Idle detection transitions correctly for all 4 behaviors
- [ ] Smart state correctly detects debug, terminal, and diff-editor contexts
- [ ] Language icons appear for all 25 tier-1+tier-2 languages; Claude logo fallback works for others
- [ ] Workspace name appends only when `showWorkspace === true`
- [ ] Rarity weighting distribution matches spec when enabled
- [ ] Time-based pool bias matches spec when enabled
- [ ] Anti-duplicate: same word never in last-3 across 10,000 simulated picks; tiny-pool edge handled
- [ ] Reconnect cycles don't leak client instances (mock-verified)
- [ ] Discord presence shows the approved §9a app name with new large icon + language-icon small overlay
- [ ] Extension renamed to §9b decision in package.json + README + CHANGELOG
- [ ] §9c final icon committed and uploaded
- [ ] All unit tests pass; integration smoke passes
- [ ] `.vsix` packages cleanly and installs locally
- [ ] README reflects new identity + all settings documented
- [ ] CHANGELOG has complete 1.0.0 entry
- [ ] Screenshot/GIF captured with final settings and committed to README
- [ ] `docs/superpowers/plans/` is gitignored and no plan files tracked
