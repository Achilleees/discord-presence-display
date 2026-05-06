import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type ClientInstance = {
  clientId: string;
  login: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
  isConnected: boolean;
  user: { setActivity: ReturnType<typeof vi.fn>; clearActivity: ReturnType<typeof vi.fn> } | undefined;
};

const instances: ClientInstance[] = [];

vi.mock('@xhayper/discord-rpc', () => {
  return {
    Client: class {
      clientId: string;
      login: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
      request: ReturnType<typeof vi.fn>;
      isConnected = false;
      user: ClientInstance['user'];
      constructor(opts: { clientId: string }) {
        this.clientId = opts.clientId;
        this.login = vi.fn().mockResolvedValue(undefined);
        this.destroy = vi.fn().mockResolvedValue(undefined);
        this.on = vi.fn();
        this.user = {
          setActivity: vi.fn().mockResolvedValue(undefined),
          clearActivity: vi.fn().mockResolvedValue(undefined),
        };
        const self = this;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.request = vi.fn(async (cmd: string, args?: any) => {
          if (cmd === 'SET_ACTIVITY' && args?.activity) {
            return self.user?.setActivity(args.activity);
          }
        });
        instances.push(this as unknown as ClientInstance);
      }
    },
  };
});

vi.mock('../src/instance-lock', () => ({
  tryAcquire: vi.fn().mockReturnValue(true),
  release: vi.fn(),
}));

// Hoisted bridge for opt-in deterministic picker overrides. When unset, the
// real presence.pickCandidateWord runs; tests that need observable pick
// behaviour (audit 47-E2) point `picker` at a controlled stub that records
// every (state, config, elapsedMs) it receives.
const presenceMocks = vi.hoisted(() => ({
  picker: undefined as
    | undefined
    | ((state: unknown, config: unknown, elapsedMs: number) => string),
  pickCalls: [] as Array<{ recent: readonly string[]; ringSize: number }>,
}));

vi.mock('../src/presence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/presence')>();
  return {
    ...actual,
    pickCandidateWord: (
      state: import('../src/state').State,
      config: import('../src/config').Config,
      elapsedMs: number,
    ): string => {
      // Record a snapshot of the recent ring before the pick — that's the
      // input the gate determines. Snapshot via slice() because the ring
      // exposes a defensive copy already; this just makes intent explicit.
      const recent = state.recentWords.values().slice();
      presenceMocks.pickCalls.push({ recent, ringSize: recent.length });
      if (presenceMocks.picker) return presenceMocks.picker(state, config, elapsedMs);
      return actual.pickCandidateWord(state, config, elapsedMs);
    },
  };
});

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error mock module resolved via vitest alias
import {
  __setConfig,
  __resetConfig,
  __resetCommands,
  __getRegisteredCommand,
  __setFocused,
  __resetEvents,
  __startDebugSession,
  __endDebugSession,
  __setActiveEditor,
  __fireSelectionChange,
  __setActiveTerminal,
  __fireTabChange,
  __fireWorkspaceFoldersChange,
  TextEditorSelectionChangeKind,
  TabInputTextDiff,
  window as mockWindow,
  workspace as mockWorkspace,
} from 'vscode';
import * as extension from '../src/extension';

function mkContext(): { subscriptions: { dispose: () => void }[] } {
  return { subscriptions: [] };
}

beforeEach(() => {
  __resetConfig();
  __resetCommands();
  __resetEvents();
  instances.length = 0;
  presenceMocks.picker = undefined;
  presenceMocks.pickCalls.length = 0;
});

afterEach(() => {
  extension.deactivate();
  vi.useRealTimers();
});

describe('activate', () => {
  it('does not throw on fresh activation with default config', () => {
    const ctx = mkContext();
    expect(() => extension.activate(ctx as never)).not.toThrow();
  });

  it('registers the toggle command', () => {
    extension.activate(mkContext() as never);
    expect(__getRegisteredCommand('claudeSpinner.toggle')).toBeTypeOf('function');
  });

  it('connects to Discord with the configured client id when enabled', async () => {
    extension.activate(mkContext() as never);
    // connect is async; wait a tick
    await Promise.resolve();
    expect(instances.length).toBeGreaterThan(0);
    expect(instances[0].login).toHaveBeenCalled();
  });

  it('does not connect when enabled=false', async () => {
    __setConfig({ 'claudeSpinner.enabled': false });
    extension.activate(mkContext() as never);
    await Promise.resolve();
    expect(instances.length).toBe(0);
  });
});

describe('deactivate', () => {
  it('is idempotent when called before activate', () => {
    expect(() => extension.deactivate()).not.toThrow();
  });

  it('destroys the active client', async () => {
    extension.activate(mkContext() as never);
    await Promise.resolve();
    expect(instances.length).toBe(1);
    extension.deactivate();
    // give destroy a tick
    await Promise.resolve();
    expect(instances[0].destroy).toHaveBeenCalled();
  });
});

describe('idle engagement', () => {
  async function bootAndReady(idleBehavior = 'slow'): Promise<void> {
    __setConfig({
      'claudeSpinner.idleThresholdMinutes': 1,
      'claudeSpinner.idleBehavior': idleBehavior,
    });
    extension.activate(mkContext() as never);
    await Promise.resolve();
    if (instances[0]) instances[0].isConnected = true;
  }

  it('engages idle "clear" behavior after threshold', async () => {
    vi.useFakeTimers();
    await bootAndReady('clear');
    __setFocused(false);
    vi.advanceTimersByTime(60_000 + 1);
    await Promise.resolve();
    expect(instances[0].user?.clearActivity).toHaveBeenCalled();
  });

  it('engages idle "pause" behavior — stops cycling but does not clear', async () => {
    vi.useFakeTimers();
    await bootAndReady('pause');
    const initialClearCalls = instances[0].user!.clearActivity.mock.calls.length;
    __setFocused(false);
    vi.advanceTimersByTime(60_000 + 1);
    await Promise.resolve();
    expect(instances[0].user!.clearActivity.mock.calls.length).toBe(initialClearCalls);
  });

  it('pushes again on re-focus after idle', async () => {
    vi.useFakeTimers();
    await bootAndReady('clear');
    __setFocused(false);
    vi.advanceTimersByTime(60_000 + 1);
    await Promise.resolve();
    instances[0].user!.setActivity.mockClear();
    __setFocused(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(instances[0].user?.setActivity).toHaveBeenCalled();
  });

  it('reconnect during idle "clear" does NOT resurrect presence (audit r3 3.1)', async () => {
    vi.useFakeTimers();
    await bootAndReady('clear');
    __setFocused(false);
    vi.advanceTimersByTime(60_000 + 1);
    await Promise.resolve();
    // Now idle+clear. Simulate Discord reconnect by firing the captured
    // onReady callback with the client still appearing connected.
    const readyCall = instances[0].on.mock.calls.find((c: unknown[]) => c[0] === 'ready');
    expect(readyCall).toBeDefined();
    const onReady = readyCall![1] as () => void;
    instances[0].user!.setActivity.mockClear();
    instances[0].user!.clearActivity.mockClear();
    onReady();
    await Promise.resolve();
    expect(instances[0].user?.setActivity).not.toHaveBeenCalled();
    expect(instances[0].user?.clearActivity).toHaveBeenCalled();
  });

  it('cycleSpeed change during idle "clear" does NOT resurrect presence (audit r4 3.1)', async () => {
    vi.useFakeTimers();
    await bootAndReady('clear');
    __setFocused(false);
    vi.advanceTimersByTime(60_000 + 1);
    await Promise.resolve();
    // Now idle+clear. Simulate a config change that would previously
    // trigger restartCycle → startCycle → pushImmediate.
    instances[0].user!.setActivity.mockClear();
    __setConfig({
      'claudeSpinner.idleThresholdMinutes': 1,
      'claudeSpinner.idleBehavior': 'clear',
      'claudeSpinner.cycleSpeed': 30,
    });
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error mock module
    (await import('vscode')).__emitConfigChange(['claudeSpinner']);
    // Let debounced push fire
    vi.advanceTimersByTime(1_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(instances[0].user?.setActivity).not.toHaveBeenCalled();
  });

  it('cycleSpeed change during idle "pause" does NOT start a cycle interval', async () => {
    vi.useFakeTimers();
    await bootAndReady('pause');
    __setFocused(false);
    vi.advanceTimersByTime(60_000 + 1);
    await Promise.resolve();
    __setConfig({
      'claudeSpinner.idleThresholdMinutes': 1,
      'claudeSpinner.idleBehavior': 'pause',
      'claudeSpinner.cycleSpeed': 30,
    });
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error mock module
    (await import('vscode')).__emitConfigChange(['claudeSpinner']);
    vi.advanceTimersByTime(1_000);
    await Promise.resolve();
    // Capture baseline call count after config-change debounce fires
    const baseline = instances[0].user!.setActivity.mock.calls.length;
    // Advance past multiple cycleSpeed intervals; no new pushes should occur
    vi.advanceTimersByTime(120_000);
    await Promise.resolve();
    expect(instances[0].user!.setActivity.mock.calls.length).toBe(baseline);
  });

  it('idle "slow" cycles at quadrupled interval, not normal cycleSpeed', async () => {
    vi.useFakeTimers();
    __setConfig({
      'claudeSpinner.cycleSpeed': 10,
      'claudeSpinner.idleThresholdMinutes': 1,
      'claudeSpinner.idleBehavior': 'slow',
    });
    extension.activate(mkContext() as never);
    await Promise.resolve();
    if (instances[0]) instances[0].isConnected = true;
    __setFocused(false);
    vi.advanceTimersByTime(60_000 + 1);
    await Promise.resolve();
    // Engaged idle-slow. cycleSpeed=10s → idle interval should be 40s.
    instances[0].user!.setActivity.mockClear();
    // One normal cycleSpeed elapses — no tick expected under slow.
    vi.advanceTimersByTime(10_000);
    await Promise.resolve();
    expect(instances[0].user!.setActivity.mock.calls.length).toBe(0);
    // Advance past 40s total — at least one tick expected.
    vi.advanceTimersByTime(31_000);
    await Promise.resolve();
    expect(instances[0].user!.setActivity.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('idleBehavior slow→none while idle resumes normal cycling (audit r6 3.1)', async () => {
    vi.useFakeTimers();
    __setConfig({
      'claudeSpinner.cycleSpeed': 10,
      'claudeSpinner.idleThresholdMinutes': 1,
      'claudeSpinner.idleBehavior': 'slow',
    });
    extension.activate(mkContext() as never);
    await Promise.resolve();
    await Promise.resolve();
    if (instances[0]) instances[0].isConnected = true;
    __setFocused(false);
    await vi.advanceTimersByTimeAsync(60_001);
    instances[0].user!.setActivity.mockClear();
    __setConfig({
      'claudeSpinner.cycleSpeed': 10,
      'claudeSpinner.idleThresholdMinutes': 1,
      'claudeSpinner.idleBehavior': 'none',
    });
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error mock module
    (await import('vscode')).__emitConfigChange(['claudeSpinner']);
    await vi.advanceTimersByTimeAsync(1_000);
    const afterChange = instances[0].user!.setActivity.mock.calls.length;
    // Interval was armed at 10s during handleConfigChange; advance past
    // that plus a buffer. Using the async variant drains microtasks
    // between tick firings so pushing mutex releases in time.
    await vi.advanceTimersByTimeAsync(11_000);
    expect(instances[0].user!.setActivity.mock.calls.length).toBeGreaterThan(afterChange);
  });

  it('idleBehavior clear→pause while idle restores presence (audit r13 3.1)', async () => {
    vi.useFakeTimers();
    await bootAndReady('clear');
    __setFocused(false);
    await vi.advanceTimersByTimeAsync(60_001);
    // Idle+clear engaged; presence is cleared. Now flip to 'pause'.
    instances[0].user!.setActivity.mockClear();
    __setConfig({
      'claudeSpinner.idleThresholdMinutes': 1,
      'claudeSpinner.idleBehavior': 'pause',
    });
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error mock module
    (await import('vscode')).__emitConfigChange(['claudeSpinner']);
    // Flush applyIdleBehavior's bypass push and any dirty-retry chain.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(instances[0].user?.setActivity).toHaveBeenCalled();
  });

  it('idleBehavior clear→none while idle restores presence', async () => {
    vi.useFakeTimers();
    await bootAndReady('clear');
    __setFocused(false);
    vi.advanceTimersByTime(60_000 + 1);
    await Promise.resolve();
    // Presence cleared. Flip to 'none'.
    instances[0].user!.setActivity.mockClear();
    __setConfig({
      'claudeSpinner.idleThresholdMinutes': 1,
      'claudeSpinner.idleBehavior': 'none',
    });
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error mock module
    (await import('vscode')).__emitConfigChange(['claudeSpinner']);
    vi.advanceTimersByTime(1_000);
    await Promise.resolve();
    expect(instances[0].user?.setActivity).toHaveBeenCalled();
  });

  it('paused + idle + refocus: no setActivity, presence stays cleared', async () => {
    vi.useFakeTimers();
    await bootAndReady('clear');
    const toggle = __getRegisteredCommand('claudeSpinner.toggle')!;
    toggle(); // pause
    await Promise.resolve();
    instances[0].user!.clearActivity.mockClear();
    instances[0].user!.setActivity.mockClear();
    __setFocused(false);
    vi.advanceTimersByTime(60_000 + 1);
    await Promise.resolve();
    __setFocused(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(instances[0].user!.setActivity).not.toHaveBeenCalled();
  });

  it('idle "pause" suppresses non-reconnect pushes (audit r9 3.5)', async () => {
    vi.useFakeTimers();
    await bootAndReady('pause');
    __setFocused(false);
    await vi.advanceTimersByTimeAsync(60_001);
    // Now idle+pause. A debug session start would normally trigger a push
    // via schedulePush; under pause silence it should NOT.
    const baseline = instances[0].user!.setActivity.mock.calls.length;
    __startDebugSession();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(instances[0].user!.setActivity.mock.calls.length).toBe(baseline);
    __endDebugSession();
  });

  it('reconnect during idle "pause" pushes once but does not start cycling', async () => {
    vi.useFakeTimers();
    await bootAndReady('pause');
    __setFocused(false);
    // Use async so the push from applyIdleBehavior('pause') drains fully
    // before we mockClear; otherwise the mutex is still held.
    await vi.advanceTimersByTimeAsync(60_001);
    const readyCall = instances[0].on.mock.calls.find((c: unknown[]) => c[0] === 'ready');
    const onReady = readyCall![1] as () => void;
    instances[0].user!.setActivity.mockClear();
    onReady();
    await vi.advanceTimersByTimeAsync(100);
    // Exactly one restore push, no further pushes from a cycle tick.
    expect(instances[0].user!.setActivity.mock.calls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(instances[0].user!.setActivity.mock.calls.length).toBe(1);
  });
});

describe('onReady', () => {
  it('non-idle onReady pushes presence and schedules a cycle tick', async () => {
    vi.useFakeTimers();
    extension.activate(mkContext() as never);
    await Promise.resolve();
    await Promise.resolve();
    if (instances[0]) instances[0].isConnected = true;
    const readyCall = instances[0].on.mock.calls.find((c: unknown[]) => c[0] === 'ready');
    const onReady = readyCall![1] as () => void;
    instances[0].user!.setActivity.mockClear();
    onReady();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(instances[0].user?.setActivity).toHaveBeenCalled();
    instances[0].user!.setActivity.mockClear();
    await vi.advanceTimersByTimeAsync(15_100);
    expect(instances[0].user?.setActivity).toHaveBeenCalled();
  });
});

describe('event listeners', () => {
  async function setupConnected(): Promise<void> {
    vi.useFakeTimers();
    extension.activate(mkContext() as never);
    await Promise.resolve();
    await Promise.resolve();
    if (instances[0]) instances[0].isConnected = true;
  }

  it('active-editor change updates currentLanguage', async () => {
    await setupConnected();
    __setActiveEditor({ document: { languageId: 'python' } });
    await vi.advanceTimersByTimeAsync(1_000);
    const payload = instances[0].user!.setActivity.mock.calls.at(-1)?.[0] as { state?: string };
    expect(payload?.state).toContain('Python');
  });

  it('closing the last editor sets state line to omitted', async () => {
    __setConfig({});
    await setupConnected();
    __setActiveEditor({ document: { languageId: 'typescript' } });
    await vi.advanceTimersByTimeAsync(1_000);
    __setActiveEditor(undefined);
    await vi.advanceTimersByTimeAsync(1_000);
    const latest = instances[0].user!.setActivity.mock.calls.at(-1)?.[0] as { state?: string };
    expect(latest?.state).toBeUndefined();
  });

  it('terminal activation flips focus to "terminal"', async () => {
    await setupConnected();
    __setActiveTerminal({ name: 'bash' });
    await vi.advanceTimersByTimeAsync(1_000);
    const latest = instances[0].user!.setActivity.mock.calls.at(-1)?.[0] as { state?: string };
    expect(latest?.state).toBe('In the terminal');
  });

  it('closing the last terminal reverts lastInteractedSource to editor', async () => {
    await setupConnected();
    __setActiveEditor({ document: { languageId: 'rust' } });
    __setActiveTerminal({ name: 't1' });
    await vi.advanceTimersByTimeAsync(1_000);
    __setActiveTerminal(undefined);
    // Fire a selection event to trigger a push that reflects the new focus.
    __fireSelectionChange(TextEditorSelectionChangeKind.Keyboard);
    await vi.advanceTimersByTimeAsync(1_000);
    const latest = instances[0].user!.setActivity.mock.calls.at(-1)?.[0] as { state?: string };
    expect(latest?.state).toBe('Working in Rust');
  });

  it('selection change with Command kind does NOT steal focus from terminal', async () => {
    await setupConnected();
    __setActiveEditor({ document: { languageId: 'go' } });
    __setActiveTerminal({ name: 't' });
    await vi.advanceTimersByTimeAsync(1_000);
    // Programmatic selection should NOT flip lastInteractedSource.
    __fireSelectionChange(TextEditorSelectionChangeKind.Command);
    await vi.advanceTimersByTimeAsync(1_000);
    const latest = instances[0].user!.setActivity.mock.calls.at(-1)?.[0] as { state?: string };
    expect(latest?.state).toBe('In the terminal');
  });

  it('selection change with Keyboard kind flips focus to editor', async () => {
    await setupConnected();
    __setActiveEditor({ document: { languageId: 'go' } });
    __setActiveTerminal({ name: 't' });
    await vi.advanceTimersByTimeAsync(1_000);
    __fireSelectionChange(TextEditorSelectionChangeKind.Keyboard);
    await vi.advanceTimersByTimeAsync(1_000);
    const latest = instances[0].user!.setActivity.mock.calls.at(-1)?.[0] as { state?: string };
    expect(latest?.state).toBe('Working in Go');
  });

  it('tab change with a diff tab produces Reviewing state line', async () => {
    await setupConnected();
    __setActiveEditor({ document: { languageId: 'typescript' } });
    (mockWindow as unknown as { tabGroups: { activeTabGroup: unknown } }).tabGroups.activeTabGroup = {
      activeTab: { input: new TabInputTextDiff() },
    };
    __fireTabChange();
    await vi.advanceTimersByTimeAsync(1_000);
    const latest = instances[0].user!.setActivity.mock.calls.at(-1)?.[0] as { state?: string };
    expect(latest?.state).toBe('Reviewing in TypeScript');
  });

  it('workspace folders change updates the appended workspace name', async () => {
    __setConfig({ 'claudeSpinner.showWorkspace': true });
    await setupConnected();
    __setActiveEditor({ document: { languageId: 'rust' } });
    (mockWorkspace as unknown as {
      workspaceFolders: readonly { name: string; uri: { fsPath: string } }[] | undefined;
    }).workspaceFolders = [{ name: 'my-new-repo', uri: { fsPath: '/tmp' } }];
    __fireWorkspaceFoldersChange();
    await vi.advanceTimersByTimeAsync(1_000);
    const latest = instances[0].user!.setActivity.mock.calls.at(-1)?.[0] as { state?: string };
    expect(latest?.state).toBe('Working in Rust — my-new-repo');
  });

  it('switching active editor between multi-root folders refreshes workspace name', async () => {
    __setConfig({ 'claudeSpinner.showWorkspace': true });
    (mockWorkspace as unknown as {
      workspaceFolders: readonly { name: string; uri: { fsPath: string } }[] | undefined;
    }).workspaceFolders = [
      { name: 'frontend', uri: { fsPath: '/repo/frontend' } },
      { name: 'backend', uri: { fsPath: '/repo/backend' } },
    ];
    await setupConnected();
    __setActiveEditor({
      document: { languageId: 'typescript', uri: { fsPath: '/repo/frontend/src/app.ts' } },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    let latest = instances[0].user!.setActivity.mock.calls.at(-1)?.[0] as { state?: string };
    expect(latest?.state).toBe('Working in TypeScript — frontend');
    __setActiveEditor({
      document: { languageId: 'rust', uri: { fsPath: '/repo/backend/src/main.rs' } },
    });
    await vi.advanceTimersByTimeAsync(1_000);
    latest = instances[0].user!.setActivity.mock.calls.at(-1)?.[0] as { state?: string };
    expect(latest?.state).toBe('Working in Rust — backend');
  });
});

describe('debug session', () => {
  it('pushes a new payload after debug session starts', async () => {
    vi.useFakeTimers();
    extension.activate(mkContext() as never);
    await Promise.resolve();
    if (instances[0]) instances[0].isConnected = true;
    instances[0].user!.setActivity.mockClear();
    __startDebugSession();
    vi.advanceTimersByTime(1_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(instances[0].user?.setActivity).toHaveBeenCalled();
    __endDebugSession();
  });

  it('clears debugActive on terminate even when activeDebugSession is stale', async () => {
    vi.useFakeTimers();
    extension.activate(mkContext() as never);
    await Promise.resolve();
    if (instances[0]) instances[0].isConnected = true;
    const sessionId = __startDebugSession();
    await vi.advanceTimersByTimeAsync(1_000);
    // Fire terminate with activeDebugSession still set (simulating VS
    // Code firing the event before nulling activeDebugSession). The
    // tracked Set must drop the id regardless.
    __endDebugSession(sessionId, { keepActiveStale: true });
    await vi.advanceTimersByTimeAsync(1_000);
    instances[0].user!.setActivity.mockClear();
    // Any subsequent push should no longer emit "Debugging in".
    __setActiveEditor({ document: { languageId: 'typescript' } });
    await vi.advanceTimersByTimeAsync(1_000);
    const latest = instances[0].user!.setActivity.mock.calls.at(-1)?.[0] as { state?: string };
    expect(latest?.state).not.toContain('Debugging');
  });
});

describe('push mutex', () => {
  it('drops concurrent pushes but retries via dirty flag after the current one completes', async () => {
    vi.useFakeTimers();
    extension.activate(mkContext() as never);
    await Promise.resolve();
    await Promise.resolve();
    if (instances[0]) instances[0].isConnected = true;

    // Make setActivity hang so the first push holds the mutex.
    let resolveFirst: (() => void) | undefined;
    instances[0].user!.setActivity.mockImplementation(
      () => new Promise<void>((r) => {
        resolveFirst = r;
      }),
    );

    // Fire first push (via manual onReady) — it enters the mutex and hangs.
    const readyCall = instances[0].on.mock.calls.find((c: unknown[]) => c[0] === 'ready');
    const onReady = readyCall![1] as () => void;
    onReady();
    await Promise.resolve();

    // Fire a second push while the first is busy (simulate a config change).
    __startDebugSession();
    await vi.advanceTimersByTimeAsync(1_000);
    // At this point, dirty flag should have been set; mutex still holds.
    expect(instances[0].user!.setActivity.mock.calls.length).toBe(1);

    // Release the first push. The dirty flag should trigger a second push.
    instances[0].user!.setActivity.mockImplementation(() => Promise.resolve());
    resolveFirst!();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(instances[0].user!.setActivity.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('config-change reconnect path', () => {
  it('re-enable while unfocused primes idle timer (audit r8 3.1)', async () => {
    vi.useFakeTimers();
    __setConfig({
      'claudeSpinner.enabled': false,
      'claudeSpinner.idleThresholdMinutes': 1,
      'claudeSpinner.idleBehavior': 'clear',
    });
    mockWindow.state.focused = false;
    extension.activate(mkContext() as never);
    await Promise.resolve();
    // Now re-enable without ever focusing.
    __setConfig({
      'claudeSpinner.enabled': true,
      'claudeSpinner.idleThresholdMinutes': 1,
      'claudeSpinner.idleBehavior': 'clear',
    });
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error mock module
    (await import('vscode')).__emitConfigChange(['claudeSpinner']);
    await Promise.resolve();
    await Promise.resolve();
    if (instances[0]) instances[0].isConnected = true;
    const readyCall = instances[0].on.mock.calls.find((c: unknown[]) => c[0] === 'ready');
    const onReady = readyCall![1] as () => void;
    onReady();
    // isIdle should be true at ready-time (focused=false + re-enable primed state).
    // Therefore no setActivity should fire under clear.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(instances[0].user?.setActivity).not.toHaveBeenCalled();
  });

  it('re-enable in same save as cycleSpeed change applies both (audit r8 3.2)', async () => {
    vi.useFakeTimers();
    __setConfig({
      'claudeSpinner.enabled': false,
      'claudeSpinner.cycleSpeed': 15,
    });
    extension.activate(mkContext() as never);
    await Promise.resolve();
    // User edits settings.json and flips enabled + cycleSpeed at once.
    __setConfig({
      'claudeSpinner.enabled': true,
      'claudeSpinner.cycleSpeed': 42,
    });
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error mock module
    (await import('vscode')).__emitConfigChange(['claudeSpinner']);
    await Promise.resolve();
    await Promise.resolve();
    if (instances[0]) instances[0].isConnected = true;
    const readyCall = instances[0].on.mock.calls.find((c: unknown[]) => c[0] === 'ready');
    const onReady = readyCall![1] as () => void;
    onReady();
    // Drain the ready push and the schedulePush debounce from the
    // config-change.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(instances[0].user?.setActivity).toHaveBeenCalled();
    instances[0].user!.setActivity.mockClear();
    // No cycle tick at the stale 15s speed.
    await vi.advanceTimersByTimeAsync(15_500);
    expect(instances[0].user!.setActivity.mock.calls.length).toBe(0);
    // A cycle tick fires past the new 42s speed.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(instances[0].user!.setActivity.mock.calls.length).toBeGreaterThan(0);
  });
});

describe('boot-unfocused', () => {
  async function bootUnfocused(idleBehavior: 'slow' | 'pause' | 'clear' | 'none'): Promise<() => void> {
    vi.useFakeTimers();
    __setConfig({
      'claudeSpinner.idleBehavior': idleBehavior,
      'claudeSpinner.idleThresholdMinutes': 1,
    });
    mockWindow.state.focused = false;
    extension.activate(mkContext() as never);
    await Promise.resolve();
    await Promise.resolve();
    if (instances[0]) instances[0].isConnected = true;
    const readyCall = instances[0].on.mock.calls.find((c: unknown[]) => c[0] === 'ready');
    return readyCall![1] as () => void;
  }

  it('with idleBehavior=clear, first connect keeps presence cleared', async () => {
    const onReady = await bootUnfocused('clear');
    onReady();
    await vi.advanceTimersByTimeAsync(100);
    expect(instances[0].user?.setActivity).not.toHaveBeenCalled();
    expect(instances[0].user?.clearActivity).toHaveBeenCalled();
  });

  it('with idleBehavior=pause, first connect pushes once (restore) and does not cycle', async () => {
    const onReady = await bootUnfocused('pause');
    onReady();
    await vi.advanceTimersByTimeAsync(100);
    expect(instances[0].user!.setActivity.mock.calls.length).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(instances[0].user!.setActivity.mock.calls.length).toBe(1);
  });

  it('with idleBehavior=slow, first connect pushes + cycles at quadrupled interval', async () => {
    const onReady = await bootUnfocused('slow');
    onReady();
    await vi.advanceTimersByTimeAsync(100);
    const initial = instances[0].user!.setActivity.mock.calls.length;
    expect(initial).toBe(1);
    // cycleSpeed defaults to 15 → slow interval = 60s. No tick at 15s.
    await vi.advanceTimersByTimeAsync(15_500);
    expect(instances[0].user!.setActivity.mock.calls.length).toBe(initial);
    // Tick fires past 60s.
    await vi.advanceTimersByTimeAsync(46_000);
    expect(instances[0].user!.setActivity.mock.calls.length).toBeGreaterThan(initial);
  });

  it('with idleBehavior=none, first connect pushes + cycles at normal interval', async () => {
    const onReady = await bootUnfocused('none');
    onReady();
    await vi.advanceTimersByTimeAsync(100);
    const initial = instances[0].user!.setActivity.mock.calls.length;
    expect(initial).toBe(1);
    // 'none' keeps normal cycling — tick at the 15s default.
    await vi.advanceTimersByTimeAsync(15_500);
    expect(instances[0].user!.setActivity.mock.calls.length).toBeGreaterThan(initial);
  });
});

describe('idle none engagement', () => {
  it('engaging idle with idleBehavior=none is a no-op (cycle continues)', async () => {
    vi.useFakeTimers();
    __setConfig({
      'claudeSpinner.cycleSpeed': 10,
      'claudeSpinner.idleThresholdMinutes': 1,
      'claudeSpinner.idleBehavior': 'none',
    });
    extension.activate(mkContext() as never);
    await Promise.resolve();
    await Promise.resolve();
    if (instances[0]) instances[0].isConnected = true;
    // Fire ready so the cycle starts.
    const readyCall = instances[0].on.mock.calls.find((c: unknown[]) => c[0] === 'ready');
    (readyCall![1] as () => void)();
    await vi.advanceTimersByTimeAsync(100);
    const initial = instances[0].user!.setActivity.mock.calls.length;
    __setFocused(false);
    await vi.advanceTimersByTimeAsync(60_001);
    // Idle engaged (none) — cycle should still tick at cycleSpeed.
    await vi.advanceTimersByTimeAsync(11_000);
    expect(instances[0].user!.setActivity.mock.calls.length).toBeGreaterThan(initial);
  });
});

describe('toggle resume while idle', () => {
  it('resumed payload carries a real word, clears isIdle, and restarts the cycle', async () => {
    // P7: strengthen the assertion side of the existing toggle-resume test.
    // The original test only proved setActivity was called; this one proves
    // the payload is well-formed AND the cycle is re-armed.
    vi.useFakeTimers();
    __setConfig({
      'claudeSpinner.cycleSpeed': 10,
      'claudeSpinner.idleThresholdMinutes': 1,
      'claudeSpinner.idleBehavior': 'clear',
    });
    extension.activate(mkContext() as never);
    await Promise.resolve();
    await Promise.resolve();
    if (instances[0]) instances[0].isConnected = true;
    const onReady = instances[0].on.mock.calls.find((c: unknown[]) => c[0] === 'ready')![1] as () => void;
    onReady();
    await vi.advanceTimersByTimeAsync(100);
    __setFocused(false);
    await vi.advanceTimersByTimeAsync(60_001);
    const toggle = __getRegisteredCommand('claudeSpinner.toggle')!;
    toggle(); // pause
    await Promise.resolve();
    instances[0].user!.setActivity.mockClear();
    toggle(); // resume
    await vi.advanceTimersByTimeAsync(100);
    // Payload assertion: details is a real word with the "..." suffix that
    // buildPresencePayload appends — proves we're NOT emitting a degraded
    // state-only payload.
    expect(instances[0].user!.setActivity.mock.calls.length).toBeGreaterThanOrEqual(1);
    const resumed = instances[0].user!.setActivity.mock.calls[0][0] as { details?: string };
    expect(resumed.details).toMatch(/\.\.\.$/);
    expect(resumed.details!.length).toBeGreaterThan(3);
    // Cycle restart assertion: advance one cycleSpeed and observe a NEW
    // setActivity beyond the resume push.
    const afterResume = instances[0].user!.setActivity.mock.calls.length;
    await vi.advanceTimersByTimeAsync(11_000);
    expect(instances[0].user!.setActivity.mock.calls.length).toBeGreaterThan(afterResume);
  });

  it('overrides idle state so presence reappears immediately', async () => {
    vi.useFakeTimers();
    __setConfig({
      'claudeSpinner.idleThresholdMinutes': 1,
      'claudeSpinner.idleBehavior': 'clear',
    });
    extension.activate(mkContext() as never);
    await Promise.resolve();
    await Promise.resolve();
    if (instances[0]) instances[0].isConnected = true;
    const onReady = instances[0].on.mock.calls.find((c: unknown[]) => c[0] === 'ready')![1] as () => void;
    onReady();
    await vi.advanceTimersByTimeAsync(100);
    // Engage idle FIRST by unfocusing and advancing past the threshold —
    // otherwise a subsequent pause short-circuits the idle timer and the
    // "resume while idle" path is never actually exercised.
    __setFocused(false);
    await vi.advanceTimersByTimeAsync(60_001);
    // Now idle-clear. Pause → still cleared, paused=true, isIdle=true.
    const toggle = __getRegisteredCommand('claudeSpinner.toggle')!;
    toggle();
    await Promise.resolve();
    instances[0].user!.setActivity.mockClear();
    // Resume via toggle — plan says explicit resume must push fresh even
    // though we're still idle and unfocused.
    toggle();
    await vi.advanceTimersByTimeAsync(100);
    expect(instances[0].user?.setActivity).toHaveBeenCalled();
  });
});

describe('toggle command', () => {
  it('clears presence when paused', async () => {
    extension.activate(mkContext() as never);
    await Promise.resolve();
    if (instances[0]) instances[0].isConnected = true;
    const toggle = __getRegisteredCommand('claudeSpinner.toggle')!;
    toggle();
    await Promise.resolve();
    expect(instances[0].user?.clearActivity).toHaveBeenCalled();
  });

  it('pushes presence when resumed from paused', async () => {
    extension.activate(mkContext() as never);
    await Promise.resolve();
    if (instances[0]) instances[0].isConnected = true;
    const toggle = __getRegisteredCommand('claudeSpinner.toggle')!;
    toggle(); // pause
    await Promise.resolve();
    instances[0].user!.setActivity.mockClear();
    toggle(); // resume
    await Promise.resolve();
    // setActivity called asynchronously after resume
    await Promise.resolve();
    expect(instances[0].user?.setActivity).toHaveBeenCalled();
  });
});

describe('audit 47-E2: recentWords gates on delivered', () => {
  // Deterministic rewrite: drive the picker through a presence-module mock
  // so the (state, config, elapsedMs) → word mapping is fully controlled,
  // then inspect the `recent` snapshot captured at each pick site. The
  // gate-on-delivered contract guarantees that a failed push's word does
  // NOT appear in the recent ring observed by the *next* pick.
  it('does NOT add the word to recentWords when pushPresence fails (deterministic)', async () => {
    vi.useFakeTimers();
    // Drive the picker through a fixed sequence: A, B, C. Push 1 succeeds,
    // push 2 fails (B never reaches Discord), push 3 succeeds.
    const sequence = ['Alpha', 'Beta', 'Gamma'];
    let pickIdx = 0;
    presenceMocks.picker = () => sequence[Math.min(pickIdx++, sequence.length - 1)];

    extension.activate(mkContext() as never);
    await Promise.resolve();
    await Promise.resolve();
    if (instances[0]) instances[0].isConnected = true;

    // Push 1: onReady success.
    const readyCall = instances[0].on.mock.calls.find((c: unknown[]) => c[0] === 'ready');
    (readyCall![1] as () => void)();
    await vi.advanceTimersByTimeAsync(100);
    const firstPayload = instances[0].user!.setActivity.mock.calls[0][0] as { details: string };
    expect(firstPayload.details).toBe('Alpha...');

    // Push 2: cycle tick. Force IPC failure for this one.
    instances[0].user!.setActivity.mockRejectedValueOnce(new Error('IPC down'));
    await vi.advanceTimersByTimeAsync(15_100);
    const secondPayload = instances[0].user!.setActivity.mock.calls[1][0] as { details: string };
    expect(secondPayload.details).toBe('Beta...');

    // Push 3: cycle tick. Should succeed.
    await vi.advanceTimersByTimeAsync(15_100);
    const thirdPayload = instances[0].user!.setActivity.mock.calls[2][0] as { details: string };
    expect(thirdPayload.details).toBe('Gamma...');

    // The gate-on-delivered contract: the recent ring observed at pick 3
    // must contain Alpha (delivered) but NOT Beta (failed). Three picks ran
    // in total; the last pickCalls entry is the recent snapshot for push 3.
    expect(presenceMocks.pickCalls).toHaveLength(3);
    const recentAtPick3 = presenceMocks.pickCalls[2].recent;
    expect(recentAtPick3).toContain('Alpha');
    expect(recentAtPick3).not.toContain('Beta');
  });
});

describe('audit B2: resumeAfterReady honors lastWord and invalidates dedup cache', () => {
  it('reconnect during idle "pause" re-emits the same word that was visible pre-disconnect', async () => {
    vi.useFakeTimers();
    __setConfig({
      'claudeSpinner.idleThresholdMinutes': 1,
      'claudeSpinner.idleBehavior': 'pause',
    });
    extension.activate(mkContext() as never);
    await Promise.resolve();
    if (instances[0]) instances[0].isConnected = true;

    // Drive into idle-pause. The applyIdleBehavior('pause') push pins
    // state.lastWord to whatever word was visible when idle engaged.
    __setFocused(false);
    await vi.advanceTimersByTimeAsync(60_001);
    const idleEngageCalls = instances[0].user!.setActivity.mock.calls;
    const lastWordBeforeReconnect = (idleEngageCalls[idleEngageCalls.length - 1][0] as { details: string }).details;
    expect(lastWordBeforeReconnect).toBeDefined();

    // Simulate a Discord reconnect — onReady fires without going through
    // discord.connect() (the real path resets the dedup cache there).
    // Without invalidateDedupCache, the post-reconnect push would be
    // dedup-skipped because the payload hasn't changed.
    instances[0].user!.setActivity.mockClear();
    const readyCall = instances[0].on.mock.calls.find((c: unknown[]) => c[0] === 'ready');
    (readyCall![1] as () => void)();
    await vi.advanceTimersByTimeAsync(100);

    // Exactly one restore push with the SAME word — proves both that
    // useLastWord is honored and that the dedup cache was invalidated.
    expect(instances[0].user!.setActivity.mock.calls.length).toBe(1);
    const reconnectWord = (instances[0].user!.setActivity.mock.calls[0][0] as { details: string }).details;
    expect(reconnectWord).toBe(lastWordBeforeReconnect);
  });
});
