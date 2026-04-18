import { Client } from '@xhayper/discord-rpc';
import type { SetActivity } from '@xhayper/discord-rpc';

interface ClientCallbacks {
  onReady?: () => void;
  onDisconnected?: () => void;
}

let client: Client | null = null;

export function isReady(): boolean {
  return client?.isConnected === true;
}

export async function connect(clientId: string, callbacks: ClientCallbacks = {}): Promise<void> {
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
    if (client === next) client = null;
    await next.destroy().catch(() => {});
    throw err;
  }
}

export async function disconnect(): Promise<void> {
  if (!client) return;
  const c = client;
  client = null;
  await c.destroy().catch(() => {});
}

export async function pushPresence(activity: SetActivity): Promise<void> {
  const c = client;
  if (!c?.isConnected) return;
  await c.user?.setActivity(activity).catch(() => {});
}

export async function clearPresence(): Promise<void> {
  const c = client;
  if (!c?.isConnected) return;
  await c.user?.clearActivity().catch(() => {});
}
