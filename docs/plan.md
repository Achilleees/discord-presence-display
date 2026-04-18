# Claude Spinner v1.0 Plan

The shape of the v1.0 release: design decisions, scope, and build order. Single source of truth — replaces the prior `docs/superpowers/` tree.

## Goal

Ship `1.0.0` from the pre-release `0.1.0` prototype. Rich configuration for power users, sensible defaults for everyone else, and a Discord identity that reads "this person is coding in VS Code" at a glance — even to a viewer who has never heard of the extension.

## Non-goals (permanent, by design)

- No telemetry. Ever.
- No network calls beyond the local Discord IPC socket.
- No external integrations (GitHub, Slack, etc.).
- No AI-assistant features — the extension *displays* coding activity, doesn't augment it.
- No multi-user / team features.
- No remote word packs (custom words via settings: yes; fetching shared packs over the network: no).

## Intentionally skipped (might revisit, not rejected)

- User-loaded word pack JSON files. Partially covered by the `customWords` setting; full pack loading adds I/O surface for niche benefit.
- Config profiles. VS Code's built-in Profiles handles per-workspace settings already.

---

## Architecture — 7-file split

Current `extension.ts` concentrates 4+ responsibilities. Target layout:

```
src/
├── extension.ts        Thin entry — activate/deactivate wiring only
├── discord-client.ts   Discord RPC connection, reconnect, lifecycle cleanup
├── presence.ts         Presence payload construction from state + config
├── config.ts           Settings reader + change-event listener
├── commands.ts         Command registrations (toggle)
├── state.ts            Mutable runtime state
└── words.ts            Word list + picker + rarity tiers + time-based pools
```

**Module contracts**

| Module | Exports | Depends on |
|---|---|---|
| `extension.ts` | `activate`, `deactivate` | all others |
| `discord-client.ts` | `connect`, `disconnect`, `isReady`, `pushPresence`, `clearPresence` | — |
| `presence.ts` | `buildPresencePayload(state, config)` → `SetActivity \| null` | `words.ts`, types |
| `config.ts` | `readConfig()` → `Config`, `onConfigChange(cb)` → `Disposable` | `vscode` |
| `commands.ts` | `registerCommands(context, deps)` → `Disposable[]` | `state`, `discord-client`, `presence` |
| `state.ts` | `createState(...)` factory + `State` type — `paused`, `currentLanguage`, `startTimestamp`, `recentWords` (ring buffer of last 3), `isIdle`, `debugActive`, `focusContext`, `workspaceName`, `pinnedWord`. Instance owned by `extension.ts` | — |
| `words.ts` | `WORDS`, `getNextWord(pool, recent, opts)`, `buildPool(config, state)` | — |

**Activate flow**

```
activate()
  config.readConfig()
  state.initialize(startTimestamp, initialLanguage)
  discord-client.connect()
    on 'ready' → cycle interval → presence.buildPresencePayload → discord-client.pushPresence
  config.onConfigChange → restart interval if cycleSpeed changed; else push new payload
  commands.registerCommands
  vscode.window.onDidChangeActiveTextEditor → state.setLanguage + focus context → push
  vscode.window.onDidChangeWindowState → state.isIdle + idle-behavior handler
  vscode.debug.onDidStartDebugSession / onDidTerminateDebugSession → state.debugActive → push
  vscode.window.onDidChangeActiveTerminal → state.focusContext = 'terminal' → push

toggle command
  state.paused = !state.paused
  paused: clear interval, discord-client.clearPresence()
  resumed: push fresh, restart interval

deactivate()
  discord-client.disconnect()
  clear all intervals / timeouts
  dispose all listeners
```

---

## Settings (13 keys)

Registered under `contributes.configuration` in `package.json`. All live-reload unless noted.

| Key | Type | Default | Bounds | What it does |
|---|---|---|---|---|
| `claudeSpinner.enabled` | boolean | `true` | — | Master switch; false → disconnect from Discord |
| `claudeSpinner.cycleSpeed` | number (s) | `15` | 5–120 | Word rotation interval. Min 5s respects Discord's rate limit |
| `claudeSpinner.cycleWords` | boolean | `true` | — | If false, picks one word at activation, no rotation |
| `claudeSpinner.customWords` | string[] | `[]` | each 1–128 chars | Extra words appended to built-in list |
| `claudeSpinner.showLanguage` | boolean | `true` | — | Show "Working in X" line |
| `claudeSpinner.showWorkspace` | boolean | **`false`** | — | Off by default for privacy. Appends workspace folder name to state line |
| `claudeSpinner.showElapsedTime` | boolean | `true` | — | Show session elapsed time |
| `claudeSpinner.showLanguageIcon` | boolean | `true` | — | Use language-specific icon as small image; falls back to Claude logo |
| `claudeSpinner.smartState` | boolean | `true` | — | Detects debugging, diff review, terminal focus to vary state line |
| `claudeSpinner.idleBehavior` | enum | `"slow"` | `"slow"` / `"pause"` / `"clear"` / `"none"` | What happens when VS Code loses focus for `idleThresholdMinutes` |
| `claudeSpinner.idleThresholdMinutes` | number | `5` | 1–60 | Minutes of inactivity before idle mode engages |
| `claudeSpinner.wordRarity` | boolean | `false` | — | Opt-in weighted random: common ~70%, uncommon ~25%, rare ~5% |
| `claudeSpinner.timeBasedPools` | boolean | `false` | — | Opt-in bias toward warming-up / in-zone / deep-session word groups |

**Live-reload semantics**

- `enabled` off → `disconnect()`; on → `connect()`
- `cycleSpeed` → clear + restart interval, push immediate payload
- `idleThresholdMinutes` → reset idle timer at new threshold
- Any display toggle → rebuild and push payload
- `customWords`, `wordRarity`, `timeBasedPools` → debounced push so the new setting takes visible effect on the next tick rather than waiting a full cycle

---

## Presence display — full field map

| Field | What Discord shows | Source | Toggle | Default |
|---|---|---|---|---|
| Application name | "Playing X" prefix | Discord Dev Portal (not code) | — | TBD (see iterate-in-plan) |
| `type` | Activity category | const `0` (Playing) | — | — |
| `statusDisplayType` | Member-list bold label | const `2` (details) | — | — |
| `details` | Bold line in popup, member-list label | Cycling word + `"..."` | `cycleWords` | on |
| `state` | Smaller line under details | `"Working in {language}"` ± workspace, or smart variant | `showLanguage`, `showWorkspace`, `smartState` | language on, workspace off, smart on |
| `timestamps.start` | "X:XX elapsed" | Activation timestamp (survives reconnects) | `showElapsedTime` | on |
| `assets.large_image` | Big icon in popup | const `vscode-spinner` | — | — |
| `assets.large_text` | Tooltip on large image | const `"Visual Studio Code"` | — | — |
| `assets.small_image` | Corner overlay | `lang-{id}` if mapped, else `claude-logo` | `showLanguageIcon` | on, with fallback |
| `assets.small_text` | Tooltip on small image | Language name, or `"Powered by Claude Code"` | — | — |

**State line priority**

1. `paused === true` → no payload at all (presence cleared)
2. `smartState && debugActive` → `"Debugging in {language}"`
3. `smartState && focusContext === 'diff'` → `"Reviewing in {language}"`
4. `smartState && focusContext === 'terminal'` → `"In the terminal"`
5. `currentLanguage === undefined` → state line omitted (no "Exploring" fallback)
6. Default → `"Working in {language}"`
7. After 2/3/4/6: if `showWorkspace` → append `" — {workspaceName}"`. Step 5 has nothing to append to.

`showLanguage === false` → entire state line suppressed.

**Idle behavior** (when window loses focus past `idleThresholdMinutes`)

- `slow` (default): cycle interval × 4, max 120s clamped
- `pause`: clear interval, keep last presence visible
- `clear`: clear interval + clear presence
- `none`: no change

On focus regain: push fresh presence immediately, restore normal cycle.

---

## Word selection

**Anti-duplicate picker.** `getNextWord(pool, recent, opts)` returns a pool word not in `recent`. Ring buffer of last 3 in `state`. Effective exclusion window = `min(3, floor(pool.length / 2))` — prevents infinite loops on tiny pools. Short-circuit if `pool.length === 1`.

**Rarity tiers** (`wordRarity: true`). Built-in classification map `word → tier`:

- Common (~70%): `Thinking`, `Working`, `Coding`, `Building`, ...
- Uncommon (~25%): `Beboppin'`, `Moonwalking`, `Spelunking`, ...
- Rare (~5%): `Flibbertigibbeting`, `Prestidigitating`, `Whatchamacalliting`, ...

Custom words classified as common.

**Time-based pools** (`timeBasedPools: true`). Bias by session elapsed:

- 0–30 min (warming up): `Brewing`, `Simmering`, `Percolating`, `Incubating`, `Germinating`, ...
- 30–120 min (in the zone): `Computing`, `Synthesizing`, `Orchestrating`, `Architecting`, ...
- 120+ min (deep session): `Hyperspacing`, `Transmuting`, `Prestidigitating`, ...

Bias ≠ exclusion; out-of-pool words still appear, just less often. Custom words = wildcard tier (always eligible).

Rarity + time-based compose: rarity weighting applies within the biased pool.

---

## Discord application rebrand

| Field | Before | After |
|---|---|---|
| App name | `Attention` | TBD — provisional `Coding` (see iterate-in-plan) |
| Client ID | `1494346699861397636` | New from fresh Discord app |
| `largeImageKey` | `claude-logo` | `vscode-spinner` (new icon — see iterate-in-plan) |
| `largeImageText` | `"Claude"` | `"Visual Studio Code"` |
| `smallImageKey` | unused | `lang-{id}` mapped, `claude-logo` fallback |
| `smallImageText` | unused | language name, or `"Powered by Claude Code"` |

**Language icons (~25)** — uploaded to Discord Dev Portal under Rich Presence → Art Assets:

- **Tier 1 (top 10):** `lang-typescript`, `lang-javascript`, `lang-python`, `lang-rust`, `lang-go`, `lang-java`, `lang-cpp`, `lang-csharp`, `lang-html`, `lang-css`
- **Tier 2 (next 15):** `lang-ruby`, `lang-php`, `lang-swift`, `lang-kotlin`, `lang-dart`, `lang-lua`, `lang-elixir`, `lang-haskell`, `lang-scala`, `lang-shell`, `lang-sql`, `lang-json`, `lang-yaml`, `lang-markdown`, `lang-c`

Mapping: VS Code `languageId` (lowercase, hyphenated) → asset key with `lang-` prefix. Translation map in `presence.ts` for exceptions (e.g., `javascriptreact` → `lang-javascript`). Fallback chain: `lang-{id}` → `claude-logo`. Never blank.

**Manual steps (Discord Dev Portal)**

1. Create new Application at discord.com/developers/applications (fresh, not rename).
2. Name per iterate-in-plan decision below.
3. Upload 512×512 application icon.
4. Upload Rich Presence assets: `vscode-spinner`, `claude-logo`, all 25 `lang-*` icons. Recommended source: Devicon or Simple Icons (open license, pre-built 128×128 PNGs).
5. Copy new Application ID → swap `CLIENT_ID` constant in code.
6. Delete the old "Attention" app.

---

## Commands

`claudeSpinner.toggle` — registered in `contributes.commands`, no default keybinding.

- Active (default): normal cycling.
- Paused: clears interval, calls `clearPresence()` — presence disappears from Discord entirely (matches "hide my status right now" intent).
- Resume: pushes fresh, restarts interval.

Paused state does not persist across VS Code restarts.

---

## Bug fixes

**Back-to-back duplicates.** Uniform random picks identical consecutive words; reads as frozen at slow speeds. Fix: anti-duplicate picker above. Test: 10,000 calls assert no pick is in `recent` at emission; tiny-pool (1 word) doesn't loop.

**Reconnect resource leak.** `connectToDiscord()` overwrites `client` without destroying the prior. Fix: top of `connect()` — if client exists, `await client.destroy().catch(() => {})` and null before creating new. Test: Vitest mock with spy on `destroy`; `connect()` twice → destroy called once on first client.

**No-editor-focus behavior.** State line silently disappears when focus is on terminal/output/no tabs. Fix: state-line priority above (omit cleanly when language undefined; smart state handles terminal/debug/diff explicitly). Test: undefined language → no `state` key; terminal focus → state reflects it.

**Elapsed-time semantics (docs only).** `startTimestamp` captured once on `activate()`, survives Discord reconnects. Matches Discord convention; documented so future changes don't "fix" it.

---

## Iterate-in-plan items

Three decisions deliberately deferred to implementation, with explicit user-review loops. All can run in parallel with unrelated work.

**A. Discord application name.** Provisional `Coding`. Constraints: works as both "Playing X" and standalone "X"; dev-related; no trademark adjacency. Process: brainstorm 5–8 candidates, pick, set at Dev Portal. Blocks: icon brief, presence wiring.

**B. Extension marketplace name + package identifier.** Provisional `Coding Status for Discord` / `coding-status-for-discord`. Constraints: marketplace SEO; doesn't start with "Claude" (Anthropic guidelines); describes what it *does*. Process: brainstorm 3–5 alternatives, pick, update `package.json`. Blocks: CHANGELOG, README title, publish step.

**C. Icon design.** Provisional: current `assets/icon.png` until replaced.

Brief — must communicate "this person is coding" in one glance, no text:

- Works at 16×16 (member list), 128×128 (marketplace + Discord card), 512×512 (marketplace header + Dev Portal app icon)
- Works on light + dark Discord themes
- Avoid Microsoft VS Code logo + Anthropic Claude logo (trademark)
- Evoke "code editor" or "rotating word"
- Color palette: blue-editor vibe, not Microsoft's specific shade
- Nice-to-have: subtle motion/rotation cue; orange accent nodding to Claude

Process: 3–5 direction boards → pick → 2–3 variants → pick or commission → final 512/128/16 PNGs uploaded to Dev Portal + committed.

---

## Testing strategy

**Unit (vitest)**

- `words.test.ts` — list integrity, anti-duplicate ring buffer, tiny-pool short-circuit, rarity distribution, time-based bias, custom words merging
- `config.test.ts` — defaults, bounds clamping, change-notification plumbing (mock `vscode.workspace.getConfiguration`)
- `presence.test.ts` — every field × every toggle combination, smart-state priority, paused behavior, language-icon fallback, workspace-name append
- `discord-client.test.ts` — mock `Client`, assert cleanup on reconnect, interval clears on disconnect, enable/disable switch

**Integration smoke**

Launch extension host + mock Discord IPC: activate → at least one presence within 2s; deactivate tears down without throwing; toggle flips state correctly.

Manual: install packaged `.vsix` via `code --install-extension`, open real Discord, verify rebranded presence.

---

## Build order

1. Module split refactor (no behavior change — pure restructure)
2. Settings schema + config reader + live-reload
3. `state.ts` expansion (paused, recent-words, idle, focus context)
4. Anti-duplicate picker + rarity tiers + time-based pools
5. Idle detection + smart state listeners
6. Language icon mapping + small-image fallback
7. `toggle` command + pause/resume presence handling
8. Reconnect cleanup bug fix
9. Discord payload restructure with language-icon logic
10. Iterate **A** → Discord app created → Client ID swapped
11. Iterate **B** → extension renamed in `package.json`
12. Iterate **C** → icon produced → asset uploaded
13. CHANGELOG + README updates
14. Version bump to `1.0.0`
15. Build + test + `vsce package` + local install verification
16. `vsce publish`

Steps 10–12 are user-review checkpoints.

---

## Risks

| Risk | Mitigation |
|---|---|
| Discord rejects `Coding` as reserved/impersonation | Iterate **A** produces 5–8 fallbacks |
| Icon design drags timeline | MVP: single-glyph geometric on solid color is acceptable |
| 25 language-icon uploads tedious | Use Devicon / Simple Icons PNGs at 128×128 — pre-built, open license |
| Trademark complaint (MS / Anthropic) | Brief avoids logo reproduction; name avoids "VS Code" / "Claude X"; "Powered by Claude Code" is within Anthropic guidelines |
| `customWords` with empty / oversized entries | Config reader filters: non-string, empty, >128 chars → silently dropped |
| `idleThresholdMinutes` = 0 | Clamped to min 1 at read time |
| VS Code Profiles conflict | Settings are workspace-scoped by default; Profiles handles per-workspace switching |

---

## Success criteria

- [ ] All 13 settings work and live-reload correctly
- [ ] `claudeSpinner.toggle` pauses (clears presence) and resumes cleanly
- [ ] Idle detection transitions correctly for all 4 behaviors
- [ ] Smart state correctly detects debug, terminal, and diff-editor contexts
- [ ] Language icons appear for all 25 tier-1+tier-2 languages; Claude logo fallback works
- [ ] Workspace name appends only when `showWorkspace === true`
- [ ] Rarity weighting and time-based pool distributions match spec when enabled
- [ ] Anti-duplicate: same word never in last-3 across 10,000 simulated picks; tiny-pool edge handled
- [ ] Reconnect cycles don't leak client instances (mock-verified)
- [ ] Discord presence shows the approved **A** name with new large icon + language-icon overlay
- [ ] Extension renamed to **B** decision in `package.json` + README + CHANGELOG
- [ ] **C** final icon committed and uploaded
- [ ] All unit tests pass; integration smoke passes
- [ ] `.vsix` packages cleanly and installs locally
- [ ] README reflects new identity + all settings documented
- [ ] CHANGELOG has complete `1.0.0` entry
- [ ] Screenshot/GIF captured with final settings and committed to README
