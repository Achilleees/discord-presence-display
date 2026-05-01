# Architecture Review -- Coding Status for Discord

**Date:** 2026-05-01
**Language/Stack:** TypeScript + VS Code Extension API + esbuild + Vitest
**Codebase size:** 9 source modules (1,763 LOC), 7 test files (1,984 LOC), single runtime dependency
**Overall assessment:** This is a well-structured VS Code extension with clear module boundaries, a lean dependency footprint, and disciplined separation between IO (Discord IPC), domain logic (word selection, presence building, config transitions), and framework integration (VS Code event wiring). The architecture is appropriate for its scope -- a single-purpose, stateful extension with a rich config surface. The main structural risk is the orchestrator module (`extension.ts`) accumulating coordination complexity that could become difficult to test and reason about as features grow, but at the current scale it is manageable and honest about its role.

## Structure Map

```
discord-presence-display/
  src/
    extension.ts        (550L) -- lifecycle orchestrator, event wiring, state machine
    discord-client.ts   (184L) -- thin wrapper over @xhayper/discord-rpc
    presence.ts         (235L) -- payload construction, language mapping
    words.ts            (449L) -- word list, rarity/time pools, weighted picker
    config.ts            (88L) -- config schema, parsing, change listener
    state.ts             (52L) -- state shape, RingBuffer utility
    transitions.ts       (94L) -- pure function: prev config + next config -> side-effect flags
    commands.ts          (13L) -- command registration (trivial adapter)
    instance-lock.ts     (98L) -- filesystem-based single-instance mutex
  test/
    mocks/vscode.ts    (179L) -- VS Code API mock surface
    extension.test.ts  (789L) -- integration tests for full lifecycle
    discord-client.test.ts
    presence.test.ts
    config.test.ts
    transitions.test.ts
    words.test.ts
  dist/
    extension.js              -- bundled output (esbuild, single file)
  assets/
    discord/                  -- Rich Presence image assets (43 lang icons + fallbacks)
    icon.png                  -- Marketplace icon
```

## What Works Well

**1. Single runtime dependency.** The entire extension ships with exactly one `dependency`: `@xhayper/discord-rpc`. For a VS Code extension that bundles with esbuild, this means a tiny VSIX (490 KB), fast activation, and minimal supply chain surface. This is the correct call.

**2. Pure-function domain core.** The modules `transitions.ts`, `words.ts` (pool building + picking), `presence.ts` (payload construction + state line formatting), and `config.ts` (parsing + sanitization) are all side-effect-free and take their inputs explicitly. This makes them trivially testable -- and indeed the test coverage for these modules is thorough and readable. The test-to-source ratio (1.1:1 by LOC) is healthy.

**3. Config transition as a declarative state machine.** `computeConfigTransition` returns a flat struct of boolean flags rather than imperatively executing side effects. The orchestrator reads the flags and acts. This cleanly separates "what should happen" from "how to do it" and makes the transition logic easy to unit test in isolation.

**4. VS Code mock boundary.** The `test/mocks/vscode.ts` module provides a narrow, purpose-built mock of the VS Code API surface. Using Vitest's `resolve.alias` to intercept the `vscode` import globally is clean and avoids scattered per-test mock setup.

**5. Serialized push semantics.** The `pushing` mutex + `pushDirty` retry pattern in `extension.ts` correctly handles the fact that Discord IPC round-trips are async and events can arrive mid-push. This is a real concern for any presence extension and it is handled thoughtfully.

**6. Instance lock for multi-window.** The filesystem-based lock in `instance-lock.ts` with heartbeat and staleness detection is a pragmatic solution to VS Code's multi-window reality. It prevents duplicate presences without requiring inter-process communication beyond the filesystem.

**7. Non-issues registry.** `.docs/audit/non-issues.md` documents deliberate design decisions that might look like bugs to a future reviewer. This is an underrated practice that prevents audit churn.

## Dependency Health

### Internal

The internal dependency graph is a clean tree with no cycles:

```
extension.ts
  -> discord-client.ts    (IO layer)
  -> config.ts            (settings read + change listener)
  -> state.ts             (state shape)
  -> presence.ts          (payload building)
     -> words.ts          (word pool + picker)
  -> transitions.ts       (config diff -> effect flags)
  -> commands.ts          (command registration)
  -> instance-lock.ts     (mutex)
```

No module imports from `extension.ts`. No lateral imports between `discord-client`, `instance-lock`, and `commands`. The hierarchy is strict: orchestrator at the top, leaf utilities at the bottom. This is textbook for a project of this size.

### External

| Dependency | Role | Assessment |
|---|---|---|
| `@xhayper/discord-rpc` | Discord IPC communication | Maintained, appropriate, sole runtime dep |
| `esbuild` | Bundler | Fast, zero-config for this use case |
| `vitest` | Test runner | Good fit for TS projects, modern |
| `typescript` | Type checking (noEmit) | Standard |
| `@vscode/vsce` | VSIX packaging | Official tool |
| `@types/node`, `@types/vscode` | Type definitions | Standard |

No redundancy, no abandoned packages, no over-engineering. The dep list is minimal and every entry earns its place.

## Structural Concerns

### 1. Orchestrator weight concentration

- **Where:** `src/extension.ts` (550 lines, 31% of source)
- **What:** The extension entry point handles lifecycle management, event subscription, idle state machine, push serialization, reconnection scheduling, config change application, and instance-lock coordination -- all in module-level mutable state.
- **Why it matters:** At 550 lines this is manageable today. But the ROADMAP lists features like per-context cycle speeds, framework detection, and terminal-focus icons that would all add more branches to `pushImmediate`, more event subscriptions, and more state flags. The module is approaching the threshold where adding a feature requires understanding the entire file's interaction matrix. The 10+ `let` declarations at module scope are an early signal.
- **Recommendation:** If/when the next feature requires adding more than one new state variable, extract a `PresenceLifecycle` class or a `createPresenceController()` factory that encapsulates the timer/state/push coordination. The orchestrator's public API would shrink to `activate` and `deactivate`, delegating the state machine to a testable, instantiable object. This also unlocks testing the state machine without mocking VS Code's full event surface.
- **Effort:** MEDIUM
- **Priority:** LATER

### 2. No layered abstraction over Discord RPC specifics in presence.ts

- **Where:** `src/presence.ts` (lines 18-82, the `LANG_SUPPORTED`, `LANG_ID_OVERRIDES`, `LANG_DISPLAY` maps)
- **What:** Language metadata (icon keys, display names, alias resolution) is co-located with the presence payload builder. These serve different concerns: language classification vs. Discord API formatting.
- **Why it matters:** The ROADMAP mentions framework detection (Next.js, Nuxt, Rails). That feature would need to touch the language-resolution logic without caring about Discord payload shape. If the language metadata stays fused with presence building, framework detection would further bloat `presence.ts` or require awkward imports of presence-module internals.
- **Recommendation:** Extract language metadata into a `languages.ts` module exporting `getLanguageIconKey`, `getLanguageDisplayName`, `normalizeLang`, and the lookup tables. Keep `presence.ts` focused on payload assembly. This is a clean seam that already exists logically.
- **Effort:** SMALL
- **Priority:** LATER

### 3. Test coupling to implementation timing

- **Where:** `test/extension.test.ts` (pervasive use of `await Promise.resolve()` chains and `advanceTimersByTimeAsync`)
- **What:** Integration tests rely heavily on knowing the exact number of microtask ticks and debounce timing to observe side effects. Tests like "advance 60001ms, await, await, mockClear, advance 1000ms" are fragile to timing changes.
- **Why it matters:** If you change `PUSH_DEBOUNCE_MS` or add an intermediate async step to `pushImmediate`, multiple tests may break for reasons unrelated to the behavior they assert. The test suite tests implementation timing, not just observable behavior.
- **Recommendation:** This is an inherent tension for VS Code extension testing where you mock timers and async IPC. It is not broken -- the tests pass and cover real edge cases. If the orchestrator extraction (concern 1) happens, the state machine tests could assert against a synchronous state snapshot rather than counting IPC calls through fake timers. Until then, accept the coupling as a known cost.
- **Effort:** LARGE (only addressable alongside concern 1)
- **Priority:** MAYBE

## Cross-Cutting Consistency

**Error handling:** Consistently silent. The non-issues registry documents this as a design invariant ("Discord is optional... never surfaces errors to the user"). Every catch block either swallows silently or returns a falsy sentinel. This is coherent for a presence extension -- the correct behavior on any failure is "show nothing, try again later." No inconsistencies found.

**Configuration:** All settings flow through a single `readConfig()` function with defensive parsing (type coercion, clamping, sanitization). Changes propagate through `onConfigChange -> handleConfigChange -> computeConfigTransition`. No direct `vscode.workspace.getConfiguration` calls outside `config.ts`. Fully consistent.

**State management:** Single mutable `State` object created in `activate`, passed by reference to pure functions. Module-level `let` bindings in `extension.ts` hold timers and flags. No global singletons beyond the extension module scope. The `discord-client` module holds its own module-level state (client instance, connection intent flag), which is appropriate for an IO boundary.

**Logging/observability:** None. No `console.log`, no output channel, no telemetry. This is documented as intentional ("No telemetry, ever"). For a v1.0 extension with "silently does nothing if Discord isn't running" as a feature, this is the right call. If debugging user-reported issues becomes painful, a togglable debug output channel could help, but that is not a structural concern today.

**Serialization boundaries:** The only serialization is JSON for the instance-lock file and the Discord RPC payload. Both are handled at their respective module boundaries. No leakage.

## Tech Stack Fit

The stack is well-matched to the problem:

- **TypeScript + strict mode** for a VS Code extension with complex state logic -- correct choice. The type system catches a class of state-machine bugs at compile time.
- **esbuild** for bundling -- appropriate. The extension has no complex import patterns that would need webpack's plugin ecosystem. Single entry point, single output, fast builds.
- **Vitest** with fake timers for testing async state machines -- good fit. The timer mocking and module aliasing work cleanly.
- **@xhayper/discord-rpc** -- the only maintained Discord RPC library for Node.js that handles IPC socket discovery and protocol formatting. Correct choice; the alternative would be hand-rolling the IPC protocol.

No cases of fighting the tools. The VS Code extension API is used idiomatically (event subscriptions, disposable pattern, configuration contribution points). The `formatActivity` bypass in `discord-client.ts` works around a library quirk (hardcoded `created_at: Date.now()`) at the correct layer -- the module owns the library interaction and contains the workaround.

## Recommendations Summary

| # | Priority | Effort | Area | Recommendation |
|---|----------|--------|------|----------------|
| 1 | LATER | MEDIUM | `extension.ts` | Extract state-machine coordination into an instantiable controller when the next stateful feature lands |
| 2 | LATER | SMALL | `presence.ts` | Split language metadata into its own `languages.ts` module to prepare for framework detection |
| 3 | MAYBE | LARGE | `test/extension.test.ts` | Reduce timing coupling in integration tests (contingent on concern 1) |

---

**Bottom line:** This is a clean, well-scoped architecture for a v1.0 extension. The module boundaries are honest, the dependency count is minimal, the pure-function core is testable, and the IO boundaries are well-defined. The concerns listed above are forward-looking maintenance items, not active pain points. Ship features; refactor when the seams strain.
