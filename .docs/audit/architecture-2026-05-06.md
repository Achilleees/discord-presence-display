# Architecture Review — Coding Status for Discord (`discord-presence-display`)
**Date:** 2026-05-06
**Language/Stack:** TypeScript (strict, ES2021/CommonJS) + esbuild + Vitest + `@xhayper/discord-rpc` on the VS Code extension host (Node 18 target).
**Codebase size:** 9 source files, ~1,990 LOC in `src/`; 6 test files, ~1,805 LOC in `test/`. Single dependency outside dev tooling. No package boundaries, no monorepo.
**Overall assessment:** This is a well-structured single-purpose VS Code extension that has clearly benefited from the recent audit cycles — module boundaries are sharp, the pure/imperative split (transitions vs. extension entry) is textbook, and the test surface is unusually thorough for an extension of this size. The architecture is *deliberately* thin: one IPC adapter, one config reader, one pure transition computer, one entry-point orchestrator. The main structural concern is that `src/extension.ts` (608 LOC) has quietly become a god module — it owns mutable module-level state for cycle/reconnect/idle/lock/debounce/push-mutex/debug-set in eight separate variables and is the only place where concurrency invariants are enforced. The architecture worked beautifully through 1.0.x; it will start to bend at the seams the moment per-context cycle speeds, framework detection, or a second presence backend lands. Two MEDIUM-effort refactors (extract a `Coordinator` from `extension.ts`; extract a `presence-cycler` from the lifecycle hooks) would put the project in shape for the next phase without touching anything that already works.

---

## Structure Map

```
discord-presence-display/
├── src/                              # 9 files, ~1,990 LOC
│   ├── extension.ts        (608)     # ENTRY: lifecycle, mutable state, all event wiring
│   ├── words.ts            (449)     # Word data + buildPool + getNextWord (pure)
│   ├── discord-client.ts   (260)     # IPC adapter: connect/push/clear, dedup, deadlines
│   ├── presence.ts         (238)     # buildPresencePayload + language tables (pure)
│   ├── instance-lock.ts    (165)     # Cross-window single-primary lock (FS-based)
│   ├── config.ts           ( 95)     # readConfig + sanitizeCustomWords
│   ├── transitions.ts      ( 94)     # computeConfigTransition (pure)
│   ├── state.ts            ( 68)     # State shape + RingBuffer
│   └── commands.ts         ( 13)     # registerCommands wrapper
│
├── test/                             # 6 files, ~1,805 LOC; vitest with vscode alias
│   ├── extension.test.ts   (789)     # Behavioral integration tests
│   ├── presence.test.ts    (309)     # Smart-state rule matrix
│   ├── transitions.test.ts (223)     # Pure transition tests
│   ├── words.test.ts       (193)     # Picker / pool tests
│   ├── discord-client.test.ts(155)   # IPC mock tests
│   ├── config.test.ts      (136)     # Sanitization tests
│   └── mocks/vscode.ts     (185)     # Hand-rolled VS Code API double
│
├── assets/discord/                   # Discord uploadable assets
│   ├── languages/                    # 43 SVG + 43 PNG language icons
│   ├── claude-logo.{svg,png}         # Fallback icon
│   ├── vscode-spinner.{svg,png}      # Large image
│   └── convert.sh                    # One-shot SVG→PNG dev utility
│
├── .github/workflows/publish.yml     # On-release marketplace publish
├── .docs/audit/                      # decisions.md + non-issues.md (gitignored audit reports)
├── release.sh                        # Patch/minor/major release pipeline
├── esbuild.config.mjs                # Single-file CJS bundle for VSIX
├── package.json                      # Manifest + 13 user-facing settings
└── ROADMAP.md, CHANGELOG.md, README.md
```

### Conceptual layers

```
                         ┌──────────────────────────┐
                         │      VS Code APIs        │
                         └──────────────┬───────────┘
                                        │
                                        ▼
        ┌────────────────────── extension.ts (orchestrator) ──────────────────────┐
        │   - mutable state (8+ module-level let bindings)                        │
        │   - event wiring, debouncer, push mutex, idle/lock/reconnect timers     │
        │   - sole call site for every other module                               │
        └─────────┬────────────┬────────────┬───────────┬───────────┬─────────────┘
                  │            │            │           │           │
       ┌──────────▼─┐  ┌───────▼──────┐  ┌──▼───────┐  ┌▼───────┐  ┌▼───────────┐
       │ config.ts  │  │ transitions  │  │ presence │  │ state  │  │ commands   │
       │  (PURE)    │  │   (PURE)     │  │  (PURE)  │  │  (DTO) │  │ (3 lines)  │
       └────────────┘  └──────────────┘  └────┬─────┘  └────────┘  └────────────┘
                                              │
                                       ┌──────▼─────┐
                                       │  words.ts  │
                                       │   (PURE)   │
                                       └────────────┘

       ┌────────────────────────────┐    ┌────────────────────────────┐
       │     discord-client.ts      │    │     instance-lock.ts       │
       │   (IO: IPC adapter)        │    │   (IO: FS-based lock)      │
       └────────────────────────────┘    └────────────────────────────┘
```

The pure modules form a clean lower layer; the IO modules sit beside `extension.ts`; nothing imports back upward.

---

## What Works Well

**1. Pure-function transition computer (`transitions.ts`).** Encoding config-change semantics as `computeConfigTransition(prev, next, ctx) → ConfigTransition` flag bag is the strongest architectural choice in the codebase. It moves the most invariant-sensitive logic out of imperative event handlers and into a place where it can be tested exhaustively (and is, in `transitions.test.ts`). Keep this pattern. If anything, lean harder on it.

**2. Effect-free presence builder (`presence.ts`, `words.ts`).** `buildPresencePayload` and `pickCandidateWord` take state + config + word and return a payload or candidate. They have zero side effects, no VS Code imports, no Discord imports. That makes the smart-state rule matrix and rarity/time-tier weighting trivially testable in isolation. The README's documented "smart-state priority" maps 1:1 onto the function's branching, and the LANG_DISPLAY/LANG_ID_OVERRIDES two-table lookup (icon vs. display name) is correctly factored.

**3. IPC adapter encapsulates a real bug fix.** `discord-client.ts` exists explicitly because `@xhayper/discord-rpc`'s `setActivity` injects `created_at: Date.now()` per call, causing visible flicker. The `formatActivity` workaround is documented in module-header comments, has a stable `sessionCreatedAt`, and is gated behind `pushPresence`. Wrapping a third-party library to fix a defect rather than forking it is the right call at this scale.

**4. Dependency hierarchy is acyclic and shallow.** Every internal dep flows downward: `extension.ts → {config, state, presence, transitions, commands, discord-client, instance-lock}`, and `presence.ts → {state, words, config}`. No circular imports, no skip-layer reach-around (e.g., `presence.ts` does not import `discord-client.ts`). The dependency direction matches the conceptual layering.

**5. Extremely small external dependency surface.** One runtime dep (`@xhayper/discord-rpc`), and dev tooling that's all first-tier (`esbuild`, `vitest`, `@vscode/vsce`, `typescript`). Zero "utility" libraries. Zero polyfills. For a VS Code extension shipped as a single bundled file, this is exactly right.

**6. Hand-rolled VS Code mock.** `test/mocks/vscode.ts` is small, transparent, and uses a vitest alias to intercept the `vscode` import. This dodges the heavyweight `@vscode/test-electron` runtime and keeps unit tests fast. The `__setConfig`/`__emitConfigChange`/`__setFocused` test helpers form a clean test harness — extending it for new event types is mechanical.

**7. Build/distribution pipeline is well-shaped.** esbuild produces a single bundled `dist/extension.js`, VSIX is built and uploaded to GitHub Releases by `release.sh`, and a dedicated `publish.yml` workflow downloads the release asset and publishes to VS Code Marketplace (and Open VSX, when the secret lands). VSIX is not in git. This is the right separation: source repo, release artifacts, marketplace.

**8. Audit hygiene is unusually mature.** The `.docs/audit/non-issues.md` and `.docs/audit/decisions.md` registries are a *project artifact*, not just notes. Pre-classifying intentional patterns (silent Discord failures, case-sensitive custom-word dedup, lock-file TOCTOU, etc.) so future scanners skip them is a form of architecture documentation that most projects never write down. This pays for itself every audit cycle.

**9. README documents user-facing behavior precisely.** Smart-state priority rules, idle behaviors, custom-word case sensitivity, and privacy posture are all stated in language that maps onto the code. The contract is clear; deviations are catchable.

---

## Dependency Health

### Internal

The internal dependency graph is a tree, not a web — which is exactly what you want at this scale.

```
extension.ts ──┬── config.ts                    (Config type, readConfig, onConfigChange)
               ├── state.ts                     (State, FocusContext, createState)
               ├── presence.ts ──┬── words.ts   (buildPool, getNextWord)
               │                 ├── state.ts
               │                 └── config.ts
               ├── transitions.ts ── config.ts  (Config type only)
               ├── commands.ts                  (registerCommands)
               ├── discord-client.ts            (no internal deps)
               └── instance-lock.ts             (no internal deps)
```

**Strengths:**
- No cycles.
- `discord-client.ts` and `instance-lock.ts` are zero-internal-dep leaves — they could each be lifted to standalone npm packages with minimal effort.
- Pure modules (`words`, `presence`, `transitions`, `config`, `state`) only import types or other pure modules.
- `commands.ts` is a 13-line shim over `vscode.commands.registerCommand` whose only job is dependency injection (`CommandDeps.togglePaused`). At first glance this looks like over-abstraction, but the trade-off is fair: it gives `extension.test.ts` a way to test command handlers without touching VS Code's command registry directly.

**Concerns:** see the Structural Concerns section below — the issue is *concentration in `extension.ts`*, not unhealthy edges.

### External

| Dep | Role | Health | Verdict |
|---|---|---|---|
| `@xhayper/discord-rpc` ^1.3.0 | Runtime: Discord IPC | Maintained TypeScript fork of `discord-rpc`; modern API | Right choice — actively maintained, TypeScript-native, a thin wrapper around `node:net` IPC |
| `@types/node` ^25 | Dev: Node typings | Tracking current Node | OK |
| `@types/vscode` ^1.85 | Dev: VS Code API types | Matches `engines.vscode` | OK |
| `@vscode/vsce` ^3 | Dev: VSIX packager | First-party | Required |
| `esbuild` ^0.28 | Dev: bundler | Active, fast | Right choice — a Webpack/Rollup setup would be 100× the config for zero benefit |
| `typescript` ^5.5 | Dev: TS compiler | Current | Required |
| `vitest` ^3 | Dev: test runner | Current | Right choice — Jest would slow this down for no benefit, `@vscode/test-electron` would be overkill |

Zero redundancy. No abandoned packages. No utility-library bloat (no lodash, no rxjs, no immer). No transitive risk surface beyond what `@xhayper/discord-rpc` brings. This is one of the leanest dependency footprints I've seen for a shipping VS Code extension.

One note: `@xhayper/discord-rpc` is the *single* runtime dependency, and the project has already had to wrap it (`formatActivity`) to fix a `created_at: Date.now()` flicker. If that library ever stalls, the extension owns its own IPC implementation in spirit if not in code — the wrapper sets the precedent for a clean swap.

---

## Structural Concerns

### `extension.ts` is becoming a god module

- **Where:** `src/extension.ts` (608 LOC, ~30% of the codebase, 8 module-level mutable bindings).
- **What:** A single file owns the extension lifecycle, all event-listener wiring, the push debouncer, the push-in-flight mutex (`pushing` / `pushDirty` / `pushDirtyBypass`), the cycle interval, the reconnect timer, the idle timer, the lock-check interval, the debug-session set, the focus-source memory, and the `currentClientId` symbol used to invalidate stale callback closures. It's the only place that enforces the contracts the README documents — the rest of the codebase computes them but does not run them.
- **Why it matters:** This works *today* because the contract surface is fixed. The moment something on the roadmap lands — per-context cycle speeds, framework detection, terminal focus icon, keybindings — it lands in this file, because that's where state lives. The next feature with a state component will push the file past 700 LOC and the cognitive load past comfortable. Already, three of the trickiest concurrency invariants in the project are enforced by re-reads after `await` boundaries (`if (!state || !config) return` after each IPC call) — that pattern is hard to extend without forgetting a guard.
- **Recommendation:** Extract a `Coordinator` (or `PresenceController`) class that owns the mutable state and the push/cycle/idle/reconnect/lock methods. `activate(context)` becomes "construct the coordinator, wire VS Code listeners to coordinator methods, register disposables." The coordinator's public surface is small (~10 methods: `start`, `stop`, `togglePaused`, `onConfigChange`, `onFocusChange`, `onLanguageChange`, `onTerminalChange`, `onTabChange`, `onDebugStart`, `onDebugEnd`). Internal state stays private. This unlocks: per-instance state for tests (no module-level reset dance), clearer mental model for new features, easier reasoning about timer ownership.
- **Effort:** MEDIUM
- **Priority:** SOON

### Push-mutex / debounce / dirty-bit machinery is implicit

- **Where:** `src/extension.ts:70-181` (`pushImmediate`, `schedulePush`, `clearPushDebounce`, the `pushing`/`pushDirty`/`pushDirtyBypass` triplet).
- **What:** The serialization scheme around `pushImmediate` is a hand-rolled re-entrant queue with a "bypass" bit to carry through idle-pause. It's correct, well-commented, and tested — but it's a primitive that's open-coded across ~110 lines and intermixed with idle-clear / idle-pause / paused / language-rebinding logic, plus three "guard against deactivate racing in-flight" re-checks scattered through the body. Anyone touching this needs to hold the whole state machine in their head.
- **Why it matters:** This is a single primitive doing four jobs (mutex, debounce, retry, bypass-tag). It's the most fragile concurrency surface in the project, and it's the part most likely to be revisited when "per-context cycle speeds" or "framework detection" introduces additional async sources that need to coexist with cycle ticks.
- **Recommendation:** When you do the `Coordinator` extraction, lift this into a small `PushQueue` helper with an explicit interface: `enqueue(opts) → Promise<void>`, internal mutex + dirty bits + bypass bit. ~50 LOC, fully unit-testable in isolation, removes ~110 LOC and three scattered guards from `extension.ts`. Optional: a Jest-style "run in microtask" test verifies the re-entrant retry semantics directly without the full extension boot.
- **Effort:** SMALL (after Coordinator extraction); MEDIUM (standalone)
- **Priority:** SOON

### `presence.ts` has dual responsibility (smart-state rules + language tables)

- **Where:** `src/presence.ts:21-169` (LANG_SUPPORTED, LANG_ID_OVERRIDES, LANG_DISPLAY, normalizeLang, getLanguageIconKey, getLanguageDisplayName) vs. `:171-238` (buildStateLine, buildPresencePayload, pickCandidateWord re-export).
- **What:** Half the file is language-mapping data (43 supported, 50+ entries in display table, normalization rules) and half is the smart-state rule engine. The two concerns share no logic — one is data lookup, the other is README-rule branching.
- **Why it matters:** Adding a language is a one-line edit but requires editing in three places (LANG_SUPPORTED, LANG_DISPLAY, LANG_ID_OVERRIDES if dialect). Adding a smart-state rule (e.g., notebook focus, chat panel) lives in `buildStateLine`. They're updated by different kinds of changes, but the file forces them together. If the roadmap "framework detection beyond `languageId`" lands, this file grows in a direction that's already the file's weaker dimension.
- **Recommendation:** Split into `presence/languages.ts` (tables + normalize/getIconKey/getDisplayName) and `presence/state-line.ts` (buildStateLine + buildPresencePayload + pickCandidateWord). Or keep `presence.ts` as a barrel re-export. Low risk, opens room for framework detection without bloating one file.
- **Effort:** SMALL
- **Priority:** LATER

### `state.ts` mixes a DTO and a generic data structure

- **Where:** `src/state.ts:1-17` defines `RingBuffer<T>` alongside the `State` interface and `createState` factory.
- **What:** `RingBuffer` is a generic FIFO with capacity. It's used exactly once (recent-words anti-duplicate ring). It lives in the file that owns extension state.
- **Why it matters:** Trivial — the RingBuffer doesn't *belong* in state.ts conceptually, but moving it adds an import without changing behavior. The current placement is mildly odd but harmless.
- **Recommendation:** Leave it for now. Only worth moving if a second consumer appears. Calling it out for the record.
- **Effort:** SMALL
- **Priority:** MAYBE

### Single shared client-id constant; no abstraction over presence backend

- **Where:** `src/extension.ts:10` — `const CLIENT_ID = '1494346699861397636'`.
- **What:** The Discord application ID is a hardcoded string in the entry module. Discord-specific concerns (CLIENT_ID, the IPC pipe, the activity payload shape) leak into both `extension.ts` and `discord-client.ts`. This is fine for "Discord, only Discord, forever."
- **Why it matters:** The README and project name are explicitly Discord-specific, and the roadmap doesn't suggest other backends. So this isn't a real concern *unless* the project ever wants to support Slack status, Lanyard, or a generic webhook. Mentioning it because changing your mind later costs more if presence-target abstraction was never even considered.
- **Recommendation:** Don't add an abstraction speculatively. Note this as a known coupling. If a second backend is ever requested, the natural seam is between `discord-client.ts` (Discord-specific IPC) and a not-yet-existing `presence-publisher.ts` interface that `discord-client` implements. `extension.ts` would call the publisher; the constant moves into the Discord implementation.
- **Effort:** N/A unless a second backend is in scope
- **Priority:** MAYBE

### `instance-lock.ts` solves a problem that isn't the extension's problem

- **Where:** `src/instance-lock.ts` (165 LOC) + lifecycle integration in `extension.ts:246-269`.
- **What:** A filesystem-based primary-window lock prevents two VS Code windows from racing to set the same Discord presence. It's well-engineered (PID liveness check, EPERM-on-Windows handling, stale recovery, retry-with-backoff against NTFS deletion latency, heartbeat-driven refresh).
- **Why it matters:** This is a genuinely tricky problem solved cleanly — but the integration in `extension.ts` (`acquireOrWatch`, `startLockCheck`, `stopLockCheck`, the `isPrimary` flag, the secondary-mode polling loop) is part of why `extension.ts` is large. The lock module itself is well-bounded; the *coordination* with extension lifecycle is what costs LOC.
- **Recommendation:** Keep the module as-is — it's good. When extracting the `Coordinator`, the primary/secondary state and the polling timer should move into the coordinator's lifecycle, not back-leak into extension.ts. Optional: consider whether secondary windows should run a degraded mode (e.g., still update local state) vs. the current "do nothing" — this is a product decision, not architecture.
- **Effort:** SMALL (folds into Coordinator extraction)
- **Priority:** LATER

### Test mock surface is implicit and growing

- **Where:** `test/mocks/vscode.ts` (185 LOC).
- **What:** The hand-rolled VS Code mock is a great choice — but it now covers 8 event listener types, mutable window/workspace/debug state, and 10+ `__test__` helpers. There's no contract test verifying it stays in sync with the real `@types/vscode` shape, and the test file structure assumes one shared `extension` module instance per file (because module-level `let` bindings in `extension.ts` make per-test isolation hard).
- **Why it matters:** When VS Code 1.95+ or 2.x changes an event signature, the mock will silently lie. This isn't a today-problem — it's a "you'll discover it through a test that should have failed but didn't" problem.
- **Recommendation:** Two options. (a) Add a typecheck-only "shape conformance" file — `import * as vscode from 'vscode'; const _: typeof vscode = realMock;` — that fails at `tsc --noEmit` if the mock drifts from the typings. (b) Move per-instance state into `Coordinator` (see top concern) so tests can construct their own instance and the mock can be reset cleanly between tests without the `__resetEvents` ritual. Option (b) is the better long-term answer.
- **Effort:** SMALL (option a) / MEDIUM (option b, included in Coordinator extraction)
- **Priority:** LATER

### Two unresolved README-contract questions still tracked in `decisions.md`

- **Where:** `.docs/audit/decisions.md` items 46-B5 (`startTimestamp` reset on enable cycle) and 47-E2 (`recentWords` commit unconditional in cycling mode).
- **What:** Both are documented as DISPUTED by prior audits. They surface because the README doesn't define what "session" means precisely enough to decide whether the elapsed timer should reset on disable→enable cycles, and because the extension's anti-duplicate ring records words regardless of whether Discord acknowledged them.
- **Why it matters:** These are not code bugs — they are *contract* gaps. As long as they're undocumented, every audit will surface them again. They consume audit attention without converging.
- **Recommendation:** Decide the contract, write it into the README. Two sentences. Then the code either matches or gets one targeted fix. This is a one-hour task that closes an open feedback loop.
- **Effort:** SMALL
- **Priority:** SOON

---

## Cross-Cutting Consistency

**Error handling.** Consistent and intentional: every Discord-touching boundary uses fire-and-forget (`.catch(() => {})`) plus deadline-bounded races (`raceWithDeadline`, 8s IPC deadline). The pattern is documented in `non-issues.md` ("Discord is optional...never surfaces errors to the user"). The sole place this could go wrong — IPC hanging forever — has explicit deadline guards. Filesystem errors in `instance-lock.ts` are similarly swallowed by design. **Verdict: clean.**

**Configuration.** Centralized in `config.ts` with `readConfig()` returning a frozen-by-convention DTO. The `onConfigChange` listener emits the new DTO; `transitions.ts` computes diffs. Sanitization is in one place (`sanitizeCustomWords`). The 13 settings in `package.json` schema are mirrored into the `Config` interface. **Verdict: clean.**

**Logging / observability.** None. The README explicitly says "no telemetry." For a VS Code extension that "silently does nothing if Discord isn't running," this is the correct choice — adding logging would invite the question of where it goes. **Verdict: intentional absence; appropriate.**

**State management.** Centralized in `state.ts` (`State` interface) and lives in `extension.ts` as a single `let state: State | undefined`. Every event handler re-checks `state` after async boundaries. The discipline is consistent across the file but is the kind of pattern that breaks the moment a contributor forgets a re-check. The proposed Coordinator extraction would make this a private field rather than a guard everywhere. **Verdict: works but fragile; primary concern in Structural Concerns above.**

**Data serialization boundaries.** Two boundaries: (a) VS Code config → `Config` DTO via `readConfig`/`sanitizeCustomWords`, (b) `Config + State + word → SetActivity` payload via `buildPresencePayload` then through `formatActivity` to the IPC wire format. Both are pure functions, both are well-tested, both have clear input/output types. **Verdict: clean.**

---

## Tech Stack Fit

**TypeScript strict + ES2021 + CommonJS.** Right for a VS Code extension. CJS is what `vscode.engines >= 1.85` expects out of `dist/extension.js`. Strict TS catches the kind of "did I forget to handle undefined" errors that `extension.ts`'s state-after-await pattern depends on.

**esbuild for bundling.** Right call. Extensions ship one file; esbuild produces it in milliseconds; configuration is 27 lines. A Webpack/Rollup/Vite setup would add hundreds of lines of config for zero observable benefit on a 9-file source tree.

**Vitest + alias-mocked vscode.** Right call. `@vscode/test-electron` would be the "official" choice but boots an actual VS Code instance — slow, brittle, overkill for a project where the only VS Code-specific behavior is event subscription. The hand-rolled mock has paid for itself many times over.

**`@xhayper/discord-rpc`.** Right call. The maintained TypeScript fork of `discord-rpc`. The library has known quirks (`created_at` flicker, optional chaining on `client.user`); the codebase wraps both and documents both. There is no obviously better choice.

**No linter config in repo.** The codebase clearly follows a consistent style and the test files include `eslint-disable` directives, suggesting ESLint is run somewhere — but there's no `eslint.config.js` checked in. This is a SMALL/LATER cleanup, but worth noting for a marketplace-published extension.

**No PR-validation CI** (per ROADMAP.md). `publish.yml` only fires on release. There's no workflow that runs `npm test && npm run typecheck && npm run build` on every PR. This is on the roadmap and it should be the next CI work.

---

## Recommendations Summary

| # | Priority | Effort | Area | Recommendation |
|---|----------|--------|------|----------------|
| 1 | SOON | MEDIUM | `extension.ts` | Extract `Coordinator` class to own mutable state and lifecycle methods; reduce `extension.ts` to wiring + listener registration |
| 2 | SOON | SMALL | `extension.ts` | Lift the push mutex/debounce/dirty-bit into a `PushQueue` helper (folds into Coordinator extraction) |
| 3 | SOON | SMALL | `.docs/audit/decisions.md` | Resolve the two outstanding README-contract questions (`startTimestamp` reset on re-enable; `recentWords` commit semantics) — write the contract, code follows |
| 4 | LATER | SMALL | `presence.ts` | Split into `presence/languages.ts` and `presence/state-line.ts` (or a barrel) before framework detection lands |
| 5 | LATER | SMALL | `test/mocks/vscode.ts` | Add a `typeof vscode` conformance assertion file to catch mock drift against `@types/vscode` |
| 6 | LATER | SMALL | `instance-lock.ts` | Fold primary/secondary lifecycle into the new Coordinator (works in concert with #1) |
| 7 | LATER | SMALL | CI | Add PR-validation workflow (`npm test && npm run typecheck && npm run build`) — already on the roadmap |
| 8 | MAYBE | SMALL | `state.ts` | Move `RingBuffer<T>` to its own file once a second consumer exists; not before |
| 9 | MAYBE | LARGE | architecture | If a non-Discord backend ever materializes, factor `discord-client.ts` behind a `PresencePublisher` interface; do not do this speculatively |

**Headline:** Lean, well-shaped extension architecture with one growing-pain — `extension.ts` is the god module that the rest of the codebase deliberately avoided becoming, and the next feature is what will force its hand.
