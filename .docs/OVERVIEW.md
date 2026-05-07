# Overview — Coding Status for Discord

A VS Code extension that turns editor activity into Discord Rich Presence: language detection, session elapsed time, and a rotating spinner word borrowed from Claude Code's loading animation.

## Stack

- **Language:** TypeScript (strict, ES2021/CommonJS)
- **Runtime:** VS Code extension host (Node 18 target)
- **Bundler:** esbuild → single-file CJS bundle in `dist/`
- **Tests:** Vitest 3.x with a hand-rolled VS Code API mock (`test/mocks/vscode.ts`)
- **Discord IPC:** `@xhayper/discord-rpc` (only runtime dependency)

## Source Layout

```
src/
  extension.ts        # ENTRY: lifecycle, mutable module state, all event wiring
  words.ts            # Word data + buildPool + getNextWord (pure)
  discord-client.ts   # IPC adapter: connect/push/clear, dedup, deadlines
  presence.ts         # buildPresencePayload + language tables (pure)
  instance-lock.ts    # Cross-window single-primary lock (FS-based)
  config.ts           # readConfig + sanitizeCustomWords
  transitions.ts      # computeConfigTransition (pure)
  state.ts            # State shape + RingBuffer
  commands.ts         # registerCommands wrapper
```

## Conceptual Layers

- **Pure** (`words.ts`, `presence.ts`, `transitions.ts`, `state.ts`): no side effects, fully testable.
- **Adapter** (`discord-client.ts`, `instance-lock.ts`, `config.ts`): isolates external interfaces (IPC socket, filesystem lock, VS Code config API).
- **Imperative** (`extension.ts`, `commands.ts`): orchestration, lifecycle, all `vscode.*` event wiring. Owns module-level mutable state.

## Project Invariants

- **Discord stays silent.** All Discord operations are fire-and-forget with silent fallbacks. No errors surface to the user. Discord is optional.
- **`state.startTimestamp` = VS Code session.** Set once at activation, never refreshed by enable/disable toggles. Disabling and re-enabling does not reset the elapsed timer.
- **Single primary instance.** Cross-window FS-based lock; secondary windows watch but don't push. Best-effort, not distributed consensus.
- **Case-sensitive custom-word dedup.** Documented feature; users can add lowercase variants of built-in words.

## Key Files Outside `src/`

- `package.json` — manifest + 13 user-facing settings (`claudeSpinner.*`)
- `release.sh` — patch/minor/major release pipeline (CHANGELOG-gated)
- `esbuild.config.mjs` — single-file CJS bundle config
- `assets/discord/` — 43 language icons + Claude logo + spinner image
- `.docs/audit/` — `NON-ISSUES.md`, `DECISIONS.md`, `KNOWN-BUGS.md` (permanent registries)

## Where to Look First

- **Lifecycle / event wiring:** `src/extension.ts` (it's the largest module on purpose — all imperative logic lives here)
- **Smart-state rules:** `src/presence.ts — buildStateLine`
- **Config sanitization:** `src/config.ts — sanitizeCustomWords`
- **Tests:** `test/extension.test.ts` for end-to-end behavior, per-module test files for unit coverage
