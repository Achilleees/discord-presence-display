# Changelog

All notable changes to Coding Status for Discord will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
