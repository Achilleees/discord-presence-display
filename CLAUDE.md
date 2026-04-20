# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build` — compile `src/` to `dist/` via `tsc` (no bundler)
- `npm run watch` — incremental TypeScript build; the default VS Code build task, auto-run by the `Run Extension` launch config (F5)
- `npm test` — run the Vitest suite once (`vitest run`); single test: `npx vitest run test/words.test.ts -t "name"`
- `npm run package` — produce a `.vsix` via `vsce package`; `vscode:prepublish` runs `build` automatically

Tests live in `test/` and are excluded from `tsconfig.json` — Vitest compiles them independently. Don't move them under `src/` or they'll be bundled into the published extension.

## Architecture

8-file VS Code extension under `src/` with a thin `extension.ts` entry point. Module-level mutable state in `extension.ts` (`state`, `config`, intervals, timeouts, mutex/dirty flags, client-identity symbol, `activeDebugSessions` set) is the lifecycle source of truth; `activate()` and `deactivate()` own its full lifecycle. The pure logic modules (`transitions.ts`, `presence.ts`, `words.ts`) have no module-level mutable state.

Module contracts (per `docs/plan.md` §Architecture):
- `discord-client.ts` — Discord RPC connection, reconnect, cleanup; serialized via `inFlightConnect`.
- `presence.ts` — `buildPresencePayload` + `pickCandidateWord` pure functions.
- `transitions.ts` — pure `computeConfigTransition(prev, next, ctx)` returning an action object.
- `config.ts` — reader + change-event listener; `clamp` and `toBool` coerce hand-edited values.
- `commands.ts` — `claudeSpinner.toggle` registration.
- `state.ts` — `createState()` factory and `RingBuffer` for anti-duplicate.
- `words.ts` — 187-word list + `buildPool` + `getNextWord`.

Key invariants:
- **Discord is optional.** If `client.login()` throws (Discord not running), the extension schedules a 30s reconnect and stays silent — never surfaces errors to the user. Preserve this behavior.
- **Hardcoded `CLIENT_ID`** in `extension.ts` is tied to a registered Discord application. The application must host all referenced asset keys: `vscode-spinner` (large image), `claude-logo` (small-image fallback), and every `lang-*` key listed in `LANG_SUPPORTED` in `presence.ts` (43 at time of writing — the count is NOT an invariant, but each supported key must have a matching uploaded asset). Changing `CLIENT_ID` requires rehosting every asset; source SVGs for uploads live under `assets/discord/`.
- **5s minimum `cycleSpeed` and 30-second reconnect backoff** are deliberate (Discord rate-limits presence updates at ~5/20s). Default cycle is 15s.
- `WORDS` in `src/words.ts` is a `readonly` tuple of exactly 187 entries — the count is asserted in `test/words.test.ts` and the README enumerates the full list. Adding/removing words requires updating both.
- **Idle contracts** are load-bearing: `pause` keeps last presence visible, `clear` keeps presence cleared, `slow` quadruples the cycle (clamped to 120s), `none` keeps cycling normally. `pushImmediate` and `startCycle` both enforce the silence contracts; `resumeAfterReady` bypasses with `{ bypassIdleSilence: true }` only for the single restore push on reconnect.

## Repo conventions

- `docs/plan.md` is the single source of truth for v1.0 scope, design decisions, and build sequence. Consult it before adding new work.
- `.vscodeignore` controls what ships in the `.vsix` — keep `src/`, `test/`, `docs/`, `.map`, and `.d.ts` files excluded so the package stays small.
