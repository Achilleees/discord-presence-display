# Architecture Review — Coding Status for Discord
**Date:** 2026-05-05
**Language/Stack:** TypeScript (ES2021/CommonJS) + esbuild + Vitest, runs on Node 18+ inside the VS Code extension host. Single runtime dep: `@xhayper/discord-rpc`.
**Codebase size:** 9 source files (~1,776 LOC `src/`), 6 test files (~1,800 LOC `test/`), 1 mock module. ~3.5K LOC total.
**Overall assessment:** This is a small, single-purpose VS Code extension with a clean, deliberate architecture for its scale. The module split between pure logic (`presence`, `words`, `transitions`, `state`, `config`) and effectful glue (`extension`, `discord-client`, `instance-lock`) is exactly the right shape for this problem — pure modules are exhaustively testable with vitest, and the side-effect surface is concentrated where it belongs. The headline structural concern is that `extension.ts` has accreted into a 550-line orchestrator carrying 11 module-level mutable variables and the entire lifecycle/event/timer state machine; everything else is in good shape. The dependency tree is acyclic and shallow, the dependency footprint is essentially zero (one runtime package), and tooling choices (esbuild over webpack, vitest over jest, no DI framework) are appropriate for a project of this size.

## Structure Map

```
discord-presence-display/
├── src/                          # 9 files, all flat — no subdirs
│   ├── extension.ts              # 550 LOC — activate/deactivate, event wiring,
│   │                             # lifecycle FSM, timers, push-mutex, focus tracking
│   ├── discord-client.ts         # 184 LOC — IPC connection, reconnect, payload bypass
│   ├── presence.ts               # 235 LOC — payload builder, language display map,
│   │                             # smart-state line, word picker entry point
│   ├── words.ts                  # 449 LOC — WORDS list + rarity/time pools + picker
│   ├── transitions.ts            #  94 LOC — pure config-diff → actions FSM
│   ├── config.ts                 #  83 LOC — read/sanitize/clamp VS Code config
│   ├── state.ts                  #  52 LOC — State shape + RingBuffer + factory
│   ├── instance-lock.ts          #  98 LOC — single-instance file lock
│   └── commands.ts               #  13 LOC — registers the toggle command
├── test/
│   ├── *.test.ts                 # 1:1 per src module + mocks/vscode.ts
│   └── mocks/vscode.ts           # hand-rolled vscode API mock (~180 LOC)
├── assets/
│   ├── icon.png + icon-source.svg
│   └── discord/
│       ├── claude-logo.{svg,png}
│       ├── vscode-spinner.{svg,png}
│       ├── languages/lang-*.{svg,png}    # 43 language icons
│       └── convert.sh                    # dev-only SVG→PNG utility
├── .github/workflows/publish.yml          # marketplace publish on release
├── .docs/audit/                           # non-issues registry, decisions
├── release.sh                             # version bump + tag + GH release
├── esbuild.config.mjs                     # CJS bundle for VS Code
├── vitest.config.ts                       # mocks `vscode` via path alias
├── tsconfig.json                          # strict, noEmit (esbuild owns emit)
├── package.json                           # 13 user settings, 1 command
└── README.md / CHANGELOG.md / ROADMAP.md
```

### Internal dependency graph (DAG, acyclic)

```
extension.ts ─┬─> discord-client.ts ──> @xhayper/discord-rpc
              ├─> config.ts ──> vscode
              ├─> state.ts                      (pure)
              ├─> presence.ts ─> words.ts       (pure)
              ├─> transitions.ts ─> config.ts (type only)
              ├─> commands.ts ──> vscode
              └─> instance-lock.ts ──> node:fs/path/os

(state, words, transitions, presence: zero VS Code coupling — fully unit-testable)
```

There are no circular dependencies, no skip-layer reach-arounds, no shared mutable singleton across module boundaries. `extension.ts` is the only module with module-scoped mutable state; every other module is either stateless or constructs state via a factory the caller owns.

## What Works Well

1. **Pure-core / impure-shell separation.** `presence`, `words`, `transitions`, and `state` are pure modules with no `vscode` import and no I/O. `transitions.ts` in particular is excellent — it takes `(prev, next, ctx)` and returns a flag set for the orchestrator to act on. This is a proper functional core, and the test coverage on it is correspondingly straightforward.

2. **`discord-client.ts` as a stateful module-singleton with a narrow API.** The whole module exposes 5 functions (`connect`, `disconnect`, `pushPresence`, `clearPresence`, `isReady`). The internal `inFlightConnect` chaining and `wantsConnection` re-checks across await windows are properly implemented — concurrent caller serialization is the kind of subtle thing that earns this module its own boundary. Bypassing the upstream library's `setActivity` (which hardcodes `created_at: Date.now()`) and going through `c.request('SET_ACTIVITY', ...)` directly is documented and the right call given the bug it works around.

3. **`transitions.ts` as a pure FSM.** Computing the action set from a config diff in a separate, testable function — instead of inlining 30 lines of conditional reactions in the change handler — is a real architectural win. The `disabled→enabled` recursion that re-runs the diff with a synthetic prev so simultaneous changes still apply is genuinely clever and necessary.

4. **Test mock strategy.** `vitest.config.ts` aliases `vscode` to `test/mocks/vscode.ts` and the mock exposes `__set*`/`__fire*` test hooks. This is exactly the right call for an extension that can't easily run against the real VS Code API in unit tests, and it's one focused file rather than spread across every test.

5. **Build pipeline is minimal.** `esbuild.config.mjs` is 26 lines. Single CJS bundle, `vscode` external, `node18` target. No webpack config sprawl, no babel layer, no rollup. For a VS Code extension this size that's correct.

6. **No telemetry, no network beyond local IPC.** This isn't strictly an architecture decision, but the system boundary is well-defined and the README enforces it. The architecture supports this — there's no analytics module sitting around waiting to be wired up "just in case."

7. **The `.docs/audit/non-issues.md` registry.** The pattern of recording verified-intentional behaviour with a "why it's correct" rationale is a discipline most projects lack. It reduces audit churn and documents the invariants the design depends on (silent Discord failures, best-effort lock, etc.). This is the kind of thing that compounds in value.

8. **Single runtime dependency.** `@xhayper/discord-rpc` is the only npm dep that ships in the VSIX. Everything else is dev tooling. For a marketplace extension, this footprint is excellent — fewer supply-chain risks, faster install, smaller VSIX.

9. **Activation event scope.** `onStartupFinished` (not `*`) is correct — defers activation until VS Code finishes booting, and avoids the marketplace warning about wildcard activation.

10. **Per-module test files with 1:1 mapping.** `test/words.test.ts` covers `src/words.ts`, etc. This makes it obvious where to look when something breaks and discourages the test-organization-by-feature-not-by-module anti-pattern.

## Dependency Health

### Internal

The graph is a clean DAG. `extension.ts` is the apex importer; nothing imports `extension.ts`. The hierarchy is:

- **Tier 0 (pure utilities):** `state.ts`, `words.ts`
- **Tier 1 (pure logic over types):** `transitions.ts` (uses `config` types), `presence.ts` (uses `state`, `config`, `words` and the `SetActivity` library type)
- **Tier 2 (effectful):** `config.ts` (vscode), `commands.ts` (vscode), `discord-client.ts` (RPC lib), `instance-lock.ts` (fs)
- **Tier 3 (orchestrator):** `extension.ts` (everything)

No circular deps, no skip-layer violations. `state.ts` and `transitions.ts` are entirely VS Code-free, which is what makes the FSM unit-testable.

The one wrinkle in the graph is **`presence.ts` reaches into `words.ts` while `extension.ts` also drives word picking through `presence.pickCandidateWord`**. That's fine — it's just an indirection — but it does mean the word-picking subsystem effectively has two public entry points (`presence.pickCandidateWord` for orchestrator use, and `words.{buildPool,getNextWord}` for direct testing). This is intentional and not a problem; flagging only because it's worth knowing.

### External

**Runtime:**
- `@xhayper/discord-rpc ^1.3.0` — Active fork of the (long-archived) original `discord-rpc`. This is the right package; the official Discord docs no longer endorse a particular library, and `@xhayper/discord-rpc` is the most maintained option in the ecosystem. The chosen version pin (`^1.3.0`) accepts minor/patch updates, which is appropriate.

**Dev:**
- `esbuild ^0.28.0` — bundler. Correct for the use case.
- `vitest ^3.0.0` — test runner. Modern and ergonomic.
- `typescript ^5.5.0`, `@types/node ^25.6.0`, `@types/vscode ^1.85.0` — stable.
- `@vscode/vsce ^3.0.0` — packaging. Correct.

**Findings:**
- No redundant dependencies. No multiple libraries solving the same problem.
- No abandoned or unmaintained deps.
- `@types/node ^25` is targeting a very recent Node version while `tsconfig.json target` is `ES2021` and esbuild target is `node18`. The Node 25 types are fine since they're a superset of Node 18's surface, but if the extension ever wants to use a Node 25-only API by accident, the types won't catch it. Minor — not worth fixing today.

The dependency hygiene is genuinely impressive for a marketplace extension. The supply-chain attack surface is one IPC library.

## Structural Concerns

### `extension.ts` is the orchestrator god-module

- **Where:** `src/extension.ts` (550 LOC, 31% of source). 11 module-level mutable variables, ~25 functions across activate/deactivate, event handlers, push pipeline, idle FSM, reconnect FSM, lock-watch FSM, and config-change reactor.
- **What:** The orchestrator carries the entire runtime state machine in module-level `let`s and uses ad-hoc procedural functions to advance it. Several intersecting concerns are interleaved: connection lifecycle (`connectFlow`, `resumeAfterReady`), idle FSM (`engageIdle`, `applyIdleBehavior`, `onWindowStateChange`), instance-lock watching (`acquireOrWatch`, `startLockCheck`), focus context tracking (`computeFocusContext`, `lastInteractedSource`, `activeDebugSessions`), push pipeline (`pushImmediate`, `schedulePush`, `pushing`/`pushDirty`/`pushDirtyBypass` flags), and config reaction.
- **Why it matters:** Today this is manageable because the surface is well-tested (the `extension.test.ts` is 789 lines and exercises the FSM end-to-end). But every feature added compounds. The roadmap items "per-context cycle speeds" and "framework detection" both feed back into this file — speeds touch the cycle/idle FSM, framework detection touches focus/state. Each addition makes the module-level mutable bag harder to reason about. The `pushing/pushDirty/pushDirtyBypass` triple-flag is already a smell of an FSM that wants to be a class with explicit states.
- **Recommendation:** Extract the runtime into 2–3 cooperating objects (or just a single `Runtime` class), each owning its slice of state:
  - `PushPipeline` — owns `pushing`/`pushDirty`/`pushDirtyBypass`/`pushDebounce`, exposes `schedule()`, `flush()`, `cancel()`.
  - `IdleController` — owns `idleTimeout`, `isIdle` (today on `state`), exposes `onFocusChange()`, `apply()`.
  - `ConnectionController` — owns `currentClientId`, `reconnectTimeout`, `lockCheckInterval`, `isPrimary`, exposes `start()`, `stop()`. Wraps `discord-client` + `instance-lock`.
  - The `activate`/`deactivate` body becomes a thin wiring layer that creates these, subscribes them to events, and tears them down. The pure modules don't move.
- **Effort:** MEDIUM
- **Priority:** SOON

### `presence.ts` mixes payload building with language display tables

- **Where:** `src/presence.ts` — `LANG_SUPPORTED`, `LANG_ID_OVERRIDES`, `LANG_DISPLAY` (~125 LOC of static maps) live in the same file as `buildPresencePayload`, `buildStateLine`, and `pickCandidateWord`.
- **What:** The language metadata tables are pure data; `buildPresencePayload` is logic that consumes them. They co-habit one file and grow on different axes — language additions touch the tables, smart-state behaviour changes touch the logic.
- **Why it matters:** The roadmap item "framework detection beyond `languageId`" (Next.js, Nuxt, Rails) implies more lookup/normalization complexity in this file. At ~235 LOC today the file is manageable; once framework detection lands, the language metadata + dialect/framework normalization could easily double the file.
- **Recommendation:** Split language metadata into a `languages.ts` module exposing `getLanguageIconKey`, `getLanguageDisplayName`, and the dialect maps. Keep `presence.ts` for `buildPresencePayload` / `buildStateLine` / `pickCandidateWord`. This is a 30-minute refactor with no behaviour change. If framework detection lands, languages.ts naturally extends; if it doesn't, the split still pays off in readability.
- **Effort:** SMALL
- **Priority:** LATER

### `state.ts` exports `RingBuffer` as a class while everything else is functional

- **Where:** `src/state.ts` — `RingBuffer<T>` class alongside the `State` interface and `createState` factory.
- **What:** The codebase is otherwise consistently functional (factory functions returning plain objects/records, no other classes). `RingBuffer` is the lone OO pocket.
- **Why it matters:** Mixing styles isn't a bug, but it's the kind of thing that makes the codebase feel slightly less coherent. `RingBuffer` is also only used in one place (`State.recentWords`) for one type (string), with capacity 3. It's load-bearing for ~5 lines of logic and the class abstraction is heavier than the call sites need.
- **Recommendation:** Either keep it as-is (acceptable — the class is well-encapsulated), or inline as a small helper (`addToRing`, `clearRing`) operating on a plain `string[]` to match the rest of the codebase's style. This is opinion-territory; I'd lean inline for consistency, but reasonable engineers will disagree.
- **Effort:** SMALL
- **Priority:** MAYBE

### `extension.ts` directly mutates `state.currentLanguage` mid-push

- **Where:** `src/extension.ts:97` — `state.currentLanguage = vscode.window.activeTextEditor?.document.languageId;` is set inside `pushImmediate` rather than via the event listener.
- **What:** The language is also tracked via `onDidChangeActiveTextEditor`, but `pushImmediate` re-reads VS Code's active editor on every push and overwrites `state.currentLanguage`. This is a deliberate workaround (the comment explains: closing the last editor doesn't fire `onDidChangeActiveTextEditor` with `undefined` synchronously, so the push needs to re-resolve). The result is two write paths to `state.currentLanguage`.
- **Why it matters:** This is tolerable today but is a soft signal that `state` is being treated as a shared mutable bag rather than a clear domain object. If the runtime ever splits into multiple cooperating objects (per the previous concern), this re-read needs a clear owner — either pushed into a `LanguageTracker` or made part of the payload-builder's input rather than mutating shared state.
- **Recommendation:** When `extension.ts` is decomposed, fold the active-language read into a method on whatever object owns the push pipeline, so reads/writes to `currentLanguage` are local to one module rather than spread across the orchestrator. No urgency.
- **Effort:** SMALL (rolls into the orchestrator-decomposition task)
- **Priority:** LATER

### Single client ID hardcoded in `extension.ts`

- **Where:** `src/extension.ts:10` — `const CLIENT_ID = '1494346699861397636';`
- **What:** The Discord application ID is a top-of-file constant in the orchestrator file. Same for the timing constants (`RECONNECT_MS`, `LOCK_CHECK_MS`, `PUSH_DEBOUNCE_MS`, etc.).
- **Why it matters:** This is fine as long as there's only ever one Discord application backing this extension. If a fork or a regional/business variant is ever needed, the constant lives in code rather than build config. More immediately, the timing constants in `extension.ts` and similar constants in `instance-lock.ts` (`STALE_MS`, `HEARTBEAT_MS`) and `discord-client.ts` (timeout for `raceWithTimeout`) are scattered across modules with no central tuning surface.
- **Recommendation:** Don't externalize the client ID — it's a public identifier and shipping it in code is fine. But consider gathering tuning constants into a single `constants.ts` (or per-module `const` blocks at the top, which is mostly already the case) so they're discoverable. Lowest priority.
- **Effort:** SMALL
- **Priority:** MAYBE

### `instance-lock.ts` lives at the orchestrator layer but is doing systems work

- **Where:** `src/instance-lock.ts` — file-based PID lock with stale detection and heartbeat.
- **What:** The module is well-bounded and tested. The architectural question is whether single-instance enforcement belongs in this codebase at all, or whether VS Code's own extension model (which already serializes one extension instance per window/host) makes it redundant. Multiple VS Code windows running concurrently each spin up the extension; the lock prevents them from racing on Discord IPC.
- **Why it matters:** This is the "VS Code architecture meets system architecture" boundary. The lock is necessary because Discord IPC is a single-writer resource and VS Code's extension host is multi-window. The implementation is the right one for the constraint. The non-issues registry already calls out the TOCTOU and corruption acceptance criteria. No structural concern — flagging here only because anyone scanning the file map will reasonably ask "why does a presence extension need a file lock?" The answer ("multi-window") is in the design but not directly documented at the module head.
- **Recommendation:** Add a 3-line module-header comment to `instance-lock.ts` explaining the multi-window-VS-Code rationale so the next reader doesn't have to reason it out from `acquireOrWatch`. Not a refactor — a comment.
- **Effort:** SMALL
- **Priority:** LATER

### `extension.test.ts` is bigger than any single source file

- **Where:** `test/extension.test.ts` — 789 LOC.
- **What:** The orchestrator's test file is larger than `extension.ts` itself (550 LOC) and 35% bigger than the next-largest source file (`words.ts` at 449). The test exercises the FSM end-to-end through the vscode mock — config changes, idle transitions, focus changes, debug sessions, push mutex, reconnect, etc. The size reflects real coverage breadth.
- **Why it matters:** When `extension.ts` accretes new responsibilities, this test file accretes faster. Today every test reaches across the entire orchestrator. After the orchestrator decomposition recommended above, much of this test surface should move to per-controller tests (`PushPipeline.test.ts`, `IdleController.test.ts`) leaving `extension.test.ts` as a thin smoke test of activate/deactivate wiring. Not a concern in itself; a downstream consequence of the orchestrator concern.
- **Recommendation:** No action today. After orchestrator decomposition, redistribute tests to match the new module boundaries. Don't pre-emptively reorganize.
- **Effort:** MEDIUM (downstream of the orchestrator refactor)
- **Priority:** LATER

## Cross-Cutting Consistency

- **Error handling.** Consistently fire-and-forget for Discord operations: `.catch(() => {})` and silent fallbacks throughout. This is documented in the non-issues registry as intentional ("Discord is optional — never surfaces errors to the user"). Inside `pushPresence`, errors are caught and surfaced as `false` return; in `clearPresence`, errors are swallowed (a documented call-site asymmetry the non-issues registry justifies). For `instance-lock`, all fs operations are try/catch with `null` or `false` fallbacks, which matches the "best effort" design. **Consistent and intentional.**

- **Configuration.** Single namespace (`claudeSpinner.*`), single read/sanitize entry point (`readConfig`), live-reload via `onConfigChange`. Sanitization is centralized in `sanitizeCustomWords` and `clamp`. The package.json schema enforces per-item validation, and `config.ts` re-validates at runtime. **Excellent and uniform.**

- **Logging / observability.** None. The README explicitly promises "no telemetry, no network calls beyond the local Discord IPC socket," and there's no `console.log` infrastructure. Given the project's privacy-first posture and the small-scale nature of the codebase, this is correct — adding logging would require a user-facing toggle and storage, which is out of scope. **Intentional absence.**

- **State management.** Single `State` object in `extension.ts`, mutated in place via the event listeners and `pushImmediate`. The `State` shape itself is in a separate module (`state.ts`) but mutation is centralized in the orchestrator. This works because there's exactly one orchestrator and no other module retains a reference to the state object across event boundaries. The pattern would not scale to a more complex extension; for this one, it's appropriate.

- **Data serialization boundaries.** Two: VS Code config (read-only, well-typed via `Config` interface) and Discord IPC (`SetActivity` from the library type, with the `formatActivity` shim correctly serializing to the wire format). Both are explicit and small. **Clean.**

## Tech Stack Fit

- **TypeScript + esbuild + vitest.** Right call. esbuild keeps the bundle tiny (~730KB minified) and build time fast; vitest mocks VS Code via path alias and runs in-process. No webpack ceremony, no jest config sprawl. For a VS Code extension this size, this is the modern, lean stack.

- **CommonJS output target.** Required by VS Code (the extension host is still CJS-only). `tsconfig` and esbuild both set `cjs`, which is correct.

- **Strict TypeScript.** `strict: true` in `tsconfig.json`. Combined with `forceConsistentCasingInFileNames` and `noEmit` (with esbuild owning emission), this is the right configuration for a TS-only project.

- **`@xhayper/discord-rpc`.** Right library for the use case. Discord no longer maintains a first-party Node RPC SDK; this is the most-maintained fork. The codebase even works around a known library bug (`created_at: Date.now()` flicker) by going through `client.request` directly — this kind of vendor-aware code is fine in a single dedicated module.

- **No dependency injection framework, no event emitter, no Redux-style store.** Correct call. The codebase is small enough that direct imports and module-level state work. Adding DI/eventing here would be over-engineering and would obscure the data flow.

- **No subdirectories under `src/`.** At 9 files this is fine — flat is faster to navigate. The proposed orchestrator decomposition would add 2–3 files but still wouldn't justify subdirs. Watch for the 15-file mark; that's the natural threshold for splitting into `src/runtime/`, `src/domain/`, etc.

- **Vitest mocking strategy via path alias.** The mock at `test/mocks/vscode.ts` is hand-rolled and intentionally narrow (only what tests need). This is much cleaner than trying to use `@vscode/test-electron` in unit tests. **Right call.**

- **No CI for PR validation.** Roadmap item — currently CI only runs on release-published. For a single-maintainer hobby/marketplace extension this is acceptable, but the gap is worth closing if the project ever takes contributors.

**Stack fit verdict:** No tooling is being fought against. There's no case here of "we picked X and now we're working around it" — every choice maps cleanly to the problem.

## Recommendations Summary

| # | Priority | Effort | Area | Recommendation |
|---|----------|--------|------|----------------|
| 1 | SOON     | MEDIUM | `extension.ts` | Decompose the orchestrator into `PushPipeline`, `IdleController`, `ConnectionController` (or similar) so the 11 module-level `let`s become 3 owners with explicit interfaces. Pure modules don't move. |
| 2 | LATER    | SMALL  | `presence.ts` | Split language metadata tables (`LANG_*` maps + `getLanguageIconKey`/`getLanguageDisplayName`) into `languages.ts`. Pre-empts the framework-detection roadmap item. |
| 3 | LATER    | SMALL  | `instance-lock.ts` | Add a module-header comment explaining the multi-window-VS-Code rationale so the lock's existence is self-documenting. |
| 4 | LATER    | MEDIUM | `test/extension.test.ts` | After (1), redistribute orchestrator tests to per-controller test files. Don't preempt; do it as a follow-on. |
| 5 | LATER    | SMALL  | `extension.ts` ↔ `state.ts` | After (1), fold `state.currentLanguage` re-reads into the push-pipeline owner so reads/writes are co-located. |
| 6 | MAYBE    | SMALL  | `state.ts` | Consider inlining `RingBuffer<T>` as plain helpers to match the rest of the codebase's functional style. Stylistic. |
| 7 | MAYBE    | SMALL  | repo-wide | Optional: collect timing/tuning constants (`RECONNECT_MS`, `STALE_MS`, `HEARTBEAT_MS`, push debounce, etc.) into one `constants.ts` for discoverability. |

**The architecture is in good shape.** The single SOON item exists because the orchestrator is the natural growth point for the project, and decomposing it before the next batch of features (per-context cycle speeds, framework detection) makes both easier to land. Everything else is LATER or MAYBE. There is no NOW item — nothing is actively blocking or causing pain today.
