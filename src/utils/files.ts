/**
 * ABOUTME: File system utility functions.
 * Provides path operations, file discovery, and common file helpers.
 */

import { join, dirname, basename, extname, resolve, normalize, isAbsolute } from 'node:path';
import { access, readdir, stat, constants } from 'node:fs/promises';

/**
 * Check if a path exists
 */
export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a path is a directory
 */
export async function isDirectory(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check if a path is a file
 */
export async function isFile(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

/**
 * Get all files in a directory matching a pattern
 */
export async function findFiles(
  directory: string,
  options: {
    /** File extension filter (e.g., '.ts', '.json') */
    extension?: string;
    /** Whether to search recursively */
    recursive?: boolean;
    /** Maximum depth for recursive search (0 = current dir only) */
    maxDepth?: number;
  } = {}
): Promise<string[]> {
  const { extension, recursive = false, maxDepth = Infinity } = options;
  const results: string[] = [];

  async function scan(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isFile()) {
          if (!extension || entry.name.endsWith(extension)) {
            results.push(fullPath);
          }
        } else if (entry.isDirectory() && recursive) {
          await scan(fullPath, depth + 1);
        }
      }
    } catch {
      // Directory not accessible, skip
    }
  }

  await scan(directory, 0);
  return results;
}

/**
 * Ensure a path is absolute, resolving relative paths from cwd
 */
export function ensureAbsolute(filePath: string, cwd: string = process.cwd()): string {
  if (isAbsolute(filePath)) {
    return normalize(filePath);
  }
  return resolve(cwd, filePath);
}

/**
 * Get the relative path from one path to another
 */
export function getRelativePath(from: string, to: string): string {
  const fromParts = normalize(from).split('/').filter(Boolean);
  const toParts = normalize(to).split('/').filter(Boolean);

  // Find common prefix
  let commonLength = 0;
  while (
    commonLength < fromParts.length &&
    commonLength < toParts.length &&
    fromParts[commonLength] === toParts[commonLength]
  ) {
    commonLength++;
  }

  // Build relative path
  const upCount = fromParts.length - commonLength;
  const downParts = toParts.slice(commonLength);

  const relativeParts = [...Array(upCount).fill('..'), ...downParts];
  return relativeParts.join('/') || '.';
}

/**
 * Parse a file path into its components
 */
export function parsePath(filePath: string): {
  dir: string;
  base: string;
  name: string;
  ext: string;
} {
  const dir = dirname(filePath);
  const base = basename(filePath);
  const ext = extname(filePath);
  const name = base.slice(0, base.length - ext.length);

  return { dir, base, name, ext };
}

/**
 * Join path segments safely
 */
export function joinPath(...segments: string[]): string {
  return join(...segments);
}

/**
 * Normalize a path (resolve . and ..)
 */
export function normalizePath(filePath: string): string {
  return normalize(filePath);
}

/**
 * Get the extension of a file (including the dot)
 */
export function getExtension(filePath: string): string {
  return extname(filePath);
}

/**
 * Check if a path has one of the specified extensions
 */
export function hasExtension(filePath: string, extensions: string[]): boolean {
  const ext = extname(filePath).toLowerCase();
  return extensions.some((e) => e.toLowerCase() === ext);
}

/**
 * A single entry in a directory listing
 */
export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/**
 * List the contents of a directory, returning entries sorted with directories first
 */
export async function listDirectory(
  dirPath: string,
  options?: { showHidden?: boolean; extension?: string; filenamePrefix?: string }
): Promise<DirectoryEntry[]> {
  const { showHidden = false, extension, filenamePrefix } = options ?? {};
  const absolutePath = ensureAbsolute(dirPath);

  const entries = await readdir(absolutePath, { withFileTypes: true });

  const result: DirectoryEntry[] = [];

  for (const entry of entries) {
    if (!showHidden && entry.name.startsWith('.')) {
      continue;
    }

    const isDir = entry.isDirectory();

    if (!isDir) {
      if (extension && !entry.name.endsWith(extension)) {
        continue;
      }
      if (filenamePrefix && !entry.name.startsWith(filenamePrefix)) {
        continue;
      }
    }

    result.push({
      name: entry.name,
      path: join(absolutePath, entry.name),
      isDirectory: isDir,
    });
  }

  result.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  return result;
}

/**
 * Find the project root by looking for marker files
 */
export async function findProjectRoot(
  startDir: string,
  markers: string[] = ['package.json', '.git']
): Promise<string | null> {
  let currentDir = resolve(startDir);

  // Keep going until we hit the filesystem root
  while (true) {
    for (const marker of markers) {
      const markerPath = join(currentDir, marker);
      if (await pathExists(markerPath)) {
        return currentDir;
      }
    }

    const parentDir = dirname(currentDir);
    // Stop when we've reached the root (dirname returns the same path)
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return null;
}
