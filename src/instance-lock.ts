import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const LOCK_DIR = join(tmpdir(), 'vscode-claude-spinner-presence.lock');
const LOCK_FILE = join(LOCK_DIR, 'owner');
const STALE_MS = 120_000;
const HEARTBEAT_MS = 30_000;

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
  } catch {
    return false;
  }
}

function isStale(lock: LockData): boolean {
  if (lock.pid === process.pid) return false;
  if (!processAlive(lock.pid)) return true;
  return Date.now() - lock.ts > STALE_MS;
}

function writeLockData(): void {
  writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, ts: Date.now() }));
}

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    try {
      const lock = readLock();
      if (lock?.pid === process.pid) writeLockData();
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

  if (existing) {
    try { rmSync(LOCK_DIR, { recursive: true, force: true }); } catch {}
  }

  try {
    mkdirSync(LOCK_DIR);
  } catch {
    return false;
  }

  try {
    writeLockData();
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
}
