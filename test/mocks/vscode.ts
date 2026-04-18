import { CONFIG_SECTION } from '../../src/config';

type ConfigStore = Record<string, unknown>;

let store: ConfigStore = {};
const configListeners = new Set<(event: { affectsConfiguration: (section: string) => boolean }) => void>();
const commandHandlers = new Map<string, (...args: unknown[]) => unknown>();

export function __setConfig(next: ConfigStore): void {
  store = { ...next };
}

export function __resetConfig(): void {
  store = {};
}

export function __emitConfigChange(affectedSections: readonly string[] = [CONFIG_SECTION]): void {
  const event = {
    affectsConfiguration: (section: string) =>
      affectedSections.some((s) => section === s || section.startsWith(`${s}.`)),
  };
  for (const listener of configListeners) listener(event);
}

export function __getRegisteredCommand(id: string): ((...args: unknown[]) => unknown) | undefined {
  return commandHandlers.get(id);
}

export function __resetCommands(): void {
  commandHandlers.clear();
}

export const workspace = {
  workspaceFolders: undefined as readonly { name: string; uri: { fsPath: string } }[] | undefined,
  getConfiguration(section?: string): {
    get: <T>(key: string, defaultValue?: T) => T;
  } {
    return {
      get<T>(key: string, defaultValue?: T): T {
        const fullKey = section ? `${section}.${key}` : key;
        if (fullKey in store) return store[fullKey] as T;
        return defaultValue as T;
      },
    };
  },
  onDidChangeConfiguration(cb: (event: { affectsConfiguration: (section: string) => boolean }) => void) {
    configListeners.add(cb);
    return { dispose: () => configListeners.delete(cb) };
  },
  onDidChangeWorkspaceFolders(listener: () => void) {
    workspaceFoldersListeners.add(listener);
    return { dispose: () => workspaceFoldersListeners.delete(listener) };
  },
};

export const commands = {
  registerCommand<F extends (...args: unknown[]) => unknown>(id: string, handler: F): { dispose: () => void } {
    commandHandlers.set(id, handler);
    return { dispose: () => commandHandlers.delete(id) };
  },
};

const windowStateListeners = new Set<(e: { focused: boolean }) => void>();
const debugStartListeners = new Set<() => void>();
const debugEndListeners = new Set<() => void>();
const activeEditorListeners = new Set<(editor: unknown) => void>();
const selectionListeners = new Set<(event: { kind: unknown }) => void>();
const visibleRangesListeners = new Set<() => void>();
const activeTerminalListeners = new Set<(terminal: unknown) => void>();
const tabListeners = new Set<() => void>();
const workspaceFoldersListeners = new Set<() => void>();

export const TextEditorSelectionChangeKind = { Keyboard: 1, Mouse: 2, Command: 3 };

export function __setActiveEditor(editor: { document: { languageId: string } } | undefined): void {
  window.activeTextEditor = editor;
  for (const listener of activeEditorListeners) listener(editor);
}

export function __fireSelectionChange(kind: number | undefined = TextEditorSelectionChangeKind.Keyboard): void {
  for (const listener of selectionListeners) listener({ kind });
}

export function __fireVisibleRanges(): void {
  for (const listener of visibleRangesListeners) listener();
}

export function __setActiveTerminal(terminal: unknown): void {
  (window as unknown as { activeTerminal: unknown }).activeTerminal = terminal;
  for (const listener of activeTerminalListeners) listener(terminal);
}

export function __fireTabChange(): void {
  for (const listener of tabListeners) listener();
}

export function __fireWorkspaceFoldersChange(): void {
  for (const listener of workspaceFoldersListeners) listener();
}

export function __setFocused(focused: boolean): void {
  window.state.focused = focused;
  for (const listener of windowStateListeners) listener({ focused });
}

export function __startDebugSession(): void {
  (debug as unknown as { activeDebugSession: unknown }).activeDebugSession = { id: 'test' };
  for (const listener of debugStartListeners) listener();
}

export function __endDebugSession(): void {
  (debug as unknown as { activeDebugSession: unknown }).activeDebugSession = undefined;
  for (const listener of debugEndListeners) listener();
}

export const window = {
  activeTextEditor: undefined as { document: { languageId: string } } | undefined,
  activeTerminal: undefined as unknown,
  state: { focused: true },
  tabGroups: {
    activeTabGroup: undefined,
    onDidChangeTabs(listener: () => void) {
      tabListeners.add(listener);
      return { dispose: () => tabListeners.delete(listener) };
    },
  },
  onDidChangeActiveTextEditor(listener: (editor: unknown) => void) {
    activeEditorListeners.add(listener);
    return { dispose: () => activeEditorListeners.delete(listener) };
  },
  onDidChangeTextEditorSelection(listener: (event: { kind: unknown }) => void) {
    selectionListeners.add(listener);
    return { dispose: () => selectionListeners.delete(listener) };
  },
  onDidChangeTextEditorVisibleRanges(listener: () => void) {
    visibleRangesListeners.add(listener);
    return { dispose: () => visibleRangesListeners.delete(listener) };
  },
  onDidChangeActiveTerminal(listener: (terminal: unknown) => void) {
    activeTerminalListeners.add(listener);
    return { dispose: () => activeTerminalListeners.delete(listener) };
  },
  onDidChangeWindowState(listener: (e: { focused: boolean }) => void) {
    windowStateListeners.add(listener);
    return { dispose: () => windowStateListeners.delete(listener) };
  },
};

export const debug = {
  activeDebugSession: undefined,
  onDidStartDebugSession(listener: () => void) {
    debugStartListeners.add(listener);
    return { dispose: () => debugStartListeners.delete(listener) };
  },
  onDidTerminateDebugSession(listener: () => void) {
    debugEndListeners.add(listener);
    return { dispose: () => debugEndListeners.delete(listener) };
  },
};

export function __resetEvents(): void {
  windowStateListeners.clear();
  debugStartListeners.clear();
  debugEndListeners.clear();
  activeEditorListeners.clear();
  selectionListeners.clear();
  visibleRangesListeners.clear();
  activeTerminalListeners.clear();
  tabListeners.clear();
  workspaceFoldersListeners.clear();
  window.state.focused = true;
  window.activeTextEditor = undefined;
  (window as unknown as { activeTerminal: unknown }).activeTerminal = undefined;
  (window.tabGroups as unknown as { activeTabGroup: unknown }).activeTabGroup = undefined;
  (debug as unknown as { activeDebugSession: unknown }).activeDebugSession = undefined;
  workspace.workspaceFolders = undefined;
}

export class TabInputTextDiff {}
export class TabInputTextMultiDiff {}

export type Disposable = { dispose: () => void };
