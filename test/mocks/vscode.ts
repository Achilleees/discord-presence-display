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

export function __emitConfigChange(affectedSections: readonly string[] = ['claudeSpinner']): void {
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
  onDidChangeWorkspaceFolders: () => ({ dispose: () => {} }),
};

export const commands = {
  registerCommand<F extends (...args: unknown[]) => unknown>(id: string, handler: F): { dispose: () => void } {
    commandHandlers.set(id, handler);
    return { dispose: () => commandHandlers.delete(id) };
  },
};

export const window = {
  activeTextEditor: undefined as { document: { languageId: string } } | undefined,
  activeTerminal: undefined,
  state: { focused: true },
  tabGroups: {
    activeTabGroup: undefined,
    onDidChangeTabs: () => ({ dispose: () => {} }),
  },
  onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
  onDidChangeTextEditorSelection: () => ({ dispose: () => {} }),
  onDidChangeActiveTerminal: () => ({ dispose: () => {} }),
  onDidChangeWindowState: () => ({ dispose: () => {} }),
};

export const debug = {
  activeDebugSession: undefined,
  onDidStartDebugSession: () => ({ dispose: () => {} }),
  onDidTerminateDebugSession: () => ({ dispose: () => {} }),
};

export class TabInputTextDiff {}
export class TabInputTextMultiDiff {}

export type Disposable = { dispose: () => void };
