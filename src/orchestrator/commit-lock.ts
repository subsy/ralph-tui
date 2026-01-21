/**
 * ABOUTME: File-based commit lock for coordinating parallel agent commits.
 * Uses mkdir for atomic lock acquisition - agents wait and retry until lock is available.
 */

import { mkdir, rmdir } from 'node:fs/promises';
import { join } from 'node:path';

const LOCK_DIR = '.git/commit.lock';
const DEFAULT_RETRY_DELAY_MS = 500;
const DEFAULT_MAX_RETRIES = 60; // 30 seconds max wait

export interface LockOptions {
  retryDelayMs?: number;
  maxRetries?: number;
}

export interface CommitLock {
  release: () => Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquire the commit lock. Waits and retries if lock is held.
 * Returns a lock object with a release() method.
 */
export async function acquireCommitLock(
  cwd: string,
  options?: LockOptions
): Promise<CommitLock> {
  const lockPath = join(cwd, LOCK_DIR);
  const retryDelay = options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;

  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      await mkdir(lockPath, { recursive: false });
      // Lock acquired
      return {
        release: async () => {
          try {
            await rmdir(lockPath);
          } catch {
            // Ignore errors on release
          }
        },
      };
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'EEXIST') {
        // Lock held by another process, wait and retry
        attempts++;
        await sleep(retryDelay);
      } else {
        // Unexpected error
        throw err;
      }
    }
  }

  throw new Error(`Failed to acquire commit lock after ${maxRetries} attempts`);
}

/**
 * Execute a function while holding the commit lock.
 * Automatically releases the lock when done (even on error).
 */
export async function withCommitLock<T>(
  cwd: string,
  fn: () => Promise<T>,
  options?: LockOptions
): Promise<T> {
  const lock = await acquireCommitLock(cwd, options);
  try {
    return await fn();
  } finally {
    await lock.release();
  }
}
