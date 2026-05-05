import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const LOCK_DIR = join(tmpdir(), 'vscode-claude-spinner-presence.lock');
const LOCK_FILE = join(LOCK_DIR, 'owner');
const STALE_MS = 120_000;
const HEARTBEAT_MS = 30_000;
const RECREATE_RETRIES = 3;
const RECREATE_BACKOFF_MS = 100;

interface LockData {
  pid: number;
  ts: number;
}

let heartbeatInterval: ReturnType<typeof setInterval> | undefined;

function readLock(): LockData | null {
  try {
    return JSON.parse(readFileSync(LOCK_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM on Windows means "process exists but cannot be signalled"
    // (different privilege level, different user). Treat that as alive
    // so two VS Code windows at different elevation levels don't both
    // claim primary.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true;
    return false;
  }
}

function isStale(lock: LockData): boolean {
  // Own-pid + dead heartbeat is also stale. A previous tryAcquire() may
  // have written our pid then failed to verify (antivirus rearm, FS
  // glitch), or release() may have failed to remove the dir (Defender
  // holding handles). Without this rule we permanently self-block until
  // VS Code reload.
  if (lock.pid === process.pid) return Date.now() - lock.ts > STALE_MS;
  if (!processAlive(lock.pid)) return true;
  return Date.now() - lock.ts > STALE_MS;
}

function writeLockData(): void {
  writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, ts: Date.now() }));
}

function sleepSync(ms: number): void {
  // Tiny synchronous backoff for FS retry — node's fs APIs here are sync,
  // so a non-async sleep keeps this module's contract intact. Atomics.wait
  // on a SharedArrayBuffer would be cleaner but isn't worth the surface
  // area for a 100ms FS race.
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Spin. No microtask pumping — this runs at module activation only.
  }
}

// Retry mkdirSync after rmSync to absorb Windows NTFS deletion latency:
// Defender or the Search Indexer can hold a directory handle for a few ms
// after rmSync resolves, causing mkdirSync to throw EEXIST. Without this,
// the user falls back to secondary mode for the full lock-check cadence.
function recreateLockDir(): boolean {
  for (let attempt = 0; attempt < RECREATE_RETRIES; attempt++) {
    try {
      mkdirSync(LOCK_DIR);
      return true;
    } catch {
      if (attempt === RECREATE_RETRIES - 1) return false;
      try { rmSync(LOCK_DIR, { recursive: true, force: true }); } catch {}
      sleepSync(RECREATE_BACKOFF_MS);
    }
  }
  return false;
}

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    try {
      const lock = readLock();
      if (lock?.pid === process.pid) {
        writeLockData();
      } else {
        // Foreign pid took over the file (acquire from another window
        // raced our heartbeat). The heartbeat exists to refresh our
        // ownership timestamp; with no ownership to refresh, ticking
        // is wasted work. Stop quietly — instance-lock is best-effort
        // and the loser's presence has already gone silent at the
        // protocol layer; further heartbeat work won't undo that.
        stopHeartbeat();
      }
    } catch {}
  }, HEARTBEAT_MS);
}

function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = undefined;
  }
}

export function tryAcquire(): boolean {
  const existing = readLock();
  if (existing && !isStale(existing)) return false;

  // Clear the directory whenever we know it needs to be recreated:
  //   - existing was readable but stale
  //   - existing is null but the dir exists (orphaned mkdir from a
  //     crash between mkdirSync and writeLockData, or corrupted JSON)
  // Without the orphan branch, EEXIST would loop forever requiring a
  // manual rm -rf of the lock dir.
  if (existing || existsSync(LOCK_DIR)) {
    try { rmSync(LOCK_DIR, { recursive: true, force: true }); } catch {}
  }

  if (!recreateLockDir()) return false;

  try {
    writeLockData();
    const verify = readLock();
    if (!verify || verify.pid !== process.pid) {
      stopHeartbeat();
      // Verify failed — the file we just wrote isn't readable as our
      // pid. Don't leave a half-formed lock dir on disk; the next
      // tryAcquire would otherwise keep tripping the orphan / own-pid
      // recovery branches forever.
      try { rmSync(LOCK_DIR, { recursive: true, force: true }); } catch {}
      return false;
    }
    startHeartbeat();
    return true;
  } catch {
    try { rmSync(LOCK_DIR, { recursive: true, force: true }); } catch {}
    return false;
  }
}

export function release(): void {
  stopHeartbeat();
  try {
    const lock = readLock();
    if (lock?.pid === process.pid) {
      rmSync(LOCK_DIR, { recursive: true, force: true });
    }
  } catch {}
  // If rmSync silently failed (Defender / Indexer holding a handle), the
  // dir still contains our pid. The own-pid + dead-heartbeat rule in
  // isStale() lets the next tryAcquire reclaim it after STALE_MS rather
  // than self-blocking forever.
}
