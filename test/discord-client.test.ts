import { describe, it, expect, vi, beforeEach } from 'vitest';

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
        // Bridge request → setActivity so spies on setActivity still fire.
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
  it('no-ops when not connected (returns false from pushPresence)', async () => {
    expect(discord.isReady()).toBe(false);
    await expect(discord.pushPresence({ details: 'test' })).resolves.toBe(false);
    await expect(discord.clearPresence()).resolves.toBeUndefined();
    expect(discord.isReady()).toBe(false);
  });

  it('calls setActivity when connected and returns true', async () => {
    await discord.connect('id');
    instances[0].isConnected = true;
    const ok = await discord.pushPresence({ details: 'Thinking...' });
    expect(ok).toBe(true);
    expect(instances[0].user?.setActivity).toHaveBeenCalledWith(
      expect.objectContaining({ details: 'Thinking...' }),
    );
  });

  it('returns false when setActivity rejects', async () => {
    await discord.connect('id');
    instances[0].isConnected = true;
    instances[0].user!.setActivity.mockRejectedValueOnce(new Error('boom'));
    const ok = await discord.pushPresence({ details: 'x' });
    expect(ok).toBe(false);
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

describe('formatActivity created_at stability', () => {
  // P1: The whole reason discord-client.ts exists. Inspect the wire payload
  // sent through request('SET_ACTIVITY', ...) instead of the bridged
  // setActivity call so a regression in formatActivity is observable.
  function getRequestPayload(inst: ClientInstance, callIndex: number): Record<string, unknown> {
    const call = inst.request.mock.calls[callIndex];
    expect(call?.[0]).toBe('SET_ACTIVITY');
    return (call[1] as { activity: Record<string, unknown> }).activity;
  }

  it('emits identical created_at across multiple pushes within one connect()', async () => {
    await discord.connect('id');
    instances[0].isConnected = true;
    await discord.pushPresence({ details: 'first' });
    await discord.pushPresence({ details: 'second' });
    const first = getRequestPayload(instances[0], 0);
    const second = getRequestPayload(instances[0], 1);
    expect(typeof first.created_at).toBe('number');
    expect(first.created_at).toBe(second.created_at);
  });

  it('emits a different created_at across reconnects (sessionCreatedAt resets)', async () => {
    await discord.connect('first');
    instances[0].isConnected = true;
    await discord.pushPresence({ details: 'a' });
    const firstCreatedAt = getRequestPayload(instances[0], 0).created_at;
    // Force a measurable gap so Date.now() advances between sessions —
    // sessionCreatedAt is captured at connect() time and otherwise both
    // pushes might land on the same millisecond.
    await new Promise((r) => setTimeout(r, 5));
    await discord.connect('second');
    instances[1].isConnected = true;
    await discord.pushPresence({ details: 'a' });
    const secondCreatedAt = getRequestPayload(instances[1], 0).created_at;
    expect(typeof firstCreatedAt).toBe('number');
    expect(typeof secondCreatedAt).toBe('number');
    expect(secondCreatedAt).not.toBe(firstCreatedAt);
  });

  it('flattens largeImageKey/smallImageKey into assets and omits assets when no keys', async () => {
    await discord.connect('id');
    instances[0].isConnected = true;
    await discord.pushPresence({
      details: 'with-assets',
      largeImageKey: 'big',
      smallImageKey: 'small',
      largeImageText: 'Big',
      smallImageText: 'Small',
    });
    await discord.pushPresence({ details: 'without-assets' });
    const withAssets = getRequestPayload(instances[0], 0);
    const withoutAssets = getRequestPayload(instances[0], 1);
    expect(withAssets.assets).toEqual({
      large_image: 'big',
      small_image: 'small',
      large_text: 'Big',
      small_text: 'Small',
    });
    expect(withoutAssets.assets).toBeUndefined();
    // Wire-format invariant: instance is always present and false.
    expect(withAssets.instance).toBe(false);
    expect(withoutAssets.instance).toBe(false);
  });
});

describe('pushPresence dedup cache', () => {
  // P2: identical payload should be deduped; clearPresence resets the cache.
  it('skips request() on identical consecutive payloads', async () => {
    await discord.connect('id');
    instances[0].isConnected = true;
    await discord.pushPresence({ details: 'same' });
    await discord.pushPresence({ details: 'same' });
    expect(instances[0].request).toHaveBeenCalledTimes(1);
  });

  it('re-fires after clearPresence resets the cache', async () => {
    await discord.connect('id');
    instances[0].isConnected = true;
    await discord.pushPresence({ details: 'same' });
    await discord.clearPresence();
    await discord.pushPresence({ details: 'same' });
    expect(instances[0].request).toHaveBeenCalledTimes(2);
  });

  it('reverts the cache on rejection so a retry of the same payload re-fires (P3)', async () => {
    await discord.connect('id');
    instances[0].isConnected = true;
    instances[0].user!.setActivity.mockRejectedValueOnce(new Error('ipc fail'));
    const first = await discord.pushPresence({ details: 'retry-me' });
    expect(first).toBe(false);
    const second = await discord.pushPresence({ details: 'retry-me' });
    expect(second).toBe(true);
    expect(instances[0].request).toHaveBeenCalledTimes(2);
  });
});

describe('IPC deadline timeouts', () => {
  // P4: pushPresence that hangs past 8s resolves false and wipes the cache.
  it('pushPresence resolves false after 8s deadline and forces re-fire on next push', async () => {
    vi.useFakeTimers();
    try {
      await discord.connect('id');
      instances[0].isConnected = true;
      // Make setActivity hang forever — request() will inherit the hang.
      instances[0].user!.setActivity.mockImplementation(() => new Promise<void>(() => {}));
      const p = discord.pushPresence({ details: 'hang' });
      // Advance past the 8s deadline.
      await vi.advanceTimersByTimeAsync(8_001);
      const result = await p;
      expect(result).toBe(false);
      // Cache was force-cleared; identical next push must re-fire.
      // Swap to a resolving impl so the second push completes.
      instances[0].user!.setActivity.mockImplementation(() => Promise.resolve(undefined));
      const result2 = await discord.pushPresence({ details: 'hang' });
      expect(result2).toBe(true);
      expect(instances[0].request).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  // P5: clearPresence that hangs past 8s resolves; a late rejection must not
  // surface as an unhandled rejection.
  it('clearPresence resolves within 8s deadline and swallows late rejection', async () => {
    vi.useFakeTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    try {
      await discord.connect('id');
      instances[0].isConnected = true;
      let rejectLate: ((err: Error) => void) | undefined;
      instances[0].user!.clearActivity.mockImplementation(
        () => new Promise<void>((_, reject) => { rejectLate = reject; }),
      );
      const p = discord.clearPresence();
      await vi.advanceTimersByTimeAsync(8_001);
      await expect(p).resolves.toBeUndefined();
      // Now reject the original promise — should be swallowed.
      rejectLate!(new Error('late ipc fail'));
      // Drain microtasks so any unhandled rejection would surface.
      await Promise.resolve();
      await Promise.resolve();
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      vi.useRealTimers();
    }
  });
});

describe('connect/disconnect concurrency', () => {
  // P6: disconnect arriving during connect's slow login must not leave a
  // surviving client. The wantsConnection re-check after login should null
  // and destroy the just-logged-in instance.
  it('disconnect during slow login destroys the orphan client and leaves no active connection', async () => {
    let resolveLogin: (() => void) | undefined;
    const slowLogin = new Promise<void>((resolve) => { resolveLogin = resolve; });
    // Patch the next constructed instance's login to hang.
    const originalPush = instances.push.bind(instances);
    instances.push = (...args: ClientInstance[]) => {
      for (const inst of args) inst.login = vi.fn().mockReturnValue(slowLogin);
      return originalPush(...args);
    };
    try {
      const connectP = discord.connect('id');
      // Microtask: lets connect() create the Client and start awaiting login.
      await Promise.resolve();
      // Disconnect while login is still pending. wantsConnection flips false.
      const disconnectP = discord.disconnect();
      // Now resolve login — connect's post-login wantsConnection re-check
      // must observe the false flag and destroy the orphan.
      resolveLogin!();
      await connectP;
      await disconnectP;
      expect(instances).toHaveLength(1);
      // Must be called twice: once by disconnect()'s own teardown, once
      // by connect()'s post-login wantsConnection re-check that nulls the
      // orphan. A single call would mean the post-login guard was skipped
      // and a stale client survived.
      expect(instances[0].destroy).toHaveBeenCalledTimes(2);
      expect(discord.isReady()).toBe(false);
    } finally {
      instances.push = originalPush;
    }
  });
});
