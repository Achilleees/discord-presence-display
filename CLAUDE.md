# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build` — compile `src/` to `dist/` via `tsc` (no bundler)
- `npm run watch` — incremental TypeScript build; the default VS Code build task, auto-run by the `Run Extension` launch config (F5)
- `npm test` — run the Vitest suite once (`vitest run`); single test: `npx vitest run test/words.test.ts -t "name"`
- `npm run package` — produce a `.vsix` via `vsce package`; `vscode:prepublish` runs `build` automatically

Tests live in `test/` and are excluded from `tsconfig.json` — Vitest compiles them independently. Don't move them under `src/` or they'll be bundled into the published extension.

## Architecture

Single-file VS Code extension (`src/extension.ts`) that maintains one persistent Discord IPC connection and rotates the activity payload on a timer. Module-level mutable state (`client`, `cycleInterval`, `reconnectTimeout`, `currentLanguage`, `startTimestamp`) is the source of truth — there's no class wrapper. `activate()` and `deactivate()` are responsible for the full lifecycle of these globals; any new background work must be torn down in `deactivate()`.

Key invariants:
- **Discord is optional.** If `client.login()` throws (Discord not running), the extension schedules a 30s reconnect and stays silent — never surfaces errors to the user. Preserve this behavior.
- **Hardcoded `CLIENT_ID`** in `extension.ts` is tied to a registered Discord application (asset key `claude-logo` lives there). Changing it breaks the large image.
- **15-second cycle interval** and **30-second reconnect backoff** are deliberate (Discord rate-limits presence updates at ~5/20s).
- `WORDS` in `src/words.ts` is a `readonly` tuple of exactly 187 entries — the count is asserted in `test/words.test.ts` and the README enumerates the full list. Adding/removing words requires updating both.

## Repo conventions

- `docs/plan.md` is the single source of truth for v1.0 scope, design decisions, and build sequence. Consult it before adding new work.
- `.vscodeignore` controls what ships in the `.vsix` — keep `src/`, `test/`, `docs/`, `.map`, and `.d.ts` files excluded so the package stays small.
