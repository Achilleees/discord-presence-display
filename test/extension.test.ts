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
