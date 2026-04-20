# Changelog

All notable changes to Coding Status for Discord will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-04-20

### Added

- **13 user settings** under `claudeSpinner.*` (enabled, cycleSpeed, cycleWords, customWords, showLanguage, showWorkspace, showElapsedTime, showLanguageIcon, smartState, idleBehavior, idleThresholdMinutes, wordRarity, timeBasedPools) — all live-reload
- **Toggle command** (`Toggle Coding Status Presence`) to pause and resume presence from the command palette
- **Smart state line** — adapts to debugging (`Debugging in X`), diff review (`Reviewing in X`), and terminal focus (`In the terminal`)
- **Language icon overlay** for 25 languages (TypeScript, JavaScript, Python, Rust, Go, Java, C++, C#, HTML, CSS, Ruby, PHP, Swift, Kotlin, Dart, Lua, Elixir, Haskell, Scala, Shell, SQL, JSON, YAML, Markdown, C) with Claude-logo fallback
- **Idle handling** with four behaviors: slow (4×, clamped 120s), pause, clear, none — configurable threshold (1–60 min)
- **Anti-duplicate picker** — the next word is guaranteed not to appear in the last 3 picks (or `pool.length / 2`, whichever is smaller)
- **Optional rarity weighting** (opt-in) — common (~70%), uncommon (~25%), rare (~5%)
- **Optional time-based word pools** (opt-in) — bias toward warming-up, in-the-zone, or deep-session word groups based on session length
- **Custom words** (`customWords` setting) — user-defined spinner words appended to the rotation
- **Workspace name** (opt-in, off by default) — appended to the status line via `showWorkspace`

### Changed

- Renamed package to `coding-status-for-discord` (display: "Coding Status for Discord")
- Split `src/extension.ts` into 8 modules: `extension`, `discord-client`, `presence`, `transitions`, `config`, `commands`, `state`, `words`
- Rebranded Discord activity with `vscode-spinner` as the large image and `Visual Studio Code` as its tooltip
- Small image now uses a per-language icon when available; falls back to the Claude logo with `Powered by Claude Code`

### Fixed

- **Reconnect resource leak** — `connect()` now destroys the previous client before creating a new one
- **Back-to-back duplicate words** — anti-duplicate picker prevents the status from appearing frozen at slow speeds
- **No-editor-focus silence** — state line omits cleanly when the language is unknown and smart state is inactive

## [0.1.0] - 2026-04-16

### Added

- Initial release as `discord-presence-display` (renamed to `coding-status-for-discord` in 1.0.0)
- Discord Rich Presence integration via `@xhayper/discord-rpc`
- 187 rotating spinner words from Claude Code
- Current programming language displayed on profile click
- Elapsed coding time tracking
- Automatic reconnection when Discord restarts
- Silent fallback when Discord is not running
