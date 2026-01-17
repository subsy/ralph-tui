/**
 * ABOUTME: Mock implementations for file system operations.
 * Provides in-memory file system mock for testing without disk I/O.
 */

import type { Stats } from 'node:fs';

/**
 * Options for creating a mock file
 */
export interface MockFileOptions {
  content?: string;
  isDirectory?: boolean;
  mtime?: Date;
  mode?: number;
}

/**
 * In-memory file system mock
 */
export class MockFileSystem {
  private files = new Map<string, { content: string; stats: Partial<Stats> }>();
  private directories = new Set<string>();

  /**
   * Add a file to the mock file system
   */
  addFile(path: string, content: string, options: MockFileOptions = {}): void {
    this.files.set(path, {
      content,
      stats: {
        isFile: () => true,
        isDirectory: () => false,
        mtime: options.mtime ?? new Date(),
        mode: options.mode ?? 0o644,
        size: content.length,
      },
    });

    // Ensure parent directories exist
    const isAbsolute = path.startsWith('/');
    const segments = path.split('/').filter(Boolean);
    for (let i = 1; i < segments.length; i++) {
      const dir = (isAbsolute ? '/' : '') + segments.slice(0, i).join('/');
      this.directories.add(dir);
    }
  }

  /**
   * Add a directory to the mock file system
   */
  addDirectory(path: string): void {
    this.directories.add(path);
  }

  /**
   * Check if a path exists
   */
  exists(path: string): boolean {
    return this.files.has(path) || this.directories.has(path);
  }

  /**
   * Read file content
   */
  readFile(path: string): string {
    const file = this.files.get(path);
    if (!file) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    return file.content;
  }

  /**
   * Write file content
   */
  writeFile(path: string, content: string): void {
    this.addFile(path, content);
  }

  /**
   * Delete a file
   */
  unlink(path: string): void {
    if (!this.files.has(path)) {
      throw new Error(`ENOENT: no such file or directory, unlink '${path}'`);
    }
    this.files.delete(path);
  }

  /**
   * Get file stats
   */
  stat(path: string): Partial<Stats> {
    const file = this.files.get(path);
    if (file) {
      return file.stats;
    }
    if (this.directories.has(path)) {
      return {
        isFile: () => false,
        isDirectory: () => true,
        mtime: new Date(),
        mode: 0o755,
      };
    }
    throw new Error(`ENOENT: no such file or directory, stat '${path}'`);
  }

  /**
   * List directory contents
   */
  readdir(path: string): string[] {
    if (!this.directories.has(path) && path !== '/') {
      throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
    }

    const entries: string[] = [];
    const prefix = path.endsWith('/') ? path : `${path}/`;

    // Add files in this directory
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(prefix)) {
        const relative = filePath.slice(prefix.length);
        const firstPart = relative.split('/')[0];
        if (firstPart && !entries.includes(firstPart)) {
          entries.push(firstPart);
        }
      }
    }

    // Add subdirectories
    for (const dirPath of this.directories) {
      if (dirPath.startsWith(prefix) && dirPath !== path) {
        const relative = dirPath.slice(prefix.length);
        const firstPart = relative.split('/')[0];
        if (firstPart && !entries.includes(firstPart)) {
          entries.push(firstPart);
        }
      }
    }

    return entries;
  }

  /**
   * Create a directory
   */
  mkdir(path: string, options?: { recursive?: boolean }): void {
    if (options?.recursive) {
      const parts = path.split('/');
      for (let i = 1; i <= parts.length; i++) {
        this.directories.add(parts.slice(0, i).join('/'));
      }
    } else {
      this.directories.add(path);
    }
  }

  /**
   * Remove a directory
   */
  rmdir(path: string): void {
    if (!this.directories.has(path)) {
      throw new Error(`ENOENT: no such file or directory, rmdir '${path}'`);
    }
    this.directories.delete(path);
  }

  /**
   * Clear all files and directories
   */
  clear(): void {
    this.files.clear();
    this.directories.clear();
  }

  /**
   * Get all file paths
   */
  getAllFiles(): string[] {
    return Array.from(this.files.keys());
  }

  /**
   * Get all directory paths
   */
  getAllDirectories(): string[] {
    return Array.from(this.directories);
  }
}

/**
 * Create a pre-populated mock file system
 */
export function createMockFileSystem(
  files: Record<string, string> = {},
): MockFileSystem {
  const fs = new MockFileSystem();
  for (const [path, content] of Object.entries(files)) {
    fs.addFile(path, content);
  }
  return fs;
}

/**
 * Create mock file system functions for replacing node:fs
 */
export function createFsMocks(mockFs: MockFileSystem) {
  return {
    existsSync: (path: string) => mockFs.exists(path),
    readFileSync: (path: string) => mockFs.readFile(path),
    writeFileSync: (path: string, content: string) =>
      mockFs.writeFile(path, content),
    unlinkSync: (path: string) => mockFs.unlink(path),
    statSync: (path: string) => mockFs.stat(path),
    readdirSync: (path: string) => mockFs.readdir(path),
    mkdirSync: (path: string, options?: { recursive?: boolean }) =>
      mockFs.mkdir(path, options),
    rmdirSync: (path: string) => mockFs.rmdir(path),
  };
}
