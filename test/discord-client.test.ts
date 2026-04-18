import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import * as discord from '../src/discord-client';

beforeEach(async () => {
  instances.length = 0;
  await discord.disconnect();
});

describe('connect', () => {
  it('creates a Client with the given clientId and calls login', async () => {
    await discord.connect('test-id');
    expect(instances).toHaveLength(1);
    expect(instances[0].clientId).toBe('test-id');
    expect(instances[0].login).toHaveBeenCalledOnce();
  });

  it('destroys previous client before creating a new one (reconnect cleanup)', async () => {
    await discord.connect('first');
    await discord.connect('second');
    expect(instances).toHaveLength(2);
    expect(instances[0].destroy).toHaveBeenCalledOnce();
    expect(instances[1].destroy).not.toHaveBeenCalled();
  });

  it('swallows destroy errors on previous client', async () => {
    await discord.connect('first');
    instances[0].destroy.mockRejectedValueOnce(new Error('boom'));
    await expect(discord.connect('second')).resolves.not.toThrow();
  });

  it('wires onReady and onDisconnected callbacks', async () => {
    const onReady = vi.fn();
    const onDisconnected = vi.fn();
    await discord.connect('test-id', { onReady, onDisconnected });
    const onCalls = instances[0].on.mock.calls;
    expect(onCalls.some(([event]) => event === 'ready')).toBe(true);
    expect(onCalls.some(([event]) => event === 'disconnected')).toBe(true);
  });

  it('clears internal client when login throws', async () => {
    await discord.connect('first');
    const nextIndex = instances.length;
    // Prepare the next instance's login to reject. The mock constructor
    // pushes to `instances` on `new`, so we patch after construction via
    // a small trick: override the Client's login just before connect runs.
    // Easiest path: spy on the array push then swap.
    const originalPush = instances.push.bind(instances);
    instances.push = (...args: ClientInstance[]) => {
      for (const inst of args) {
        inst.login = vi.fn().mockRejectedValue(new Error('no socket'));
      }
      return originalPush(...args);
    };
    try {
      await expect(discord.connect('fails')).rejects.toThrow('no socket');
    } finally {
      instances.push = originalPush;
    }
    expect(instances).toHaveLength(nextIndex + 1);
    expect(discord.isReady()).toBe(false);
  });
});

describe('pushPresence / clearPresence', () => {
  it('no-ops when not connected', async () => {
    await discord.pushPresence({ details: 'test' });
    await discord.clearPresence();
    // No assertions — should not throw.
  });

  it('calls setActivity when connected', async () => {
    await discord.connect('id');
    instances[0].isConnected = true;
    await discord.pushPresence({ details: 'Thinking...' });
    expect(instances[0].user?.setActivity).toHaveBeenCalledWith({ details: 'Thinking...' });
  });

  it('calls clearActivity when connected', async () => {
    await discord.connect('id');
    instances[0].isConnected = true;
    await discord.clearPresence();
    expect(instances[0].user?.clearActivity).toHaveBeenCalled();
  });
});

describe('disconnect', () => {
  it('no-ops when no client', async () => {
    await expect(discord.disconnect()).resolves.not.toThrow();
  });

  it('destroys the active client', async () => {
    await discord.connect('id');
    await discord.disconnect();
    expect(instances[0].destroy).toHaveBeenCalledOnce();
    expect(discord.isReady()).toBe(false);
  });
});
