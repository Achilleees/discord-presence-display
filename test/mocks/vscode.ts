type ConfigStore = Record<string, unknown>;

let store: ConfigStore = {};
const configListeners = new Set<(event: { affectsConfiguration: (section: string) => boolean }) => void>();

export function __setConfig(next: ConfigStore): void {
  store = { ...next };
}

export function __resetConfig(): void {
  store = {};
}

export function __emitConfigChange(affectedSections: readonly string[] = ['claudeSpinner']): void {
  const event = {
    affectsConfiguration: (section: string) => affectedSections.some((s) => section === s || section.startsWith(`${s}.`)),
  };
  for (const listener of configListeners) listener(event);
}

export const workspace = {
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
};

export const commands = {
  registerCommand(_id: string, _handler: (...args: unknown[]) => unknown) {
    return { dispose: () => {} };
  },
};

export const window = {
  activeTextEditor: undefined,
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

export type Disposable = { dispose: () => void };
