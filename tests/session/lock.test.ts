/**
 * ABOUTME: Tests for synchronous lock cleanup and startup signal ownership.
 * Covers owned-lock release, listener handoff, and signal exit behavior.
 */

import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireLockWithPrompt,
  acquireLockExclusive,
  acquireLockExclusiveResult,
  ownsLock,
  registerLockCleanupHandlers,
  releaseLock,
  releaseLockSync,
} from '../../src/session/lock.js';
import type { LockFile } from '../../src/session/types.js';

const SESSION_DIR = '.ralph-tui';
const LOCK_FILE = 'ralph.lock';
const GUARD_FILE = 'ralph.lock.guard';
const GUARD_TEMP_PREFIX = `${GUARD_FILE}.`;
const READY_MARKER = 'LOCK_TEST_READY';

interface LockGuardRecord {
  pid: number;
  guardId: string;
  acquiredAt: string;
}

let tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'ralph-lock-'));
  tempDirs.push(tempDir);
  return tempDir;
}

function lockPath(cwd: string): string {
  return join(cwd, SESSION_DIR, LOCK_FILE);
}

async function writeLock(
  cwd: string,
  pid: number,
  lockId?: string
): Promise<void> {
  await mkdir(join(cwd, SESSION_DIR), { recursive: true });
  const lock: LockFile = {
    lockId,
    pid,
    sessionId: 'lock-test-session',
    acquiredAt: new Date().toISOString(),
    cwd,
    hostname: 'lock-test-host',
  };
  await writeFile(lockPath(cwd), JSON.stringify(lock), 'utf-8');
}

function guardPath(cwd: string): string {
  return join(cwd, SESSION_DIR, GUARD_FILE);
}

function guardTempPath(cwd: string, id: string): string {
  return join(cwd, SESSION_DIR, `${GUARD_TEMP_PREFIX}${id}.tmp`);
}

async function writeGuard(
  cwd: string,
  pid: number,
  acquiredAt = new Date().toISOString()
): Promise<void> {
  await mkdir(join(cwd, SESSION_DIR), { recursive: true });
  await writeFile(
    guardPath(cwd),
    JSON.stringify({
      pid,
      guardId: `guard-${Date.now()}-${Math.random()}`,
      acquiredAt,
    }),
    'utf-8'
  );
}

async function writeMalformedGuard(
  cwd: string,
  contents: string
): Promise<void> {
  await mkdir(join(cwd, SESSION_DIR), { recursive: true });
  await writeFile(guardPath(cwd), contents, 'utf-8');
}

async function ageFile(path: string, ageMs: number): Promise<void> {
  const timestamp = new Date(Date.now() - ageMs);
  await utimes(path, timestamp, timestamp);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function canStillCreateFilesIn(directory: string): Promise<boolean> {
  const probePath = join(
    directory,
    `.lock-test-probe-${process.pid}-${Date.now()}-${Math.random()}`
  );

  try {
    await writeFile(probePath, 'probe', 'utf-8');
    await rm(probePath, { force: true });
    return true;
  } catch (error) {
    await rm(probePath, { force: true });
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') {
      return false;
    }
    throw error;
  }
}

async function waitForReadyFile(path: string, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await pathExists(path)) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for ${READY_MARKER}`);
}

async function runSignalChild(
  signal: 'SIGTERM' | 'SIGINT',
  expectedExitCode: number
): Promise<void> {
  const cwd = await createTempDir();
  const readyPath = join(cwd, 'ready-marker');
  const modulePath = join(process.cwd(), 'src/session/lock.ts');
  const scriptPath = join(cwd, 'signal-child.ts');
  const script = `
import { writeFile } from 'node:fs/promises';
import {
  acquireLockWithPrompt,
  registerLockCleanupHandlers,
} from ${JSON.stringify(modulePath)};

const cwd = process.argv[2];
const readyPath = process.argv[3];
const result = await acquireLockWithPrompt(cwd, 'signal-child', {
  nonInteractive: true,
});
if (!result.acquired) {
  process.exit(2);
}
registerLockCleanupHandlers(cwd);
console.log(${JSON.stringify(READY_MARKER)});
await writeFile(readyPath, ${JSON.stringify(READY_MARKER)}, 'utf-8');
setInterval(() => {}, 1000);
`;
  await writeFile(scriptPath, script, 'utf-8');

  const child = Bun.spawn([process.execPath, scriptPath, cwd, readyPath], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  try {
    await waitForReadyFile(readyPath);
    child.kill(signal);
    const exitCode = await child.exited;
    expect(exitCode).toBe(expectedExitCode);
    expect(await pathExists(lockPath(cwd))).toBe(false);
  } finally {
    if (!child.killed) {
      child.kill('SIGKILL');
      await child.exited;
    }
  }
}

async function spawnLockChild(
  cwd: string,
  readyPath: string,
  mode: 'owner' | 'force',
  startedPath?: string
) {
  const modulePath = join(process.cwd(), 'src/session/lock.ts');
  const scriptPath = join(cwd, `${mode}-child.ts`);
  const script = `
import { readFile, writeFile } from 'node:fs/promises';
import {
  acquireLockWithPrompt,
  registerLockCleanupHandlers,
} from ${JSON.stringify(modulePath)};

const cwd = process.argv[2];
const readyPath = process.argv[3];
const startedPath = process.argv[4];
if (startedPath) {
  await writeFile(startedPath, 'started', 'utf-8');
}
const result = await acquireLockWithPrompt(cwd, ${JSON.stringify(mode)}, {
  force: ${mode === 'force'},
  nonInteractive: true,
});
if (!result.acquired) {
  process.exit(2);
}
registerLockCleanupHandlers(cwd);
const lock = JSON.parse(await readFile(cwd + '/.ralph-tui/ralph.lock', 'utf-8'));
await writeFile(readyPath, lock.lockId, 'utf-8');
setInterval(() => {}, 1000);
`;
  await writeFile(scriptPath, script, 'utf-8');

  return Bun.spawn(
    [
      process.execPath,
      scriptPath,
      cwd,
      readyPath,
      ...(startedPath ? [startedPath] : []),
    ],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    }
  );
}

async function spawnPartialGuardChild(
  cwd: string,
  readyPath: string
): Promise<Bun.Subprocess> {
  const scriptPath = join(cwd, 'partial-guard-child.ts');
  const guardFilePath = guardPath(cwd);
  const sessionDirPath = join(cwd, SESSION_DIR);
  const script = `
import { closeSync, mkdirSync, openSync, writeFileSync } from 'node:fs';

const guardPath = ${JSON.stringify(guardFilePath)};
const readyPath = process.argv[2];
mkdirSync(${JSON.stringify(sessionDirPath)}, { recursive: true });
const fileDescriptor = openSync(guardPath, 'wx');
closeSync(fileDescriptor);
writeFileSync(readyPath, ${JSON.stringify(READY_MARKER)}, 'utf-8');
`;
  await writeFile(scriptPath, script, 'utf-8');

  return Bun.spawn([process.execPath, scriptPath, readyPath], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

afterEach(async () => {
  for (const tempDir of tempDirs) {
    await rm(tempDir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('releaseLockSync', () => {
  test('removes a lock owned by the current process', async () => {
    const cwd = await createTempDir();
    await writeLock(cwd, process.pid);

    releaseLockSync(cwd);

    expect(await pathExists(lockPath(cwd))).toBe(false);
  });

  test('leaves a lock owned by another process untouched', async () => {
    const cwd = await createTempDir();
    await writeLock(cwd, process.pid + 1);
    const before = await readFile(lockPath(cwd), 'utf-8');

    releaseLockSync(cwd);

    expect(await pathExists(lockPath(cwd))).toBe(true);
    expect(await readFile(lockPath(cwd), 'utf-8')).toBe(before);
  });

  test('does nothing when the lock file is missing', async () => {
    const cwd = await createTempDir();

    expect(() => releaseLockSync(cwd)).not.toThrow();
    expect(await pathExists(lockPath(cwd))).toBe(false);
  });

  test('does nothing when the lock file is corrupt', async () => {
    const cwd = await createTempDir();
    await mkdir(join(cwd, SESSION_DIR), { recursive: true });
    await writeFile(lockPath(cwd), 'not-json', 'utf-8');

    expect(() => releaseLockSync(cwd)).not.toThrow();
    expect(await pathExists(lockPath(cwd))).toBe(true);
  });

  test('leaves the lock when guard creation fails unexpectedly', async () => {
    const cwd = await createTempDir();
    const acquired = await acquireLockWithPrompt(cwd, 'guard-creation-error');
    expect(acquired.acquired).toBe(true);
    const sessionDir = join(cwd, SESSION_DIR);

    await chmod(sessionDir, 0o555);
    try {
      if (await canStillCreateFilesIn(sessionDir)) {
        console.warn(
          'skipping guard-creation-failure assertions: session dir still writable'
        );
      } else {
        expect(() => releaseLockSync(cwd)).not.toThrow();
        expect(await pathExists(lockPath(cwd))).toBe(true);
      }
    } finally {
      await chmod(sessionDir, 0o755);
      await releaseLock(cwd);
    }
  });
});

describe('lock identity and guard protocol', () => {
  test('reports ownership for a lock held by the current process', async () => {
    const cwd = await createTempDir();
    const acquired = await acquireLockWithPrompt(cwd, 'owns-lock');

    expect(acquired.acquired).toBe(true);
    expect(await ownsLock(cwd)).toBe(true);

    await releaseLock(cwd);
  });

  test('reports false when the lock file is absent', async () => {
    const cwd = await createTempDir();

    expect(await ownsLock(cwd)).toBe(false);
  });

  test('reports false for a foreign lock identity', async () => {
    const cwd = await createTempDir();
    await writeLock(cwd, process.pid + 1, 'foreign-lock-id');

    expect(await ownsLock(cwd)).toBe(false);
  });

  test('async and sync release remove a lock with the current lock identity', async () => {
    const asyncCwd = await createTempDir();
    const asyncAcquired = await acquireLockWithPrompt(asyncCwd, 'async-release');
    expect(asyncAcquired.acquired).toBe(true);
    await releaseLock(asyncCwd);
    expect(await pathExists(lockPath(asyncCwd))).toBe(false);

    const syncCwd = await createTempDir();
    const syncAcquired = await acquireLockWithPrompt(syncCwd, 'sync-release');
    expect(syncAcquired.acquired).toBe(true);
    releaseLockSync(syncCwd);
    expect(await pathExists(lockPath(syncCwd))).toBe(false);
  });

  test('releases locks independently in two working directories', async () => {
    const firstCwd = await createTempDir();
    const secondCwd = await createTempDir();
    const firstAcquired = await acquireLockWithPrompt(firstCwd, 'first-cwd');
    const secondAcquired = await acquireLockWithPrompt(secondCwd, 'second-cwd');
    expect(firstAcquired.acquired).toBe(true);
    expect(secondAcquired.acquired).toBe(true);

    await releaseLock(firstCwd);
    expect(await pathExists(lockPath(firstCwd))).toBe(false);
    expect(await pathExists(lockPath(secondCwd))).toBe(true);

    await releaseLock(secondCwd);
    expect(await pathExists(lockPath(secondCwd))).toBe(false);
  });

  test('returns conflict details for an existing lock', async () => {
    const cwd = await createTempDir();
    await writeLock(cwd, process.pid, 'foreign-lock-id');

    const result = await acquireLockExclusiveResult(cwd, 'conflict-test');

    expect(result.acquired).toBe(false);
    expect(result.existingPid).toBe(process.pid);
    expect(result.error).toContain(`PID: ${process.pid}`);
  });

  test('preserves the boolean exclusive acquisition contract', async () => {
    const cwd = await createTempDir();

    const acquired = await acquireLockExclusive(cwd, 'boolean-test');
    expect(acquired).toBe(true);
    await releaseLock(cwd);

    await writeLock(cwd, process.pid, 'existing-lock-id');
    const blocked = await acquireLockExclusive(cwd, 'boolean-test-blocked');
    expect(blocked).toBe(false);
  });

  test('foreign lock identity is not released when the pid matches', async () => {
    const cwd = await createTempDir();
    const acquired = await acquireLockWithPrompt(cwd, 'identity-test');
    expect(acquired.acquired).toBe(true);
    await writeLock(cwd, process.pid, 'foreign-lock-id');

    await releaseLock(cwd);

    expect(await pathExists(lockPath(cwd))).toBe(true);
    releaseLockSync(cwd);
    expect(await pathExists(lockPath(cwd))).toBe(true);
  });

  test('legacy lock with the current pid remains releasable', async () => {
    const cwd = await createTempDir();
    await writeLock(cwd, process.pid);

    releaseLockSync(cwd);

    expect(await pathExists(lockPath(cwd))).toBe(false);
  });

  test('waits for a live guard before releasing the lock', async () => {
    const cwd = await createTempDir();
    const acquired = await acquireLockWithPrompt(cwd, 'guard-test');
    expect(acquired.acquired).toBe(true);
    await writeGuard(cwd, process.pid);

    const releasePromise = releaseLock(cwd);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await pathExists(lockPath(cwd))).toBe(true);
      expect(await pathExists(guardPath(cwd))).toBe(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }

    await rm(guardPath(cwd), { force: true });
    await releasePromise;
    expect(await pathExists(lockPath(cwd))).toBe(false);
  });

  test(
    'leaves the lock after an async guard timeout',
    async () => {
      const cwd = await createTempDir();
      const acquired = await acquireLockWithPrompt(cwd, 'async-budget-test');
      expect(acquired.acquired).toBe(true);
      await writeGuard(cwd, process.pid);

      const startedAt = Date.now();
      await releaseLock(cwd);
      const elapsed = Date.now() - startedAt;

      expect(elapsed).toBeGreaterThanOrEqual(1900);
      expect(await pathExists(lockPath(cwd))).toBe(true);
      await rm(guardPath(cwd), { force: true });
    },
    5000
  );

  test(
    'returns the guard timeout reason from exclusive acquisition',
    async () => {
      const cwd = await createTempDir();
      await writeGuard(cwd, process.pid);

      const startedAt = Date.now();
      const result = await acquireLockExclusiveResult(cwd, 'guard-timeout');
      const elapsed = Date.now() - startedAt;

      expect(result.acquired).toBe(false);
      expect(result.error).toBe(
        'Timed out waiting for the session lock (another ralph-tui process may be starting or exiting)'
      );
      expect(elapsed).toBeGreaterThanOrEqual(1900);
      expect(await pathExists(guardPath(cwd))).toBe(true);
      await rm(guardPath(cwd), { force: true });
    },
    5000
  );

  test('breaks a stale guard before releasing the lock', async () => {
    const cwd = await createTempDir();
    const acquired = await acquireLockWithPrompt(cwd, 'stale-guard-test');
    expect(acquired.acquired).toBe(true);
    await writeGuard(cwd, 2147483647);

    await releaseLock(cwd);

    expect(await pathExists(lockPath(cwd))).toBe(false);
    expect(await pathExists(guardPath(cwd))).toBe(false);
  });

  test('leaves the lock after the sync guard budget expires', async () => {
    const cwd = await createTempDir();
    const acquired = await acquireLockWithPrompt(cwd, 'sync-budget-test');
    expect(acquired.acquired).toBe(true);
    await writeGuard(cwd, process.pid);

    const startedAt = Date.now();
    releaseLockSync(cwd);
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(1000);
    expect(await pathExists(lockPath(cwd))).toBe(true);
    await rm(guardPath(cwd), { force: true });
  });

  test('reclaims an aged empty guard before acquiring', async () => {
    const cwd = await createTempDir();
    await writeMalformedGuard(cwd, '');
    await ageFile(guardPath(cwd), 1000);

    const result = await acquireLockWithPrompt(cwd, 'empty-guard');

    expect(result.acquired).toBe(true);
    expect(await pathExists(guardPath(cwd))).toBe(false);
    await releaseLock(cwd);
  });

  test('reclaims an aged non-JSON guard before acquiring', async () => {
    const cwd = await createTempDir();
    await writeMalformedGuard(cwd, 'not-json');
    await ageFile(guardPath(cwd), 1000);

    const result = await acquireLockWithPrompt(cwd, 'invalid-guard');

    expect(result.acquired).toBe(true);
    expect(await pathExists(guardPath(cwd))).toBe(false);
    await releaseLock(cwd);
  });

  test('does not reclaim a fresh malformed guard on first observation', async () => {
    const cwd = await createTempDir();
    await writeMalformedGuard(cwd, '');

    const acquisition = acquireLockWithPrompt(cwd, 'fresh-guard');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await pathExists(guardPath(cwd))).toBe(true);
      expect(await readFile(guardPath(cwd), 'utf-8')).toBe('');
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }

    await rm(guardPath(cwd), { force: true });
    const result = await acquisition;
    expect(result.acquired).toBe(true);
    await releaseLock(cwd);
  });

  test('cleans aged guard temp files but preserves fresh ones', async () => {
    const cwd = await createTempDir();
    const agedTempPath = guardTempPath(cwd, 'aged');
    const freshTempPath = guardTempPath(cwd, 'fresh');
    await mkdir(join(cwd, SESSION_DIR), { recursive: true });
    await writeFile(agedTempPath, 'aged', 'utf-8');
    await writeFile(freshTempPath, 'fresh', 'utf-8');
    await ageFile(agedTempPath, 11000);
    await writeGuard(cwd, 2147483647);

    const result = await acquireLockWithPrompt(cwd, 'guard-temp-cleanup');

    expect(result.acquired).toBe(true);
    expect(await pathExists(agedTempPath)).toBe(false);
    expect(await pathExists(freshTempPath)).toBe(true);
    await releaseLock(cwd);
  });

  test('serializes overlapping guard-backed acquisitions in one process', async () => {
    const cwd = await createTempDir();

    const results = await Promise.all([
      acquireLockWithPrompt(cwd, 'overlap-one'),
      acquireLockWithPrompt(cwd, 'overlap-two'),
    ]);

    expect(results.filter((result) => result.acquired)).toHaveLength(1);
    expect(results.filter((result) => !result.acquired)).toHaveLength(1);
    await releaseLock(cwd);
  });

  test('falls back to exclusive guard creation when hard links are unsupported', async () => {
    const cwd = await createTempDir();
    const publishedGuards: LockGuardRecord[] = [];
    const unsupportedError = Object.assign(
      new Error('hard links are not supported'),
      { code: 'ENOTSUP' }
    );
    const linkSpy = spyOn(fsPromises, 'link').mockImplementation(
      async (tempPath) => {
        publishedGuards.push(
          JSON.parse(await readFile(tempPath, 'utf-8')) as LockGuardRecord
        );
        throw unsupportedError;
      }
    );

    try {
      const results = await Promise.all([
        acquireLockWithPrompt(cwd, 'fallback-one'),
        acquireLockWithPrompt(cwd, 'fallback-two'),
      ]);

      expect(results.filter((result) => result.acquired)).toHaveLength(1);
      expect(results.filter((result) => !result.acquired)).toHaveLength(1);
      expect(publishedGuards.length).toBeGreaterThan(0);
      expect(publishedGuards[0]?.pid).toBe(process.pid);
      const lock = JSON.parse(await readFile(lockPath(cwd), 'utf-8')) as LockFile;
      expect(lock.pid).toBe(process.pid);
    } finally {
      linkSpy.mockRestore();
      await releaseLock(cwd);
    }
  });

  test('falls back to exclusive sync guard creation when hard links are unsupported', async () => {
    const cwd = await createTempDir();
    const acquired = await acquireLockWithPrompt(cwd, 'sync-fallback');
    expect(acquired.acquired).toBe(true);
    let publishedGuard: LockGuardRecord | undefined;
    const unsupportedError = Object.assign(
      new Error('hard links are not supported'),
      { code: 'EOPNOTSUPP' }
    );
    const linkSyncSpy = spyOn(fs, 'linkSync').mockImplementation(
      (tempPath) => {
        publishedGuard = JSON.parse(
          fs.readFileSync(tempPath, 'utf-8')
        ) as LockGuardRecord;
        throw unsupportedError;
      }
    );

    try {
      releaseLockSync(cwd);

      expect(publishedGuard?.pid).toBe(process.pid);
      expect(await pathExists(lockPath(cwd))).toBe(false);
    } finally {
      linkSyncSpy.mockRestore();
      await releaseLock(cwd);
    }
  });
});

test('does not take ownership of signals when another listener exists', async () => {
  const cwd = await createTempDir();
  const acquired = await acquireLockWithPrompt(cwd, 'listener-test');
  expect(acquired.acquired).toBe(true);

  const cleanup = registerLockCleanupHandlers(cwd);
  const listeners: Array<{
    signal: 'SIGTERM' | 'SIGINT';
    handler: () => void;
  }> = [];

  try {
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      let listenerRan = false;
      const handler = (): void => {
        listenerRan = true;
      };
      listeners.push({ signal, handler });
      process.on(signal, handler);

      process.emit(signal);

      expect(listenerRan).toBe(true);
      expect(await pathExists(lockPath(cwd))).toBe(true);
      process.off(signal, handler);
    }
  } finally {
    for (const { signal, handler } of listeners) {
      process.off(signal, handler);
    }
    cleanup();
    await releaseLock(cwd);
  }
});

describe('startup signal ownership', () => {
  test('exits with 143 and releases the lock for SIGTERM', async () => {
    await runSignalChild('SIGTERM', 143);
  });

  test('exits with 130 and releases the lock for SIGINT', async () => {
    await runSignalChild('SIGINT', 130);
  });
});

test(
  'serializes sync release and force replacement across processes',
  async () => {
    const cwd = await createTempDir();
    const ownerReadyPath = join(cwd, 'owner-ready');
    const forceStartedPath = join(cwd, 'force-started');
    const forceReadyPath = join(cwd, 'force-ready');
    const owner = await spawnLockChild(cwd, ownerReadyPath, 'owner');

    try {
      await waitForReadyFile(ownerReadyPath, 2000);
      await writeGuard(cwd, process.pid);
      owner.kill('SIGTERM');

      const force = await spawnLockChild(
        cwd,
        forceReadyPath,
        'force',
        forceStartedPath
      );
      try {
        await waitForReadyFile(forceStartedPath, 2000);
        await rm(guardPath(cwd), { force: true });

        expect(await owner.exited).toBe(143);
        await waitForReadyFile(forceReadyPath, 2000);
        const lock = JSON.parse(await readFile(lockPath(cwd), 'utf-8')) as LockFile;
        const forceLockId = await readFile(forceReadyPath, 'utf-8');
        expect(lock.lockId).toBe(forceLockId);
        const lockFiles = (await readdir(join(cwd, SESSION_DIR))).filter(
          (file) => file === LOCK_FILE
        );
        expect(lockFiles).toHaveLength(1);
        expect(force.killed).toBe(false);
      } finally {
        if (!force.killed) {
          force.kill('SIGTERM');
          await force.exited;
        }
      }
    } finally {
      if (!owner.killed) {
        owner.kill('SIGKILL');
        await owner.exited;
      }
    }
  },
  10000
);

test(
  'repeated concurrent replacement keeps exactly one surviving lock',
  async () => {
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const cwd = await createTempDir();
      const ownerReadyPath = join(cwd, 'owner-ready');
      const forceStartedPath = join(cwd, 'force-started');
      const forceReadyPath = join(cwd, 'force-ready');
      const owner = await spawnLockChild(cwd, ownerReadyPath, 'owner');
      let force: Awaited<ReturnType<typeof spawnLockChild>> | null = null;

      try {
        await waitForReadyFile(ownerReadyPath, 2000);
        force = await spawnLockChild(
          cwd,
          forceReadyPath,
          'force',
          forceStartedPath
        );
        await waitForReadyFile(forceStartedPath, 2000);
        owner.kill('SIGTERM');

        expect(await owner.exited).toBe(143);
        await waitForReadyFile(forceReadyPath, 2000);
        const lock = JSON.parse(await readFile(lockPath(cwd), 'utf-8')) as LockFile;
        const forceLockId = await readFile(forceReadyPath, 'utf-8');
        expect(lock.lockId).toBe(forceLockId);
        const lockFiles = (await readdir(join(cwd, SESSION_DIR))).filter(
          (file) => file === LOCK_FILE
        );
        expect(lockFiles).toHaveLength(1);
      } finally {
        if (force && !force.killed) {
          force.kill('SIGTERM');
          await force.exited;
        }
        if (!owner.killed) {
          owner.kill('SIGKILL');
          await owner.exited;
        }
      }
    }
  },
  30000
);

test(
  'recovers from a subprocess that leaves a partial guard',
  async () => {
    const cwd = await createTempDir();
    const readyPath = join(cwd, 'partial-guard-ready');
    const child = await spawnPartialGuardChild(cwd, readyPath);

    try {
      await waitForReadyFile(readyPath, 2000);
      expect(await child.exited).toBe(0);

      const result = await acquireLockWithPrompt(cwd, 'partial-guard');

      expect(result.acquired).toBe(true);
      expect(await pathExists(guardPath(cwd))).toBe(false);
      await releaseLock(cwd);
    } finally {
      if (!child.killed) {
        child.kill('SIGKILL');
        await child.exited;
      }
    }
  },
  5000
);
