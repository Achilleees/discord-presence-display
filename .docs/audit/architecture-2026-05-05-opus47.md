# Architecture Review — Coding Status for Discord
**Date:** 2026-05-05
**Language/Stack:** TypeScript + VS Code Extension API + @xhayper/discord-rpc + esbuild + vitest
**Codebase size:** 9 source files, ~1,758 LOC src / ~1,805 LOC test (3,563 LOC total)
**Overall assessment:** This is a tight, well-shaped single-purpose extension that punches above its weight. The module split is deliberate and mostly principled — pure state machines (`transitions`, `presence`, `words`) are cleanly separated from VS Code/Discord I/O, which is what makes the test suite possible. The one real architectural concern is `extension.ts` itself: it has accumulated the role of orchestrator, connection lifecycle owner, idle controller, push debouncer, debug-session aggregator, and event router. At 550 LOC it isn't out of control, but every new behavior lands here and the file is now where the module split stops paying for itself. That aside: dependency hygiene is excellent (one runtime dep), the tooling is appropriate to the scope, and the test coverage of state transitions is genuinely impressive for a side-project extension.

## Structure Map

```
discord-presence-display/
├── src/                          [9 files, ~1,758 LOC]
│   ├── extension.ts              [550] orchestrator + event handlers + idle/cycle/connect lifecycle
│   ├── words.ts                  [449] pure: word pool + weighted picker + rarity/time tiers
│   ├── presence.ts               [235] pure: payload builder + language display/icon mapping
│   ├── discord-client.ts         [184] I/O: @xhayper/discord-rpc wrapper, connect serialization
│   ├── instance-lock.ts          [98]  I/O: tmpdir-based single-instance lock (best-effort)
│   ├── transitions.ts            [94]  pure: config-diff → ConfigTransition flag bag
│   ├── config.ts                 [83]  I/O: VS Code config read + sanitization + change events
│   ├── state.ts                  [52]  pure: State shape + RingBuffer
│   └── commands.ts               [13]  I/O: command registration adapter
│
├── test/                         [6 files, ~1,805 LOC]
│   ├── extension.test.ts         [789] integration tests against mocked vscode + discord-rpc
│   ├── presence.test.ts          [309]
│   ├── transitions.test.ts       [223]
│   ├── words.test.ts             [193]
│   ├── discord-client.test.ts    [155]
│   ├── config.test.ts            [136]
│   └── mocks/vscode.ts           [180] hand-rolled vscode API mock
│
├── assets/
│   ├── icon.png + icon-source.svg            [extension marketplace icon]
│   ├── archive/                              [retired icon iterations]
│   └── discord/                              [Rich Presence assets, 86 lang icons]
│       ├── claude-logo.svg/.png
│       ├── vscode-spinner.svg/.png
│       ├── languages/  (43 SVG + 43 PNG = 86 files)
│       └── convert.sh                        [dev utility for SVG→PNG batch]
│
├── .docs/audit/                  [non-issues registry, decisions log]
├── .github/workflows/publish.yml [release-triggered marketplace + Open VSX publish]
├── release.sh                    [version bump + build + tag + GH release]
├── esbuild.config.mjs            [bundles src → dist/extension.js]
├── tsconfig.json                 [strict, ES2021, noEmit]
├── vitest.config.ts              [aliases vscode → test/mocks/vscode.ts]
└── package.json                  [VS Code extension manifest + 13 settings]
```

**Dependency direction (one-way, healthy):**
```
extension.ts ──┬─→ discord-client.ts ──→ @xhayper/discord-rpc
               ├─→ presence.ts ────────→ words.ts
               ├─→ transitions.ts
               ├─→ config.ts
               ├─→ state.ts
               ├─→ commands.ts
               └─→ instance-lock.ts
```

There are no cycles. `state.ts` has zero dependencies. `transitions.ts`, `words.ts`, and most of `presence.ts` are pure functions of their inputs. Only `extension.ts`, `discord-client.ts`, `config.ts`, `commands.ts`, and `instance-lock.ts` touch the outside world.

## What Works Well

- **Separation of pure logic from I/O is the architecture's biggest win.** `transitions.ts` returning a `ConfigTransition` flag bag instead of mutating state, `words.ts` as a deterministic weighted picker, and `presence.ts` as a pure `(state, config, word) → SetActivity | null` translator are textbook examples of how to keep VS Code/Discord side-effects isolated. The 2,000+ lines of tests are only feasible because of this separation. This pattern should be preserved.
- **One runtime dependency.** `@xhayper/discord-rpc` is the only thing in `dependencies`. No utility libraries pulled in for things Node already does, no logger, no DI framework. The package-lock surface area is tiny by extension standards. This is correct for the project's scope.
- **The `formatActivity` bypass in `discord-client.ts` is documented architectural debt with a clear contract.** The library hardcodes `created_at: Date.now()` per-call which causes the voice-channel icon to flicker; the wrapper rebuilds the SET_ACTIVITY payload manually with a stable `sessionCreatedAt`. The non-issues registry confirms the omitted fields are out-of-scope (game lobbies, streaming). This is a load-bearing workaround, not a leak — and it's labeled as such.
- **`computeConfigTransition` as a pure decision table.** Taking `(prev, next, ctx) → flags` and letting `extension.ts` execute the flags is the right shape. It's testable, composable, and the recursive call for the disabled→enabled case is a clean way to honor multi-setting saves.
- **The non-issues registry (`.docs/audit/non-issues.md`) is an underrated piece of architecture.** Codifying intentional patterns ("silent Discord failures are intentional", "case-sensitive custom-word dedup is documented") prevents repeated audits from re-litigating the same decisions. More projects should do this.
- **Build/test/release toolchain is appropriately sized.** esbuild for the bundle, vitest with a hand-rolled vscode mock, a release shell script that does typecheck → test → build → package → tag → GH release. No CI complexity beyond the marketplace publish workflow. For a single-maintainer extension this is exactly right.
- **The `vscode` mock in `test/mocks/vscode.ts` is small and discoverable.** ~180 LOC, no `jest-mock-vscode` dependency, exports `__setConfig`/`__resetEvents`/etc. helpers that read like a tiny fixture API. It only models the surface the extension actually uses.

## Dependency Health

### Internal

The dependency graph is a clean star with `extension.ts` at the hub. No cycles, no skip-layer violations. Modules below the hub do not import from each other except `presence.ts → words.ts` (a justified dependency: presence orchestrates the picker), and `transitions.ts → config.ts` (only for the `Config` type).

The only "smell" worth naming is that `extension.ts` is an N=8 importer — every other src module is reachable from it. That's expected for an orchestrator, but it does mean the hub carries all the wiring. The mitigation is module purity below: as long as the leaves stay pure, the hub can grow without making the whole tree harder to reason about.

### External

**Runtime:**
- `@xhayper/discord-rpc ^1.3.0` — single runtime dep. Discord's official `discord-rpc` package is unmaintained (last meaningful release in 2020), so picking an actively-maintained community fork is the right call. The wrapper layer in `discord-client.ts` insulates the extension from this choice — if `@xhayper` ever goes silent, the swap surface is one file.

**Dev:**
- `esbuild ^0.28.0` — the right bundler for VS Code extensions; webpack would be overkill here.
- `vitest ^3.0.0` — fast, ESM-native, and the alias-based `vscode` mock works cleanly.
- `typescript ^5.5.0`, `@types/node ^25.6.0`, `@types/vscode ^1.85.0` — version pinned to declared `engines.vscode`, which is correct.
- `@vscode/vsce ^3.0.0` — the marketplace packaging tool; expected.

No redundancy, no abandoned packages, no overlap between tools. This is a 6-dev-dep, 1-runtime-dep extension and that's the right number.

## Structural Concerns

### `extension.ts` is an orchestrator with too many distinct responsibilities
- **Where:** `src/extension.ts` (550 LOC, 8 imports, ~14 module-level mutable bindings)
- **What:** This file holds the connection lifecycle, push pipeline (mutex + dirty flag + debounce + bypass), idle state machine, cycle interval, debug-session aggregation, focus-context computation, lock/heartbeat watcher, config-change executor, and all VS Code event subscriptions. Nine distinct concerns share a flat namespace of module-level `let` bindings.
- **Why it matters:** Every new behavior — terminal-focus icon swap (roadmapped), per-context cycle speeds (roadmapped), framework detection (roadmapped) — lands here, because there is no intermediate layer. The push pipeline alone (`pushImmediate`, `schedulePush`, `clearPushDebounce`, `pushing`/`pushDirty`/`pushDirtyBypass` mutex, idle-aware short-circuits) is a small state machine with subtle invariants. Today the comments document those invariants well, but the next contributor (or the next AI agent) will struggle to add a feature without first reverse-engineering them. The risk is not bugs — the risk is that the cost of changes silently rises until the file becomes a refactor target instead of a feature target.
- **Recommendation:** When the next non-trivial feature lands, extract two units. **(1) A `presence-pipeline` module** owning `pushImmediate`/`schedulePush`/the mutex/dirty flag/bypass; it would expose `request(reason)` and `flush()` and own the "is Discord ready, am I idle, am I paused" predicate set. **(2) An `idle-controller` module** owning `idleTimeout`, `engageIdle`, `applyIdleBehavior`, `onWindowStateChange`. `extension.ts` then becomes the VS Code event router and the dependency wiring point — closer to a `main.ts`. Don't do this preemptively for the sake of it, but the next time a feature sprawls through this file, it's the signal.
- **Effort:** MEDIUM (a day, touches the file every test currently exercises)
- **Priority:** SOON

### Module-level mutable singletons make `extension.ts` non-reentrant
- **Where:** `src/extension.ts` — `state`, `config`, all the timer handles, `pushing`, `pushDirty`, `currentClientId`, `isPrimary`, `lastInteractedSource`, `activeDebugSessions`
- **What:** The extension's runtime state is held in 14 module-level `let`/`const` bindings. `activate()` initializes them; `deactivate()` undoes them by hand. There is no `ExtensionRuntime` object that owns this state.
- **Why it matters:** Today this works because VS Code instantiates one extension per process, and `deactivate()` carefully nulls or clears every binding. But every new feature that needs runtime state widens the surface area of "what to reset on deactivate" — and the reset is currently done manually rather than by disposing a single object. Already, `deactivate()` lists 9 separate cleanup steps. This is also why `extension.test.ts` uses `afterEach(() => extension.deactivate())` and lots of `__reset*` mock helpers — the global state requires explicit teardown between tests, which is brittle as the test suite grows.
- **Recommendation:** Wrap the mutable state in a class or factory: `createRuntime(config) → { activate(ctx), deactivate() }`. `activate()` instantiates one; `deactivate()` disposes it. This pairs naturally with the previous concern (extracting `presence-pipeline` and `idle-controller` becomes injecting them into the runtime). Don't bother if `extension.ts` stays at this size — but if you take the SOON refactor above, do this at the same time.
- **Effort:** MEDIUM (couples with the above)
- **Priority:** LATER

### `presence.ts` blends two concerns under one filename
- **Where:** `src/presence.ts` — `pickCandidateWord` + `buildPresencePayload` + the language-display tables
- **What:** The file owns (a) the word-picking entry point that reads State and routes to `words.ts`, (b) the SetActivity payload builder (state line, icons, timestamps), and (c) two ~50-line static tables (`LANG_SUPPORTED`, `LANG_ID_OVERRIDES`, `LANG_DISPLAY`) plus their lookup helpers. The language table chunk is roadmapped to grow ("framework detection beyond `languageId`") and the icon override logic is also roadmapped to grow ("terminal focus icon").
- **Why it matters:** The language tables are static data and have nothing to do with payload assembly logic; they just sit in the same file. As the icon override logic gains terminal/debug variants and the language list grows, this file will trend toward 400+ LOC of mostly-tables. That's a small problem (it doesn't break anything), but the natural fix is small too.
- **Recommendation:** Extract `src/languages.ts` (the three tables + `getLanguageIconKey`/`getLanguageDisplayName`/`normalizeLang`) when terminal-focus-icon or framework-detection lands. Don't preempt — extracting today saves no work because the tables aren't being touched right now.
- **Effort:** SMALL
- **Priority:** LATER (do it when you next touch the language tables)

### Cross-module constants share intent without sharing a definition
- **Where:** `src/state.ts` (`RECENT_RING_SIZE = 3`), `src/words.ts` (`EXCLUSION_CAP = 3`), `src/extension.ts` (`IDLE_SLOW_MULTIPLIER = 4`, `IDLE_SLOW_MAX_SECONDS = 120`, `RECONNECT_MS = 30_000`, `LOCK_CHECK_MS = 30_000`, `PUSH_DEBOUNCE_MS = 750`)
- **What:** Behavioral tunables are scattered across three files. The non-issues registry already calls out `RECENT_RING_SIZE === EXCLUSION_CAP` as "equal today by coincidence of a reasonable default, not by invariant" — which is a fine policy, but it's also a tell that there's no canonical place for these knobs.
- **Why it matters:** If a future change wanted to "make the anti-duplicate window configurable" or "expose `idleSlowMultiplier` as a setting", a contributor would need to grep three files to find the relevant constant. This is a minor structural concern, not a bug.
- **Recommendation:** A `src/constants.ts` (or `src/tuning.ts`) module that re-exports these, with comments distinguishing user-facing defaults from internal invariants. Low value today, low cost any time. Skip if no other concern brings you near these files.
- **Effort:** SMALL
- **Priority:** MAYBE

### Single-instance lock duplicates effort the OS could do better
- **Where:** `src/instance-lock.ts` (98 LOC)
- **What:** Hand-rolled tmpdir lock with mkdir-as-mutex + JSON owner file + 30-second heartbeat + 120-second staleness window + watcher loop. Includes its own TOCTOU non-issue (already registered).
- **Why it matters:** This isn't broken — the non-issues registry has already verified it as best-effort and the failure modes are cosmetic. But it's the most defensive code in the repo, and it exists because two simultaneously-open VS Code windows would otherwise fight over Discord's IPC pipe. An alternative architecture would be to let both windows connect: `@xhayper/discord-rpc` already de-duplicates via Discord's own pipe naming, and the worst-case is that the second window's setActivity overwrites the first's — which is identical to the current "lock loser stops cycling" behavior. The lock prevents activity churn but adds 100 LOC of state.
- **Recommendation:** **Don't change this now.** It's a deliberate trade-off that solves a real "two windows fighting" problem. Worth flagging only because if a future bug ever surfaces in this code (heartbeat misses, stale-detection edge case, Windows tmpdir quirk), the right fix may be to delete the module rather than patch it. File this as awareness, not action.
- **Effort:** N/A (no change recommended)
- **Priority:** MAYBE

### Test mock module has no schema versioning against `@types/vscode`
- **Where:** `test/mocks/vscode.ts` (180 LOC), `vitest.config.ts` aliasing `vscode` → mock
- **What:** The mock is a hand-rolled subset of the VS Code API surface the extension uses. It's not type-checked against `@types/vscode` — if VS Code adds a property to `Window` or `Workspace` that the extension starts using, a test could pass with a mock that doesn't match runtime shape.
- **Why it matters:** This is fine for the current API surface, but the mock is invisible to the type system: if `vscode.workspace.getConfiguration` ever changed signature, `tsc` would catch it in src but not in tests. The risk is low because the API surface is small and stable, but as the extension reaches further into VS Code (e.g., for framework detection via file system, or terminal data API), the mock has to be kept in lockstep manually.
- **Recommendation:** Either (a) cast the mock module to `typeof import('vscode')` partially via `satisfies` so type errors surface when `@types/vscode` evolves, or (b) accept the current state as a known limitation and document it in a `test/mocks/README.md`. Option (a) costs maybe 30 minutes; option (b) costs 5 minutes. Either is fine for scope.
- **Effort:** SMALL
- **Priority:** LATER

## Cross-Cutting Consistency

**Error handling — consistent and intentional.** Discord operations are universally fire-and-forget with `.catch(() => {})` and silent fallbacks. Config sanitization clamps and falls back to defaults rather than throwing. The non-issues registry codifies this: "Discord is optional…never surfaces errors to the user." The only place that throws is `getNextWord` on empty pool, which is a programmer error guard, not a user-facing failure. This is the right model for an extension that should never break the editor.

**Configuration — clean and consistent.** Single source of truth in `package.json` `contributes.configuration`. `config.ts` reads via `vscode.workspace.getConfiguration`, sanitizes with explicit clamps and type coercions, and exposes `Config` as a typed snapshot. `onConfigChange` is the one channel for config delta. No module reads VS Code config directly except `config.ts`. Good discipline.

**Logging / observability — deliberately none.** No logger, no telemetry, no output channel. README states "No telemetry, ever." For a presence display this is appropriate; introducing a logger would be a regression. The trade-off is that field debugging requires the user to enable extension host logs themselves, but that's an acceptable cost for a privacy-first extension.

**State management — divided cleanly between in-memory `State` and read-on-demand config.** `State` (mutable, owned by `extension.ts`) is small and shape-controlled by `state.ts`. Config is immutable per snapshot and recreated on change. The `RingBuffer` is the only stateful primitive and lives in `state.ts`. Idempotent `pickCandidateWord` and `buildPresencePayload` keep state out of the rendering path. No state leaks.

**Serialization boundaries — well-defined.** Two boundaries: VS Code config → sanitized `Config` (in `config.ts`), and internal `State + Config` → Discord SET_ACTIVITY payload (in `presence.ts` + `discord-client.ts`). Both are unidirectional, both have tests. The non-issues registry covers the "Discord truncates long state field" decision explicitly.

The one inconsistency worth naming: `discord-client.ts` returns `boolean` from `pushPresence` but `void` from `clearPresence`. The non-issues registry already calls this a documented style choice (clear-paths only run after ready). It's fine, but it's the kind of asymmetry that makes a future contributor pause.

## Tech Stack Fit

**TypeScript + esbuild + vitest is the right stack for this extension.** Strict TS catches the bulk of the bugs that tests would otherwise have to write. Esbuild produces a 490 KB bundle from 8 files (per CHANGELOG) — appropriate for VS Code's startup-latency sensitivity. Vitest with the `vscode` alias gives unit-test feel for what is fundamentally an integration-flavored module.

**`@xhayper/discord-rpc` is the right Discord library choice given the alternatives.** The official `discord-rpc` is unmaintained; building IPC from scratch would mean reimplementing the IPC framing, opcodes, and ready-handshake. The wrapper in `discord-client.ts` keeps the leak-surface small if a swap is ever needed.

**VS Code Extension API as a target is appropriate but is also the project's architectural ceiling.** All the orchestration complexity in `extension.ts` exists because VS Code's lifecycle (activate/deactivate, disposable subscriptions, single-process-per-window) doesn't give you a runtime container. The "module-level mutable singletons" concern above is structurally inherent to the platform, not a fault of this codebase. There's nothing to "fight" here — it's how extensions are written — but it's worth noting that the idiomatic VS Code shape and a clean orchestrator-pattern shape are not the same thing, and choices have to be made.

**Things the project is correctly NOT using:**
- No DI framework (would be ceremonial overhead at this size)
- No state machine library (transitions.ts is small enough that a flag bag is clearer than XState would be)
- No reactive library (the cycle is a setInterval, the events are VS Code subscriptions; Rx would be overkill)
- No logger
- No utility library (lodash/ramda)

These are all good "no" decisions. The project is sized correctly to its tooling.

## Recommendations Summary

| # | Priority | Effort | Area | Recommendation |
|---|----------|--------|------|----------------|
| 1 | SOON | MEDIUM | `extension.ts` | Extract `presence-pipeline` and `idle-controller` modules when next major feature lands |
| 2 | LATER | MEDIUM | `extension.ts` | Encapsulate module-level mutable state in a `Runtime` object (pair with #1) |
| 3 | LATER | SMALL | `presence.ts` | Split language tables into `src/languages.ts` when icon-override logic next changes |
| 4 | LATER | SMALL | `test/mocks/vscode.ts` | Type-anchor mock against `typeof import('vscode')` or document the limitation |
| 5 | MAYBE | SMALL | constants | Centralize tunables (`RECENT_RING_SIZE`, `EXCLUSION_CAP`, idle/cycle ms) into `src/constants.ts` |
| 6 | MAYBE | N/A | `instance-lock.ts` | Awareness only — if it ever breaks, consider deletion over patching |

**The bottom line:** this codebase is healthier than 90% of similarly-sized VS Code extensions on the marketplace. The pure/IO split is the architectural feature that matters most, and it's been preserved despite real complexity in the orchestrator. Keep doing what you're doing; the only "now" decision is whether to refactor `extension.ts` ahead of the next big feature or after — both are defensible, and "after" is the more boring (correct) choice.
