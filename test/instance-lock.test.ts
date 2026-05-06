import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir, userInfo } from 'os';
import { tryAcquire, release } from '../src/instance-lock';

// Mirror src/instance-lock.ts's LOCK_DIR computation so the test can
// inspect on-disk state directly. Keeping the formula here means a future
// refactor of the path scheme will surface as a localized test failure
// rather than a silent skip.
function sanitizeUsername(name: string): string {
  return name.replace(/[/\\]/g, '_');
}
function lockUserSuffix(): string {
  try {
    return sanitizeUsername(userInfo().username);
  } catch {
    return '';
  }
}
const LOCK_DIR = join(
  tmpdir(),
  lockUserSuffix()
    ? `vscode-claude-spinner-presence-${lockUserSuffix()}.lock`
    : 'vscode-claude-spinner-presence.lock',
);
const LOCK_FILE = join(LOCK_DIR, 'owner');

function rmLockDir(): void {
  try {
    rmSync(LOCK_DIR, { recursive: true, force: true });
  } catch {}
}

beforeEach(() => {
  rmLockDir();
});

afterEach(() => {
  // Always release so the heartbeat interval doesn't bleed across tests
  // and keep the next vitest run from inheriting an own-pid lock that the
  // own-pid + dead-heartbeat rule would only reclaim after STALE_MS.
  release();
  rmLockDir();
});

describe('tryAcquire on a clean filesystem', () => {
  it('creates the lock directory, writes the owner file with our pid, and returns true', () => {
    expect(existsSync(LOCK_DIR)).toBe(false);
    const ok = tryAcquire();
    expect(ok).toBe(true);
    expect(existsSync(LOCK_DIR)).toBe(true);
    const raw = readFileSync(LOCK_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as { pid: number; ts: number };
    expect(parsed.pid).toBe(process.pid);
    expect(typeof parsed.ts).toBe('number');
  });
});

describe('tryAcquire contention', () => {
  it('returns false when a fresh foreign-pid lock exists', () => {
    // process.ppid is the test runner's parent (the shell or vitest's
    // worker host) — guaranteed alive while this test is running, and
    // distinct from process.pid so we exercise the foreign-pid branch
    // (not the own-pid + dead-heartbeat self-recovery branch).
    const foreignPid = process.ppid;
    expect(foreignPid).not.toBe(process.pid);
    mkdirSync(LOCK_DIR);
    writeFileSync(
      LOCK_FILE,
      JSON.stringify({ pid: foreignPid, ts: Date.now() }),
    );
    const ok = tryAcquire();
    expect(ok).toBe(false);
    // Ownership wasn't stolen.
    const parsed = JSON.parse(readFileSync(LOCK_FILE, 'utf-8'));
    expect(parsed.pid).toBe(foreignPid);
  });

  it('reclaims a stale foreign-pid lock by removing the dir and rewriting it', () => {
    // ts well past STALE_MS = 120_000 → isStale() returns true regardless
    // of whether the foreign pid is alive.
    mkdirSync(LOCK_DIR);
    const stalePid = 999_999; // unlikely-but-possible-real pid; staleness still wins via timestamp.
    writeFileSync(
      LOCK_FILE,
      JSON.stringify({ pid: stalePid, ts: Date.now() - 10 * 60_000 }),
    );
    const ok = tryAcquire();
    expect(ok).toBe(true);
    const parsed = JSON.parse(readFileSync(LOCK_FILE, 'utf-8'));
    expect(parsed.pid).toBe(process.pid);
  });

  it('reclaims an own-pid stale lock (heartbeat-died self-recovery)', () => {
    // own-pid + ts older than STALE_MS triggers the self-recovery branch
    // documented at instance-lock.ts:65-71. Without this rule, a previous
    // tryAcquire() that wrote our pid then lost the heartbeat would block
    // us forever until VS Code reload.
    mkdirSync(LOCK_DIR);
    writeFileSync(
      LOCK_FILE,
      JSON.stringify({ pid: process.pid, ts: Date.now() - 10 * 60_000 }),
    );
    const ok = tryAcquire();
    expect(ok).toBe(true);
    const parsed = JSON.parse(readFileSync(LOCK_FILE, 'utf-8'));
    expect(parsed.pid).toBe(process.pid);
    // Timestamp must have been refreshed.
    expect(parsed.ts).toBeGreaterThan(Date.now() - 60_000);
  });

  it('cleans up an orphaned lock directory with no owner file (post-crash mkdir)', () => {
    // Simulates a crash between mkdirSync and writeLockData — readLock()
    // returns null but the dir exists. Without the orphan-dir branch at
    // instance-lock.ts:150, mkdirSync would EEXIST forever.
    mkdirSync(LOCK_DIR);
    expect(existsSync(LOCK_FILE)).toBe(false);
    const ok = tryAcquire();
    expect(ok).toBe(true);
    expect(existsSync(LOCK_FILE)).toBe(true);
    const parsed = JSON.parse(readFileSync(LOCK_FILE, 'utf-8'));
    expect(parsed.pid).toBe(process.pid);
  });
});

describe('release', () => {
  it('removes the lock directory when the lock is owned by us', () => {
    expect(tryAcquire()).toBe(true);
    expect(existsSync(LOCK_DIR)).toBe(true);
    release();
    expect(existsSync(LOCK_DIR)).toBe(false);
  });

  it('does NOT remove a lock owned by a foreign pid', () => {
    // Set up a foreign-owned lock without going through tryAcquire (which
    // would steal it). release() must respect the ownership check and
    // leave the dir intact so a sibling VS Code process keeps primary.
    mkdirSync(LOCK_DIR);
    writeFileSync(
      LOCK_FILE,
      JSON.stringify({ pid: 1, ts: Date.now() }),
    );
    release();
    expect(existsSync(LOCK_DIR)).toBe(true);
    const parsed = JSON.parse(readFileSync(LOCK_FILE, 'utf-8'));
    expect(parsed.pid).toBe(1);
  });

  it('is idempotent when no lock exists', () => {
    expect(existsSync(LOCK_DIR)).toBe(false);
    expect(() => release()).not.toThrow();
    expect(existsSync(LOCK_DIR)).toBe(false);
  });
});
