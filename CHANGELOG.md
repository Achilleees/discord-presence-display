# Changelog

All notable changes to Coding Status for Discord will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.2] - 2026-05-06

A polish release closing the seams found by two days of intensive auditing — 23 confirmed bugs fixed across multi-root workspace handling, reconnect/idle-pause continuity, the anti-duplicate ring buffer, and a handful of platform-specific edge cases. Test suite grew from 170 → 214 to lock in regressions.

### Fixed

- **Multi-root workspace folder name no longer leaks** — `state.workspaceName` now refreshes on active editor changes (was stuck at the activation-time folder name) and on in-place `.code-workspace` renames. The privacy fix promised in code comments now actually works.
- **Reconnect during idle-pause restores the same visible word** — Discord disconnect/reconnect mid-pause used to surface a fresh random word; now honors the README "last presence stays visible" contract via cache invalidation at the reconnect boundary.
- **Cycling-mode anti-duplicate ring is no longer polluted on dedup hits** — `RingBuffer.add` now skips back-to-back duplicates, restoring full anti-repeat protection after every reconnect.
- **`clear → pause` mid-idle no longer leaves Discord blank** — flipping `idleBehavior` from `clear` to `pause` while a `clearActivity` IPC was still in flight could leave Discord cleared until next focus regain. Cache is now explicitly invalidated before the restore push.
- **`state.lastWord` cleared on relevant transitions** — togglePaused.pause, `cycleWords` mode flip, and pool-affecting config changes now all clear the last-word cache so a subsequent `useLastWord` push can't surface a word that was just removed from the pool.
- **Cycling mode commits to the recent-ring only on confirmed delivery** — symmetric with pinned mode. Failed IPC writes no longer burn slots in the anti-repeat ring on words Discord never saw.
- **Linux multi-user instance lock no longer deadlocks** — `os.tmpdir()` resolves to `/tmp` on Linux (shared across users); the lock directory is now scoped per OS user so two users on one host don't fight for one lock.
- **Custom-words removal during idle no longer surfaces a stale word** — disable → edit `customWords` → re-enable now correctly drops the cached last-word.
- **`lastInteractedSource` resets on focus regain** — alt-tabbing back into VS Code with the editor focused no longer leaves Discord stuck at "In the terminal" until the first keystroke.
- **Multi-window handoff respects the idle threshold** — when a secondary VS Code window acquires the lock from a closed primary, the focus-state-driven idle update no longer skips the configured threshold gate.
- **Debug session terminate handling tolerates adapters without session ids** — third-party debug adapters that omit `session.id` no longer cause `state.debugActive` to flip to false while debugging is still active.
- **Literal `"undefined"` languageId no longer renders as `Working in Undefined`** — exotic third-party language extensions that assign the literal string `"undefined"` are now collapsed to the language-less display.
- **In-flight push completing post-shutdown no longer re-populates state** — disabling the extension while a cycle tick's IPC ACK was in flight could undo the shutdown's `state.lastWord` clear, leaking a stale word into the next enable. New `!config.enabled` post-await guard closes the race.
- **`pushDirty*` flags symmetrically reset on togglePaused** — the resume branch now mirrors the pause branch's defensive reset; closes a defense-in-depth gap that wasn't triggerable today but pre-empts future regressions.

### Privacy / packaging

- **VSIX bundle no longer ships internal files** — `1.0.0` and `1.0.1` accidentally bundled `.github/workflows/publish.yml` and `submission/marketplace-email.md` (a draft of internal Microsoft correspondence). `.vscodeignore` now excludes both. Bundle is 8 files, ~354 KB — down from 10 files.

### Changed

- **`pushImmediate` post-await guards** now include `!config.enabled` (mirrors the existing `paused` and `idle-clear` guards). State commits after the IPC await no longer survive a shutdown that fired during the roundtrip.
- **`computeConfigTransition` clears `lastWord`** on `cycleWords true→false` (joins the existing `customWords`/`wordRarity`/`timeBasedPools` pool-affecting triggers).
- **Debug session survivor check** uses a hybrid id-equality + object-identity strategy — preserves correctness for first-party adapters (which assign ids) and works for third-party adapters that don't.

### Documentation

- **`showElapsedTime` semantics documented** — README now explicitly states the timer counts from VS Code session start (not extension enable/disable cycles).
- **README catchphrase restored** at the top.

### Internal

- **Test suite grew from 170 → 214** (44 new tests). New `test/state.test.ts` covers `RingBuffer.add` directly; `test/instance-lock.test.ts` covers FS-race recovery (previously zero coverage on 165 LOC); `test/discord-client.test.ts` now inspects the actual SET_ACTIVITY wire payload via `request.mock.calls` instead of the bridging mock that masked it.
- **Audit registry consolidated** — `.docs/audit/{NON-ISSUES,DECISIONS,KNOWN-BUGS}.md` are now uppercase per canonical spec; added `.docs/{OVERVIEW,CONVENTIONS}.md` scaffolding and a project-level `CLAUDE.md`.

## [1.0.1] - 2026-05-01

### Changed

- **VSIX distribution moved to GitHub Releases** — the packaged extension is no longer tracked in the repo. `release.sh` now uploads the VSIX as a GitHub Release asset and cleans up the local file after publishing.

### Fixed

- **Unicode property escapes for invisible-character rejection** — the `CONTROL_CHAR` regex in `customWords` sanitisation now uses `\p{C}` (Unicode property escapes) instead of a hand-rolled character class, so RTL-override, zero-width, and other invisible format characters are reliably rejected across the full Unicode space.
- **`package-lock.json` staged during release** — `release.sh` now adds `package-lock.json` alongside `package.json` when committing the version bump, so the lockfile no longer drifts out of sync with the released version.

## [1.0.0] - 2026-04-20

First full public release. Everything a Rich Presence extension for VS Code should do — the cycling word, the language icon, smart state detection, idle handling — behind a single install-and-forget install.

### Added

- **13 user settings** under `claudeSpinner.*` (`enabled`, `cycleSpeed`, `cycleWords`, `customWords`, `showLanguage`, `showWorkspace`, `showElapsedTime`, `showLanguageIcon`, `smartState`, `idleBehavior`, `idleThresholdMinutes`, `wordRarity`, `timeBasedPools`) — all live-reload, no restart required.
- **Toggle command** (`Toggle Coding Status Presence`) to pause and resume presence from the command palette.
- **Smart state line** — adapts to debugging (`Debugging in X`), diff review (`Reviewing in X`), terminal focus (`In the terminal`), and regular work (`Working in X`).
- **Language icon overlay for 43 languages and frameworks** — TypeScript, JavaScript, React (`.tsx`/`.jsx`), Vue, Svelte, Astro, Python, Rust, Go, Java, C, C++, C#, HTML, CSS, Ruby, PHP, Swift, Kotlin, Dart, Lua, Elixir, Haskell, Scala, Shell (+bash/zsh/fish), SQL, JSON, YAML, Markdown, R, MATLAB, Julia, OCaml, F#, Clojure, Erlang, Perl, Groovy, PowerShell, Objective-C, GraphQL, Docker, LaTeX. Anything else falls back to the Claude logo while keeping the language name in the tooltip.
- **Idle handling** with four behaviors: `slow` (4× interval, clamped to 120s), `pause`, `clear`, `none`. Configurable threshold (1–60 min).
- **Anti-duplicate word picker** — the next word is guaranteed not to match any of the last 3 picks (or `pool.length / 2`, whichever is smaller), so slow cycle speeds never look frozen.
- **Optional rarity weighting** — common (~70%), uncommon (~25%), rare (~5%) when `wordRarity` is on.
- **Optional time-based word pools** — biases toward warming-up, in-the-zone, or deep-session word groups based on session length.
- **Custom words** via `customWords` — user-defined spinner words mixed into the rotation alongside the built-ins.
- **Workspace name** (opt-in, off by default) appended to the status line via `showWorkspace`.
- **Automatic reconnection** every 30 seconds if Discord restarts, with no user-visible errors or noise.

### Changed

- **Bundled with esbuild** — single `dist/extension.js` file. VSIX shrunk from 2.28 MB / 1398 files to 490 KB / 8 files. Faster install, faster activation.
- Split `src/extension.ts` into 8 focused modules: `extension`, `discord-client`, `presence`, `transitions`, `config`, `commands`, `state`, `words`.
- Discord activity now uses `vscode-spinner` as the large image (with `Visual Studio Code` as its tooltip); the small image is a per-language icon with the Claude logo as the fallback.

### Fixed

- **Reconnect resource leak** — `connect()` destroys the previous client cleanly before creating a new one, and a `wantsConnection` flag prevents a mid-flight reconnect from resurrecting a client the user just disabled.
- **Spurious `clearActivity` on reconnect-while-paused** — `resumeAfterReady` now short-circuits if the user has explicitly paused presence.
- **Back-to-back duplicate words** — anti-duplicate ring buffer prevents the status from looking frozen at slow cycle speeds.
- **No-editor-focus silence** — state line omits cleanly when the language is unknown and no smart-state trigger is active; no more `Working in undefined` glitches.
- **Unicode control chars in `customWords`** — entries containing RTL-override, zero-width, or other invisible format chars are now rejected during sanitisation so Discord can't render reversed or garbled text.
