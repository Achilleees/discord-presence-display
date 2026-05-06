import * as vscode from 'vscode';
import * as discord from './discord-client';
import { readConfig, onConfigChange, type Config } from './config';
import { createState, type FocusContext, type State } from './state';
import { buildPresencePayload, pickCandidateWord } from './presence';
import { computeConfigTransition } from './transitions';
import { registerCommands } from './commands';
import { tryAcquire, release } from './instance-lock';

const CLIENT_ID = '1494346699861397636';
const RECONNECT_MS = 30_000;
const LOCK_CHECK_MS = 30_000;
const PUSH_DEBOUNCE_MS = 750;
const IDLE_SLOW_MAX_SECONDS = 120;
const IDLE_SLOW_MULTIPLIER = 4;

let state: State | undefined;
let config: Config | undefined;
let cycleInterval: ReturnType<typeof setInterval> | undefined;
let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
let idleTimeout: ReturnType<typeof setTimeout> | undefined;
let pushDebounce: ReturnType<typeof setTimeout> | undefined;
let lastInteractedSource: 'editor' | 'terminal' = 'editor';
let currentClientId: symbol | undefined;
let lockCheckInterval: ReturnType<typeof setInterval> | undefined;
let isPrimary = false;
let pushing = false;
let pushDirty = false;
let pushDirtyBypass = false;
let pushDirtyUseLastWord = false;
// Track active debug session ids so we don't depend on VS Code's undocumented
// event ordering around vscode.debug.activeDebugSession updates.
const activeDebugSessions = new Set<string>();

function getWorkspaceName(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  // In multi-root workspaces, prefer the folder containing the active
  // editor — folders[0] would otherwise leak the wrong folder name when
  // the user is editing a file outside the first folder. Privacy-relevant:
  // the leaked name should be the one the user is actually working in.
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const owning = vscode.workspace.getWorkspaceFolder(activeUri);
    if (owning) return owning.name;
  }
  return folders[0].name;
}

function instanceOfMaybe(input: unknown, name: 'TabInputTextDiff' | 'TabInputTextMultiDiff'): boolean {
  const Ctor = (vscode as unknown as Record<string, new (...a: unknown[]) => unknown>)[name];
  return typeof Ctor === 'function' && input instanceof Ctor;
}

function isDiffTab(tab: vscode.Tab | undefined): boolean {
  if (!tab) return false;
  return instanceOfMaybe(tab.input, 'TabInputTextDiff') || instanceOfMaybe(tab.input, 'TabInputTextMultiDiff');
}

function computeFocusContext(): FocusContext {
  // Last user action wins: if the user most recently interacted with the
  // terminal and a terminal is still present, prefer 'terminal' over a
  // visually-active diff tab.
  if (lastInteractedSource === 'terminal' && vscode.window.activeTerminal) return 'terminal';
  if (isDiffTab(vscode.window.tabGroups.activeTabGroup?.activeTab)) return 'diff';
  if (vscode.window.activeTextEditor) return 'editor';
  if (vscode.window.activeTerminal) return 'terminal';
  return 'none';
}

async function pushImmediate(
  opts: { bypassIdleSilence?: boolean; useLastWord?: boolean } = {},
): Promise<void> {
  if (!state || !config) return;
  if (!discord.isReady()) return;
  // Serialize pushes so a slow setActivity can't race with a subsequent
  // cycle tick and produce two overlapping payloads. If another push is
  // requested while we're busy, remember it and fire a debounced retry
  // after the current one completes — so config/event changes during a
  // slow IPC round-trip aren't silently dropped.
  if (pushing) {
    pushDirty = true;
    if (opts.bypassIdleSilence) pushDirtyBypass = true;
    // Capture useLastWord so the retry preserves the caller's intent —
    // otherwise an idle-pause push that landed during an in-flight cycle
    // tick would silently swap the displayed word for a fresh pick on
    // the retry, violating the "last presence stays visible" contract.
    if (opts.useLastWord) pushDirtyUseLastWord = true;
    return;
  }
  pushing = true;
  try {
    if (!state || !config) return;

    // Idle-clear contract: never push a new payload while idle-clear is in
    // effect; ensure the presence stays cleared.
    if (state.isIdle && config.idleBehavior === 'clear') {
      await discord.clearPresence();
      return;
    }

    // Idle-pause contract: stay silent. resumeAfterReady may opt out to
    // push once on reconnect (Discord forgot our presence during the
    // disconnect, so we restore visibility).
    if (state.isIdle && config.idleBehavior === 'pause' && !opts.bypassIdleSilence) {
      return;
    }

    // Re-read the active editor's language every push. Direct assignment
    // (not `?? state.currentLanguage`) so that closing the last editor
    // propagates to state.currentLanguage = undefined, matching plan rule
    // 5. VS Code's `activeTextEditor` stays sticky while focus is on a
    // terminal, so this doesn't drop the language during terminal focus.
    state.currentLanguage = vscode.window.activeTextEditor?.document.languageId;

    // useLastWord pins the displayed word across transitions where the
    // README promises continuity (idle→pause). Falls back to a fresh
    // pick when nothing has ever been delivered yet. Elapsed time uses
    // the monotonic baseline so NTP corrections / sleep-resume cannot
    // flip time-tier classification mid-session (would otherwise let
    // elapsedMs go negative and reclassify a deep-session as warming).
    const elapsedMs = performance.now() - state.startMonotonicMs;
    const word = opts.useLastWord && state.lastWord
      ? state.lastWord
      : pickCandidateWord(state, config, elapsedMs);
    const payload = buildPresencePayload(state, config, word);
    if (payload === null) {
      await discord.clearPresence();
      return;
    }

    const delivered = await discord.pushPresence(payload);

    // Guard against deactivate racing with an in-flight push.
    if (!state || !config) return;

    // If idle-clear engaged between our pick and the push (another handler
    // fired clearPresence), don't commit — Discord is now in the cleared
    // state and recording the word would desynchronize our picker from
    // what the user actually saw.
    if (state.isIdle && config.idleBehavior === 'clear') return;

    // If togglePaused fired during the IPC roundtrip, presence is now
    // cleared — same logic as the idle-clear guard above. In pinned mode
    // we'd otherwise resurrect a stale pinnedWord on the next unpause;
    // in cycling mode the picker would advance against a word Discord
    // never showed.
    if (state.paused) return;

    // For cycling: commit to the ring regardless of push success so the
    // anti-duplicate picker advances. For pinned mode: only commit if
    // pushPresence reported success — a transient IPC write failure
    // shouldn't pin a word Discord never displayed.
    if (config.cycleWords) state.recentWords.add(word);
    else if (delivered) state.pinnedWord = word;
    if (delivered) state.lastWord = word;
  } finally {
    pushing = false;
    if (pushDirty) {
      pushDirty = false;
      if (pushDirtyBypass) {
        pushDirtyBypass = false;
        const useLastWord = pushDirtyUseLastWord;
        pushDirtyUseLastWord = false;
        // Retry the bypass push immediately (not debounced) — schedulePush
        // would drop the bypass bit and silently swallow the push against
        // the idle-pause silence guard.
        void pushImmediate({ bypassIdleSilence: true, useLastWord });
      } else {
        // schedulePush always picks fresh; useLastWord is a same-push
        // pinning intent that doesn't survive a 750ms debounce. Drop the
        // flag rather than letting it leak into a future call.
        pushDirtyUseLastWord = false;
        schedulePush();
      }
    }
  }
}

function clearPushDebounce(): void {
  if (pushDebounce) {
    clearTimeout(pushDebounce);
    pushDebounce = undefined;
  }
}

function schedulePush(): void {
  clearPushDebounce();
  pushDebounce = setTimeout(() => {
    pushDebounce = undefined;
    void pushImmediate();
  }, PUSH_DEBOUNCE_MS);
}

function computeIntervalMs(): number {
  if (!config) return 15_000;
  let seconds = config.cycleSpeed;
  if (state?.isIdle && config.idleBehavior === 'slow') {
    seconds = Math.min(seconds * IDLE_SLOW_MULTIPLIER, IDLE_SLOW_MAX_SECONDS);
  }
  return seconds * 1000;
}

function startCycle(): void {
  stopCycle();
  if (!config || !state || state.paused) return;
  if (!config.cycleWords) return;
  // Idle-pause and idle-clear contracts forbid cycling; don't start an
  // interval that would resurrect the cycle just because a cycleSpeed or
  // cycleWords config change asked for a restart.
  if (state.isIdle && (config.idleBehavior === 'pause' || config.idleBehavior === 'clear')) return;
  // No point in ticking if Discord isn't listening — avoid a zombie
  // interval calling pushImmediate that just bails on !isReady.
  if (!discord.isReady()) return;

  cycleInterval = setInterval(() => {
    void pushImmediate();
  }, computeIntervalMs());
}

function stopCycle(): void {
  if (cycleInterval) {
    clearInterval(cycleInterval);
    cycleInterval = undefined;
  }
}

function clearReconnect(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = undefined;
  }
}

function clearIdleTimer(): void {
  if (idleTimeout) {
    clearTimeout(idleTimeout);
    idleTimeout = undefined;
  }
}

function scheduleReconnect(): void {
  if (reconnectTimeout) return;
  if (!config?.enabled || !isPrimary) return;
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = undefined;
    void connectFlow();
  }, RECONNECT_MS);
}

function stopLockCheck(): void {
  if (lockCheckInterval) {
    clearInterval(lockCheckInterval);
    lockCheckInterval = undefined;
  }
}

function startLockCheck(): void {
  stopLockCheck();
  lockCheckInterval = setInterval(() => {
    if (!config?.enabled) return;
    if (tryAcquire()) {
      isPrimary = true;
      stopLockCheck();
      if (!state) return;
      state.isIdle = !vscode.window.state.focused;
      void connectFlow();
      onWindowStateChange();
    }
  }, LOCK_CHECK_MS);
}

function acquireOrWatch(): void {
  if (tryAcquire()) {
    isPrimary = true;
    void connectFlow();
    onWindowStateChange();
  } else {
    isPrimary = false;
    startLockCheck();
  }
}

async function connectFlow(): Promise<void> {
  if (!config?.enabled || !isPrimary) return;

  const myId = Symbol('client');
  currentClientId = myId;
  const isCurrent = () => currentClientId === myId;

  try {
    await discord.connect(CLIENT_ID, {
      onReady: () => {
        if (!isCurrent()) return;
        if (!config?.enabled || !state) return;
        clearReconnect();
        // resumeAfterReady calls startCycle (which calls stopCycle first)
        // or clearPresence under idle-clear; no separate stopCycle needed.
        resumeAfterReady();
      },
      onDisconnected: () => {
        if (!isCurrent()) return;
        stopCycle();
        scheduleReconnect();
      },
    });
  } catch {
    if (isCurrent()) scheduleReconnect();
  }
}

// Called on every successful (re)connect. Respects the user's idleBehavior
// contract when the user is currently idle — otherwise a Discord restart
// during an AFK session would resurrect cycling that was meant to be
// paused or cleared.
function resumeAfterReady(): void {
  if (!state || !config) return;

  // Paused is explicit user intent — don't re-push presence on reconnect.
  // The Discord connection stays open; presence stays cleared until the
  // user toggles back on.
  if (state.paused) return;

  if (state.isIdle && config.idleBehavior === 'clear') {
    void discord.clearPresence();
    return;
  }

  // Push once to restore visibility post-reconnect. Bypass the idle-pause
  // silence guard — this is the exception the plan carves out for pause
  // on reconnect.
  void pushImmediate({ bypassIdleSilence: true });

  if (state.isIdle && config.idleBehavior === 'pause') return;
  startCycle();
}

function togglePaused(): void {
  if (!state) return;
  state.paused = !state.paused;
  if (state.paused) {
    stopCycle();
    // Also stop any pending idle work — pause supersedes idle transitions.
    clearIdleTimer();
    // Drop any queued event-debounce so a stale push doesn't fire a
    // redundant clearActivity just after the explicit pause.
    clearPushDebounce();
    // Mirror deactivate(): an in-flight push completing after pause must
    // not re-arm a stale debounced retry through the finally block.
    pushDirty = false;
    pushDirtyBypass = false;
    pushDirtyUseLastWord = false;
    void discord.clearPresence();
  } else {
    // Explicit resume overrides any lingering idle state so presence
    // reappears immediately per plan §Commands "Resume: pushes fresh,
    // restarts interval."
    state.isIdle = false;
    clearIdleTimer();
    void pushImmediate();
    startCycle();
    // If the window is currently unfocused, re-arm the idle timer so the
    // user's idleBehavior applies again without needing a focus toggle.
    onWindowStateChange();
  }
}

function onWindowStateChange(): void {
  if (!state || !config) return;
  // While disabled, don't arm the idle timer — a timer armed during a
  // disabled period would later fire against a re-enabled session with
  // stale semantics (and a stale isIdle flag would be ignored anyway).
  if (!config.enabled) {
    clearIdleTimer();
    return;
  }
  const focused = vscode.window.state.focused;
  if (!focused) {
    // Don't re-arm once we've already crossed the threshold — idle stays
    // idle until focus returns. Also don't re-arm on spurious focus=false
    // events when a timer is already running; resetting the countdown on
    // every such event could indefinitely postpone engageIdle. And don't
    // arm when the user has paused presence entirely — idle behavior is
    // moot while paused.
    if (!state.isIdle && !idleTimeout && !state.paused) {
      idleTimeout = setTimeout(engageIdle, config.idleThresholdMinutes * 60_000);
    }
  } else {
    clearIdleTimer();
    if (state.isIdle) {
      state.isIdle = false;
      startCycle();
      void pushImmediate();
    }
  }
}

function engageIdle(): void {
  idleTimeout = undefined;
  if (!state || !config) return;
  state.isIdle = true;
  applyIdleBehavior();
}

function applyIdleBehavior(): void {
  if (!config) return;
  switch (config.idleBehavior) {
    case 'slow':
      startCycle();
      break;
    case 'pause':
      stopCycle();
      // Push once so something is visible for the "keep last presence
      // visible" contract. When transitioning from 'clear' to 'pause'
      // mid-idle this restores presence; in other transitions it's
      // idempotent. Use the previously delivered word in cycling mode
      // so the displayed word doesn't change at the moment idle engages
      // — pickCandidateWord deliberately excludes the recent ring and
      // would force a fresh word, contradicting the README contract.
      void pushImmediate({ bypassIdleSilence: true, useLastWord: true });
      break;
    case 'clear':
      stopCycle();
      void discord.clearPresence();
      break;
    case 'none':
      break;
  }
}

function handleConfigChange(next: Config): void {
  if (!state) return;
  const prev = config;
  config = next;

  const transition = computeConfigTransition(prev, next, {
    isIdle: state.isIdle,
    idleTimerArmed: idleTimeout !== undefined,
  });

  if (transition.shutdown) {
    currentClientId = undefined;
    stopCycle();
    clearReconnect();
    clearIdleTimer();
    clearPushDebounce();
    // Reset isIdle so a later re-enable computes transitions against a
    // clean slate; otherwise a stale isIdle=true leaks into the next
    // computeConfigTransition's applyIdleBehavior trigger.
    state.isIdle = false;
    // Disable via config is effectively an extension restart — match the
    // "paused state does not persist across VS Code restarts" contract
    // from the plan so a re-enable starts fresh rather than silent.
    state.paused = false;
    // Clear lastWord too: on disable→edit-customWords→enable→idle-pause,
    // the useLastWord short-circuit in pushImmediate would otherwise emit
    // a word the user removed during the disabled window.
    state.lastWord = undefined;
    // Also clear pushDirty so a mid-flight push completing after shutdown
    // doesn't arm a stray post-shutdown debounce via its finally block.
    pushDirty = false;
    pushDirtyBypass = false;
    pushDirtyUseLastWord = false;
    stopLockCheck();
    if (isPrimary) { release(); isPrimary = false; }
    void discord.disconnect();
    return;
  }

  if (transition.reconnect) {
    // Defensive clear: the disabled-period event path can't arm a timer
    // (onWindowStateChange bails on !enabled), but clearing here keeps
    // the invariant "re-enable starts from zero timers" explicit in case
    // that guard is ever relaxed.
    clearIdleTimer();
    // Drop any pending push debounce — resumeAfterReady will push fresh
    // on ready and we don't want a stale 750ms timer racing that.
    clearPushDebounce();
    // Re-prime isIdle from the current focus state so the re-enable
    // respects the user's current context (AFK during disable → idle).
    state.isIdle = !vscode.window.state.focused;
    acquireOrWatch();
    // Fall through so any other changes that came in the same save
    // (cycleSpeed, customWords, idleBehavior, etc.) still apply.
  }

  if (transition.clearPinnedWord) state.pinnedWord = undefined;
  if (transition.clearLastWord) state.lastWord = undefined;
  if (transition.flushRecentWords) state.recentWords.clear();
  // On reconnect, skip cycle/idle/push restarts here — resumeAfterReady
  // will apply the correct state when the new client becomes ready, and
  // running these while !discord.isReady() is wasted work.
  if (transition.restartCycle && !transition.reconnect) startCycle();
  if (transition.restartIdleTimer && !transition.reconnect) {
    clearIdleTimer();
    idleTimeout = setTimeout(engageIdle, next.idleThresholdMinutes * 60_000);
  }
  if (transition.applyIdleBehavior && !transition.reconnect) applyIdleBehavior();
  if (transition.schedulePush && !transition.reconnect) schedulePush();
}

export function activate(context: vscode.ExtensionContext): void {
  config = readConfig();
  const initialLanguage = vscode.window.activeTextEditor?.document.languageId;
  state = createState(new Date(), initialLanguage, getWorkspaceName());
  // Seed lastInteractedSource from current focus rather than hardcoding
  // 'editor': if VS Code activates with a terminal focused and no editor
  // open, the first push would otherwise read "Working in {language}"
  // instead of "In the terminal" until the next focus event. activeTerminal
  // is defined whenever any terminal exists; we only prefer it when no
  // editor is currently active (editor is sticky during terminal focus,
  // so activeTextEditor=undefined is the strong signal).
  if (!vscode.window.activeTextEditor && vscode.window.activeTerminal) {
    lastInteractedSource = 'terminal';
  } else {
    lastInteractedSource = 'editor';
  }
  state.focusContext = computeFocusContext();
  // Seed the debug-session set from the currently-active session if any.
  activeDebugSessions.clear();
  const initialSession = vscode.debug.activeDebugSession;
  if (initialSession?.id) activeDebugSessions.add(initialSession.id);
  state.debugActive = activeDebugSessions.size > 0;
  // Treat boot-time unfocused as already-idle so the first connect respects
  // the user's idleBehavior contract instead of cycling for a full threshold
  // window before engaging.
  state.isIdle = !vscode.window.state.focused;

  const disposables: vscode.Disposable[] = [
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!state) return;
      state.currentLanguage = editor?.document.languageId;
      // Refresh workspace name too — in multi-root workspaces, switching the
      // active editor between folders should re-resolve which folder owns
      // the visible file. Without this the activation-time folder name
      // leaks for the rest of the session.
      state.workspaceName = getWorkspaceName();
      if (editor) lastInteractedSource = 'editor';
      state.focusContext = computeFocusContext();
      if (config?.enabled) schedulePush();
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (!state) return;
      // Only user-originated selection counts as interaction. Programmatic
      // edits (formatters, LSPs, other extensions) fire without Keyboard/
      // Mouse kinds and shouldn't steal focus from the terminal.
      const kind = event.kind;
      const Kinds = vscode.TextEditorSelectionChangeKind;
      if (kind !== Kinds?.Keyboard && kind !== Kinds?.Mouse) return;
      if (lastInteractedSource === 'editor') return;
      lastInteractedSource = 'editor';
      state.focusContext = computeFocusContext();
      if (config?.enabled) schedulePush();
    }),
    vscode.window.onDidChangeWindowState(() => {
      onWindowStateChange();
    }),
    vscode.window.onDidChangeActiveTerminal((terminal) => {
      if (!state) return;
      if (terminal) lastInteractedSource = 'terminal';
      // When the last terminal is closed, fall back to 'editor' so a
      // stale 'terminal' flag doesn't leak into subsequent focus
      // computations.
      else if (lastInteractedSource === 'terminal') lastInteractedSource = 'editor';
      state.focusContext = computeFocusContext();
      if (config?.enabled) schedulePush();
    }),
    vscode.window.tabGroups.onDidChangeTabs(() => {
      if (!state) return;
      state.focusContext = computeFocusContext();
      if (config?.enabled) schedulePush();
    }),
    vscode.debug.onDidStartDebugSession((session) => {
      if (!state) return;
      if (session?.id) activeDebugSessions.add(session.id);
      // Derive from the set rather than setting unconditionally — matches
      // activate()'s seed pattern and the terminate handler. A third-party
      // adapter that emits a session without an id would otherwise stick
      // debugActive=true with no way to flip it back.
      state.debugActive = activeDebugSessions.size > 0;
      if (config?.enabled) schedulePush();
    }),
    vscode.debug.onDidTerminateDebugSession((session) => {
      if (!state) return;
      if (session?.id) activeDebugSessions.delete(session.id);
      if (activeDebugSessions.size === 0) {
        // Compound launches surface siblings the extension never saw
        // start (when activation lands after launch). Re-poll
        // activeDebugSession — if VS Code reports a session whose id is
        // NOT the one terminating, that's a real sibling and we keep
        // debugActive=true. Same id means VS Code just hasn't nulled
        // activeDebugSession yet (timing quirk), and we should still
        // flip debugActive=false.
        const survivor = vscode.debug.activeDebugSession;
        if (survivor?.id && survivor.id !== session?.id) {
          activeDebugSessions.add(survivor.id);
          return;
        }
        state.debugActive = false;
        if (config?.enabled) schedulePush();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (!state) return;
      state.workspaceName = getWorkspaceName();
      if (config?.enabled) schedulePush();
    }),
    onConfigChange(handleConfigChange),
    ...registerCommands({ togglePaused }),
  ];
  context.subscriptions.push(...disposables);

  if (config.enabled) {
    acquireOrWatch();
  }
}

export function deactivate(): void {
  // Listener disposal is delegated to context.subscriptions, which VS Code
  // tears down around deactivation. We only need to unwind module-level
  // state (timers, mutexes, connection) here.
  currentClientId = undefined;
  stopCycle();
  clearReconnect();
  clearIdleTimer();
  clearPushDebounce();
  pushing = false;
  pushDirty = false;
  pushDirtyBypass = false;
  pushDirtyUseLastWord = false;
  activeDebugSessions.clear();
  stopLockCheck();
  if (isPrimary) { release(); isPrimary = false; }
  void discord.disconnect();
  state = undefined;
  config = undefined;
}
