import { Client } from '@xhayper/discord-rpc';
import type { SetActivity } from '@xhayper/discord-rpc';

interface ClientCallbacks {
  onReady?: () => void;
  onDisconnected?: () => void;
}

let client: Client | null = null;
let inFlightConnect: Promise<void> | null = null;
// Tracks the caller's most recent intent. connect() sets this true; disconnect()
// sets it false. The connect() body re-checks this after its mid-destroy await
// window so a disconnect() that arrived during that window (when `client` is
// transiently null) doesn't get steamrolled by a subsequent login.
let wantsConnection = false;

function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race<T | undefined>([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), ms);
    }),
  ]);
}

export function isReady(): boolean {
  return client?.isConnected === true;
}

export async function connect(clientId: string, callbacks: ClientCallbacks = {}): Promise<void> {
  wantsConnection = true;
  // Serialize concurrent callers by chaining. Two-or-more callers awaiting
  // the same prior promise would previously fork — each create their own
  // Client — and leak sockets. Chaining off `inFlightConnect` at call time
  // (rather than at "ready to run" time) ensures each caller's body starts
  // only after all prior callers' bodies complete.
  const prior = inFlightConnect;
  const run: Promise<void> = (async () => {
    if (prior) await prior.catch(() => {});
    if (!wantsConnection) return;

    if (client) {
      const previous = client;
      client = null;
      await raceWithTimeout(previous.destroy().catch(() => {}), 3_000);
    }

    // Re-check after the destroy window: a concurrent disconnect() that
    // arrived while client was null would have bailed early, so we'd
    // otherwise resurrect a connection the user explicitly tore down.
    if (!wantsConnection) return;

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
  wantsConnection = false;
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
