import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type ClientInstance = {
  clientId: string;
  login: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
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
        instances.push(this as unknown as ClientInstance);
      }
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
    vi.advanceTimersByTime(60_000 + 1);
    await Promise.resolve();
    const readyCall = instances[0].on.mock.calls.find((c: unknown[]) => c[0] === 'ready');
    const onReady = readyCall![1] as () => void;
    instances[0].user!.setActivity.mockClear();
    onReady();
    await Promise.resolve();
    // Exactly one restore push, no further pushes from a cycle tick.
    expect(instances[0].user!.setActivity.mock.calls.length).toBe(1);
    vi.advanceTimersByTime(60_000);
    await Promise.resolve();
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
    // Pause (clears presence).
    const toggle = __getRegisteredCommand('claudeSpinner.toggle')!;
    toggle();
    await Promise.resolve();
    // Unfocus to become idle while paused.
    __setFocused(false);
    await vi.advanceTimersByTimeAsync(60_001);
    instances[0].user!.setActivity.mockClear();
    // Resume via toggle — even though still idle and unfocused, plan says
    // explicit resume should push fresh.
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
