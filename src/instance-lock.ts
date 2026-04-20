import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const LOCK_PATH = join(tmpdir(), 'vscode-claude-spinner-presence.lock');

interface LockData {
  pid: number;
}

function readLock(): LockData | null {
  try {
    return JSON.parse(readFileSync(LOCK_PATH, 'utf-8'));
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

export function tryAcquire(): boolean {
  const lock = readLock();
  if (lock && lock.pid !== process.pid && processAlive(lock.pid)) return false;
  try {
    writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid }));
    return true;
  } catch {
    return false;
  }
}

export function release(): void {
  try {
    const lock = readLock();
    if (lock?.pid === process.pid) unlinkSync(LOCK_PATH);
  } catch {}
}
