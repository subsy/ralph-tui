/**
 * ABOUTME: Atomic file write helpers for session and lock persistence.
 * Writes data to a temporary file, fsyncs it, then renames it in place
 * so readers never observe partially-written JSON.
 */

import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { mkdir, open, rename, unlink, type FileHandle } from 'node:fs/promises';

/** Default restrictive permissions for session metadata and lock files. */
const DEFAULT_MODE = 0o600;

/**
 * Atomically write UTF-8 text to a file.
 */
export async function writeFileAtomic(
  filePath: string,
  content: string,
  mode: number = DEFAULT_MODE
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`;

  let handle: FileHandle | null = null;
  try {
    handle = await open(tempPath, 'w', mode);
    await handle.writeFile(content, 'utf-8');
    await handle.sync();
    await handle.close();
    handle = null;

    await rename(tempPath, filePath);
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Best effort cleanup.
      }
    }
    try {
      await unlink(tempPath);
    } catch {
      // Best effort cleanup.
    }
    throw error;
  }
}

/**
 * Atomically write a JSON value to disk.
 */
export async function writeJsonAtomic(
  filePath: string,
  value: unknown,
  mode: number = DEFAULT_MODE
): Promise<void> {
  await writeFileAtomic(filePath, JSON.stringify(value, null, 2), mode);
}
