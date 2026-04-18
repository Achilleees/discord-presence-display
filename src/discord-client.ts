import { Client } from '@xhayper/discord-rpc';
import type { SetActivity } from '@xhayper/discord-rpc';

interface ClientCallbacks {
  onReady?: () => void;
  onDisconnected?: () => void;
}

let client: Client | null = null;
let inFlightConnect: Promise<void> | null = null;

export function isReady(): boolean {
  return client?.isConnected === true;
}

export async function connect(clientId: string, callbacks: ClientCallbacks = {}): Promise<void> {
  // Serialize concurrent callers. Without this, two connect() calls can
  // interleave across the destroy() await and leak a client whose socket
  // was never closed.
  if (inFlightConnect) await inFlightConnect.catch(() => {});

  const run = (async () => {
    if (client) {
      const previous = client;
      client = null;
      await previous.destroy().catch(() => {});
    }

    const next = new Client({ clientId });
    client = next;

    if (callbacks.onReady) next.on('ready', callbacks.onReady);
    if (callbacks.onDisconnected) next.on('disconnected', callbacks.onDisconnected);

    try {
      await next.login();
    } catch (err) {
      // Only destroy if this instance is still "current" — a concurrent
      // disconnect() may have already destroyed it.
      if (client === next) {
        client = null;
        await next.destroy().catch(() => {});
      }
      throw err;
    }
  })();
  inFlightConnect = run;

  try {
    await run;
  } finally {
    // Only null if we're still the active in-flight. A subsequent connect()
    // may have already replaced us.
    if (inFlightConnect === run) inFlightConnect = null;
  }
}

export async function disconnect(): Promise<void> {
  if (!client) return;
  const c = client;
  client = null;
  await c.destroy().catch(() => {});
}

export async function pushPresence(activity: SetActivity): Promise<boolean> {
  const c = client;
  if (!c?.isConnected) return false;
  try {
    await c.user?.setActivity(activity);
    return true;
  } catch {
    return false;
  }
}

export async function clearPresence(): Promise<void> {
  const c = client;
  if (!c?.isConnected) return;
  await c.user?.clearActivity().catch(() => {});
}
