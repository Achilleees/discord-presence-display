import * as vscode from 'vscode';
import * as discord from './discord-client';
import { readConfig, onConfigChange, type Config } from './config';
import { createState, type FocusContext, type State } from './state';
import { buildPool, getNextWord } from './words';
import { buildPresencePayload } from './presence';
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
let activeConnect: Promise<void> | undefined;

function getWorkspaceName(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  return folders[0]?.name;
}

function computeFocusContext(): FocusContext {
  const activeTab = vscode.window.tabGroups?.activeTabGroup?.activeTab;
  if (activeTab?.input instanceof vscode.TabInputTextDiff) return 'diff';

  if (lastInteractedSource === 'terminal' && vscode.window.activeTerminal) {
    return 'terminal';
  }
  if (vscode.window.activeTextEditor) return 'editor';
  if (vscode.window.activeTerminal) return 'terminal';
  return 'none';
}

function pickCandidateWord(): string | undefined {
  if (!config || !state) return undefined;
  if (!config.cycleWords && state.pinnedWord) return state.pinnedWord;

  const pool = buildPool({
    wordRarity: config.wordRarity,
    timeBasedPools: config.timeBasedPools,
    customWords: config.customWords,
    elapsedMs: Date.now() - state.startTimestamp.getTime(),
  });
  return getNextWord(pool, state.recentWords.values());
}

async function pushImmediate(): Promise<void> {
  if (!state || !config) return;
  if (!discord.isReady()) return;

  const word = pickCandidateWord();
  if (!word) return;

  const payload = buildPresencePayload(state, config, word);
  if (payload === null) {
    await discord.clearPresence();
    return;
  }

  // Commit the word to recent/pinned state only after we know it's being used.
  state.recentWords.add(word);
  if (!config.cycleWords) state.pinnedWord = word;

  await discord.pushPresence(payload);
}

function schedulePush(): void {
  if (pushDebounce) clearTimeout(pushDebounce);
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
  if (activeConnect) return;

  const run = (async () => {
    try {
      await discord.connect(CLIENT_ID, {
        onReady: () => {
          if (!config?.enabled || !state) return;
          stopCycle();
          void pushImmediate();
          startCycle();
        },
        onDisconnected: () => {
          stopCycle();
          scheduleReconnect();
        },
      });
    } catch {
      scheduleReconnect();
    }
  })();
  activeConnect = run.finally(() => {
    if (activeConnect === run) activeConnect = undefined;
  });
  await activeConnect;
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
    idleTimeout = setTimeout(engageIdle, config.idleThresholdMinutes * 60_000);
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

  if (!next.enabled) {
    stopCycle();
    clearReconnect();
    clearIdleTimer();
    void discord.disconnect();
    return;
  }

  if (prev && !prev.enabled && next.enabled) {
    void connectFlow();
    return;
  }

  if (!next.cycleWords) {
    state.pinnedWord = undefined;
  }

  if (prev && prev.cycleSpeed !== next.cycleSpeed) {
    startCycle();
  } else if (prev && prev.cycleWords !== next.cycleWords) {
    startCycle();
  }

  if (prev && prev.idleThresholdMinutes !== next.idleThresholdMinutes && idleTimeout) {
    clearIdleTimer();
    idleTimeout = setTimeout(engageIdle, next.idleThresholdMinutes * 60_000);
  }

  if (prev && prev.idleBehavior !== next.idleBehavior && state.isIdle) {
    applyIdleBehavior();
  }

  schedulePush();
}

export function activate(context: vscode.ExtensionContext): void {
  config = readConfig();
  const initialLanguage = vscode.window.activeTextEditor?.document.languageId;
  state = createState(new Date(), initialLanguage, getWorkspaceName());
  lastInteractedSource = 'editor';
  state.focusContext = computeFocusContext();
  state.debugActive = vscode.debug.activeDebugSession !== undefined;

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

  // If VS Code activated while unfocused, arm the idle timer now.
  onWindowStateChange();
}

export function deactivate(): void {
  stopCycle();
  clearReconnect();
  clearIdleTimer();
  if (pushDebounce) {
    clearTimeout(pushDebounce);
    pushDebounce = undefined;
  }
  void discord.disconnect();
  state = undefined;
  config = undefined;
}
