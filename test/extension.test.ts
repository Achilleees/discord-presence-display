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
import { __setConfig, __resetConfig, __resetCommands, __getRegisteredCommand } from 'vscode';
import * as extension from '../src/extension';

function mkContext(): { subscriptions: { dispose: () => void }[] } {
  return { subscriptions: [] };
}

beforeEach(() => {
  __resetConfig();
  __resetCommands();
  instances.length = 0;
});

afterEach(() => {
  extension.deactivate();
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
