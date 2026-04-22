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
// Stable per-connection timestamp. The library's setActivity() hardcodes
// created_at: Date.now() on every call, making Discord treat each update
// as a new activity — the voice-channel icon disappears and reappears.
let sessionCreatedAt: number | undefined;
let lastPayloadJson: string | undefined;

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

function formatActivity(activity: SetActivity): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: activity.type ?? 0,
    created_at: sessionCreatedAt ?? Date.now(),
    instance: false,
  };

  if (activity.details) out.details = activity.details;
  if (activity.state) out.state = activity.state;

  if (activity.startTimestamp !== undefined || activity.endTimestamp !== undefined) {
    const timestamps: Record<string, number> = {};
    if (activity.startTimestamp instanceof Date) {
      timestamps.start = activity.startTimestamp.getTime();
    } else if (typeof activity.startTimestamp === 'number') {
      timestamps.start = activity.startTimestamp;
    }
    if (activity.endTimestamp instanceof Date) {
      timestamps.end = activity.endTimestamp.getTime();
    } else if (typeof activity.endTimestamp === 'number') {
      timestamps.end = activity.endTimestamp;
    }
    out.timestamps = timestamps;
  }

  if (activity.largeImageKey || activity.smallImageKey ||
      activity.largeImageText || activity.smallImageText) {
    const assets: Record<string, string> = {};
    if (activity.largeImageKey) assets.large_image = activity.largeImageKey;
    if (activity.smallImageKey) assets.small_image = activity.smallImageKey;
    if (activity.largeImageText) assets.large_text = activity.largeImageText;
    if (activity.smallImageText) assets.small_text = activity.smallImageText;
    out.assets = assets;
  }

  if (activity.statusDisplayType !== undefined) {
    out.status_display_type = activity.statusDisplayType;
  }

  return out;
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
    sessionCreatedAt = Date.now();
    lastPayloadJson = undefined;

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
  lastPayloadJson = undefined;
  if (!client) return;
  const c = client;
  client = null;
  await c.destroy().catch(() => {});
}

export async function pushPresence(activity: SetActivity): Promise<boolean> {
  const c = client;
  if (!c?.isConnected) return false;
  if (!c.user) return false;
  try {
    const formatted = formatActivity(activity);
    const json = JSON.stringify(formatted);
    if (json === lastPayloadJson) return true;

    await c.request('SET_ACTIVITY', {
      pid: process.pid,
      activity: formatted,
    });
    lastPayloadJson = json;
    return true;
  } catch {
    return false;
  }
}

export async function clearPresence(): Promise<void> {
  const c = client;
  if (!c?.isConnected) return;
  lastPayloadJson = undefined;
  await c.user?.clearActivity().catch(() => {});
}
