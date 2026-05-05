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

const TIMED_OUT = Symbol('timed-out');
type Timeout = typeof TIMED_OUT;

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

// Variant that distinguishes "promise resolved with undefined" from
// "deadline elapsed" via a sentinel. Used in pushPresence/clearPresence
// where the IPC roundtrip can hang on suspended-laptop or paged-out
// Discord scenarios — we must know if the call actually completed so we
// can decide whether to revert the dedup cache.
function raceWithDeadline<T>(promise: Promise<T>, ms: number): Promise<T | Timeout> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race<T | Timeout>([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise<Timeout>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), ms);
    }),
  ]);
}

const IPC_DEADLINE_MS = 8_000;

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
    // Re-check after login resolves: a disconnect() that arrived between
    // login start and login success may not have actually torn down
    // `next`'s IPC pipe before login completed. Even if disconnect
    // already nulled `client`, login can still succeed against the open
    // pipe and leave Discord with a "phantom" presence the user
    // explicitly opted out of. Always destroy when wantsConnection is
    // false; destroy() is safe to call twice (the lib treats it as a
    // no-op once the transport is closed).
    if (!wantsConnection) {
      if (client === next) client = null;
      await next.destroy().catch(() => {});
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
  // Publish the destroy promise through inFlightConnect so a subsequent
  // connect() chains off it rather than racing the old transport's
  // shutdown. Without this, rapid disable→enable toggles can create a new
  // Client + login() while the previous client's IPC pipe is still closing.
  // Call c.destroy() synchronously — the connect-side barrier only needs
  // the resulting promise, not a deferred chain.
  const destroying = c.destroy().catch(() => {});
  const prior = inFlightConnect;
  const run: Promise<void> = prior
    ? prior.then(() => destroying, () => destroying)
    : destroying;
  inFlightConnect = run;
  try {
    await run;
  } finally {
    if (inFlightConnect === run) inFlightConnect = null;
  }
}

export async function pushPresence(activity: SetActivity): Promise<boolean> {
  const c = client;
  if (!c?.isConnected) return false;
  if (!c.user) return false;
  const formatted = formatActivity(activity);
  const json = JSON.stringify(formatted);
  if (json === lastPayloadJson) return true;
  // Record intent BEFORE the await so an interleaving clearPresence (which
  // resets the cache after its own await completes) wins the race and the
  // dedup cache can never end up holding a payload Discord just cleared.
  // Revert on failure / timeout so the next attempt isn't silently deduped
  // against an unsent payload.
  const previous = lastPayloadJson;
  lastPayloadJson = json;
  // Bound the IPC roundtrip with a deadline. Without this, a half-broken
  // pipe (laptop suspend, paged-out Discord) hangs the await, the
  // pushImmediate mutex stays held, and presence freezes until VS Code
  // reload. Asymmetric without this with connect()'s own timeout.
  const requested = c.request('SET_ACTIVITY', {
    pid: process.pid,
    activity: formatted,
  });
  // Pre-attach a swallow handler so a late rejection arriving after the
  // deadline already returned us doesn't trigger an unhandled rejection
  // warning. The original promise is still consumed by raceWithDeadline.
  requested.catch(() => {});
  try {
    const result = await raceWithDeadline(requested, IPC_DEADLINE_MS);
    if (result === TIMED_OUT) {
      // Force the next push to re-send unconditionally — we don't know
      // whether Discord received the payload after the deadline. Reverting
      // to `previous` would let a future push that happens to equal
      // `previous` get dedup-skipped, leaving Discord stuck on `json`.
      if (lastPayloadJson === json) lastPayloadJson = undefined;
      return false;
    }
    return true;
  } catch {
    if (lastPayloadJson === json) lastPayloadJson = previous;
    return false;
  }
}

export async function clearPresence(): Promise<void> {
  const c = client;
  if (!c?.isConnected) return;
  // Reset the cache AFTER the await so an interleaving pushPresence that
  // set its intent before our await can't be steamrolled by a stale
  // pre-await reset. Once Discord acknowledges the clear, the cache truly
  // reflects "nothing on the wire".
  // Bounded with a deadline for the same reason as pushPresence — a hung
  // IPC must not freeze the caller.
  const clearing = c.user?.clearActivity();
  if (clearing) {
    // Pre-attach a swallow to the original promise for late rejections
    // arriving after the race resolves. raceWithDeadline wraps `clearing`
    // in `.finally()`, which propagates rejection — so the await itself
    // must also be guarded, or `void clearPresence()` callers leak an
    // unhandled rejection that violates the "Discord stays silent" invariant.
    clearing.catch(() => {});
    try {
      await raceWithDeadline(clearing, IPC_DEADLINE_MS);
    } catch {
      // Discord-side IPC failure; cache reset below still applies.
    }
  }
  lastPayloadJson = undefined;
}
