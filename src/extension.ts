import * as vscode from 'vscode';
import * as discord from './discord-client';
import { readConfig, onConfigChange, type Config } from './config';
import { createState, type FocusContext, type State } from './state';
import { buildPresencePayload, pickCandidateWord } from './presence';
import { computeConfigTransition } from './transitions';
import { registerCommands } from './commands';

const CLIENT_ID = '1494346699861397636';
const RECONNECT_MS = 30_000;
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

function getWorkspaceName(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  return folders[0]?.name;
}

function isDiffTab(tab: vscode.Tab | undefined): boolean {
  if (!tab) return false;
  if (tab.input instanceof vscode.TabInputTextDiff) return true;
  const MultiDiffCtor = (vscode as unknown as { TabInputTextMultiDiff?: new (...a: unknown[]) => unknown })
    .TabInputTextMultiDiff;
  if (MultiDiffCtor && tab.input instanceof MultiDiffCtor) return true;
  return false;
}

function computeFocusContext(): FocusContext {
  if (isDiffTab(vscode.window.tabGroups?.activeTabGroup?.activeTab)) return 'diff';
  if (lastInteractedSource === 'terminal' && vscode.window.activeTerminal) return 'terminal';
  if (vscode.window.activeTextEditor) return 'editor';
  if (vscode.window.activeTerminal) return 'terminal';
  return 'none';
}

async function pushImmediate(): Promise<void> {
  if (!state || !config) return;
  if (!discord.isReady()) return;

  // Re-read the active editor's language every push so a mid-session
  // "Change Language Mode" picks up without requiring an editor switch.
  state.currentLanguage = vscode.window.activeTextEditor?.document.languageId ?? state.currentLanguage;

  const word = pickCandidateWord(state, config, Date.now());
  const payload = buildPresencePayload(state, config, word);
  if (payload === null) {
    await discord.clearPresence();
    return;
  }

  // Only track rotation history when actually cycling; in pinned mode the
  // ring would fill with repeats of the same word.
  if (config.cycleWords) state.recentWords.add(word);
  else state.pinnedWord = word;

  await discord.pushPresence(payload);
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
  if (!config?.enabled) return;
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = undefined;
    void connectFlow();
  }, RECONNECT_MS);
}

async function connectFlow(): Promise<void> {
  if (!config?.enabled) return;

  const myId = Symbol('client');
  currentClientId = myId;
  const isCurrent = () => currentClientId === myId;

  try {
    await discord.connect(CLIENT_ID, {
      onReady: () => {
        if (!isCurrent()) return;
        if (!config?.enabled || !state) return;
        clearReconnect();
        stopCycle();
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

  if (state.isIdle && config.idleBehavior === 'clear') {
    void discord.clearPresence();
    return;
  }

  void pushImmediate();

  if (state.isIdle && config.idleBehavior === 'pause') return;
  startCycle();
}

function togglePaused(): void {
  if (!state) return;
  state.paused = !state.paused;
  if (state.paused) {
    stopCycle();
    void discord.clearPresence();
  } else {
    void pushImmediate();
    startCycle();
  }
}

function onWindowStateChange(): void {
  if (!state || !config) return;
  const focused = vscode.window.state.focused;
  if (!focused) {
    clearIdleTimer();
    // Don't re-arm once we've already crossed the threshold — idle stays
    // idle until focus returns.
    if (!state.isIdle) {
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
  const prev = config;
  config = next;
  if (!state) return;

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
    void discord.disconnect();
    return;
  }

  if (transition.reconnect) {
    void connectFlow();
    return;
  }

  if (transition.clearPinnedWord) state.pinnedWord = undefined;
  if (transition.restartCycle) startCycle();
  if (transition.restartIdleTimer) {
    clearIdleTimer();
    idleTimeout = setTimeout(engageIdle, next.idleThresholdMinutes * 60_000);
  }
  if (transition.applyIdleBehavior) applyIdleBehavior();
  if (transition.schedulePush) schedulePush();
}

export function activate(context: vscode.ExtensionContext): void {
  config = readConfig();
  const initialLanguage = vscode.window.activeTextEditor?.document.languageId;
  state = createState(new Date(), initialLanguage, getWorkspaceName());
  lastInteractedSource = 'editor';
  state.focusContext = computeFocusContext();
  state.debugActive = vscode.debug.activeDebugSession !== undefined;
  // Treat boot-time unfocused as already-idle so the first connect respects
  // the user's idleBehavior contract instead of cycling for a full threshold
  // window before engaging.
  state.isIdle = !vscode.window.state.focused;

  const disposables: vscode.Disposable[] = [
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (!state) return;
      state.currentLanguage = editor?.document.languageId;
      if (editor) lastInteractedSource = 'editor';
      state.focusContext = computeFocusContext();
      schedulePush();
    }),
    vscode.window.onDidChangeTextEditorSelection(() => {
      if (!state) return;
      if (lastInteractedSource === 'editor') return;
      lastInteractedSource = 'editor';
      state.focusContext = computeFocusContext();
      schedulePush();
    }),
    vscode.window.onDidChangeWindowState(() => {
      onWindowStateChange();
    }),
    vscode.window.onDidChangeActiveTerminal((terminal) => {
      if (!state) return;
      if (terminal) lastInteractedSource = 'terminal';
      state.focusContext = computeFocusContext();
      schedulePush();
    }),
    vscode.window.tabGroups.onDidChangeTabs(() => {
      if (!state) return;
      state.focusContext = computeFocusContext();
      schedulePush();
    }),
    vscode.debug.onDidStartDebugSession(() => {
      if (!state) return;
      state.debugActive = true;
      schedulePush();
    }),
    vscode.debug.onDidTerminateDebugSession(() => {
      if (!state) return;
      if (vscode.debug.activeDebugSession === undefined) {
        state.debugActive = false;
        schedulePush();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (!state) return;
      state.workspaceName = getWorkspaceName();
      schedulePush();
    }),
    onConfigChange(handleConfigChange),
    ...registerCommands({ togglePaused }),
  ];
  context.subscriptions.push(...disposables);

  if (config.enabled) {
    void connectFlow();
  }

  onWindowStateChange();
}

export function deactivate(): void {
  currentClientId = undefined;
  stopCycle();
  clearReconnect();
  clearIdleTimer();
  clearPushDebounce();
  void discord.disconnect();
  state = undefined;
  config = undefined;
}
