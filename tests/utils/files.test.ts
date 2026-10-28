/**
 * ABOUTME: Tests for file system utility functions.
 * Tests path operations, file discovery, and common file helpers.
 *
 * NOTE: These tests assume POSIX path semantics (forward slashes, absolute paths
 * starting with '/'). This is intentional as ralph-tui primarily targets Unix-like
 * systems. Cross-platform path handling would require refactoring both the
 * implementation in src/utils/files.ts and these tests.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, writeFile, mkdir, rmdir, unlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  pathExists,
  isDirectory,
  isFile,
  findFiles,
  ensureAbsolute,
  getRelativePath,
  parsePath,
  joinPath,
  normalizePath,
  getExtension,
  hasExtension,
  findProjectRoot,
  listDirectory,
} from '../../src/utils/files.js';

describe('files utility', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ralph-test-'));
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('pathExists', () => {
    test('returns true for existing file', async () => {
      const filePath = join(tempDir, 'test.txt');
      await writeFile(filePath, 'test');
      expect(await pathExists(filePath)).toBe(true);
    });

    test('returns true for existing directory', async () => {
      expect(await pathExists(tempDir)).toBe(true);
    });

    test('returns false for non-existent path', async () => {
      expect(await pathExists(join(tempDir, 'nonexistent'))).toBe(false);
    });
  });

  describe('isDirectory', () => {
    test('returns true for directory', async () => {
      expect(await isDirectory(tempDir)).toBe(true);
    });

    test('returns false for file', async () => {
      const filePath = join(tempDir, 'test.txt');
      await writeFile(filePath, 'test');
      expect(await isDirectory(filePath)).toBe(false);
    });

    test('returns false for non-existent path', async () => {
      expect(await isDirectory(join(tempDir, 'nonexistent'))).toBe(false);
    });
  });

  describe('isFile', () => {
    test('returns true for file', async () => {
      const filePath = join(tempDir, 'test.txt');
      await writeFile(filePath, 'test');
      expect(await isFile(filePath)).toBe(true);
    });

    test('returns false for directory', async () => {
      expect(await isFile(tempDir)).toBe(false);
    });

    test('returns false for non-existent path', async () => {
      expect(await isFile(join(tempDir, 'nonexistent'))).toBe(false);
    });
  });

  describe('findFiles', () => {
    beforeEach(async () => {
      // Create test file structure
      await writeFile(join(tempDir, 'file1.ts'), '');
      await writeFile(join(tempDir, 'file2.ts'), '');
      await writeFile(join(tempDir, 'file3.json'), '');
      await mkdir(join(tempDir, 'subdir'));
      await writeFile(join(tempDir, 'subdir', 'file4.ts'), '');
      await writeFile(join(tempDir, 'subdir', 'file5.json'), '');
    });

    test('finds all files in directory', async () => {
      const files = await findFiles(tempDir);
      expect(files.length).toBe(3);
    });

    test('filters by extension', async () => {
      const files = await findFiles(tempDir, { extension: '.ts' });
      expect(files.length).toBe(2);
      expect(files.every((f) => f.endsWith('.ts'))).toBe(true);
    });

    test('searches recursively', async () => {
      const files = await findFiles(tempDir, { recursive: true });
      expect(files.length).toBe(5);
    });

    test('respects maxDepth', async () => {
      const files = await findFiles(tempDir, { recursive: true, maxDepth: 0 });
      expect(files.length).toBe(3);
    });

    test('combines extension and recursive options', async () => {
      const files = await findFiles(tempDir, { extension: '.ts', recursive: true });
      expect(files.length).toBe(3);
    });

    test('returns empty array for non-existent directory', async () => {
      const files = await findFiles(join(tempDir, 'nonexistent'));
      expect(files).toEqual([]);
    });
  });

  describe('ensureAbsolute', () => {
    test('returns absolute path unchanged', () => {
      const absPath = '/usr/local/bin';
      expect(ensureAbsolute(absPath)).toBe(absPath);
    });

    test('resolves relative path from cwd', () => {
      const result = ensureAbsolute('src/index.ts', '/home/user/project');
      expect(result).toBe('/home/user/project/src/index.ts');
    });

    test('normalizes path with . and ..', () => {
      const result = ensureAbsolute('./src/../lib/index.ts', '/home/user/project');
      expect(result).toBe('/home/user/project/lib/index.ts');
    });
  });

  describe('getRelativePath', () => {
    test('gets relative path between sibling directories', () => {
      const result = getRelativePath('/home/user/src', '/home/user/lib');
      expect(result).toBe('../lib');
    });

    test('gets relative path to subdirectory', () => {
      const result = getRelativePath('/home/user', '/home/user/src/lib');
      expect(result).toBe('src/lib');
    });

    test('gets relative path to parent directory', () => {
      const result = getRelativePath('/home/user/src/lib', '/home/user');
      expect(result).toBe('../..');
    });

    test('returns . for same directory', () => {
      const result = getRelativePath('/home/user', '/home/user');
      expect(result).toBe('.');
    });
  });

  describe('parsePath', () => {
    test('parses file path correctly', () => {
      const result = parsePath('/home/user/project/src/index.ts');
      expect(result).toEqual({
        dir: '/home/user/project/src',
        base: 'index.ts',
        name: 'index',
        ext: '.ts',
      });
    });

    test('handles file without extension', () => {
      const result = parsePath('/home/user/Makefile');
      expect(result).toEqual({
        dir: '/home/user',
        base: 'Makefile',
        name: 'Makefile',
        ext: '',
      });
    });

    test('handles dotfiles', () => {
      const result = parsePath('/home/user/.gitignore');
      expect(result).toEqual({
        dir: '/home/user',
        base: '.gitignore',
        name: '.gitignore',
        ext: '',
      });
    });

    test('handles multiple dots in filename', () => {
      const result = parsePath('/home/user/file.test.ts');
      expect(result).toEqual({
        dir: '/home/user',
        base: 'file.test.ts',
        name: 'file.test',
        ext: '.ts',
      });
    });
  });

  describe('joinPath', () => {
    test('joins path segments', () => {
      expect(joinPath('/home', 'user', 'project')).toBe('/home/user/project');
    });

    test('handles empty segments', () => {
      expect(joinPath('/home', '', 'project')).toBe('/home/project');
    });
  });

  describe('normalizePath', () => {
    test('normalizes path with . and ..', () => {
      expect(normalizePath('/home/user/../admin/./project')).toBe('/home/admin/project');
    });

    test('handles paths with trailing slash', () => {
      // Node's normalize keeps trailing slashes for root, removes extra slashes
      const result = normalizePath('/home/user/');
      expect(result.startsWith('/home/user')).toBe(true);
    });
  });

  describe('getExtension', () => {
    test('returns extension with dot', () => {
      expect(getExtension('/home/user/file.ts')).toBe('.ts');
    });

    test('returns empty string for no extension', () => {
      expect(getExtension('/home/user/Makefile')).toBe('');
    });

    test('returns last extension for multiple dots', () => {
      expect(getExtension('/home/user/file.test.ts')).toBe('.ts');
    });
  });

  describe('hasExtension', () => {
    test('returns true when extension matches', () => {
      expect(hasExtension('file.ts', ['.ts', '.js'])).toBe(true);
    });

    test('returns false when extension does not match', () => {
      expect(hasExtension('file.py', ['.ts', '.js'])).toBe(false);
    });

    test('is case insensitive', () => {
      expect(hasExtension('file.TS', ['.ts'])).toBe(true);
    });
  });

  describe('listDirectory', () => {
    beforeEach(async () => {
      // Create test file structure
      await writeFile(join(tempDir, 'file1.json'), '{}');
      await writeFile(join(tempDir, 'file2.txt'), 'text');
      await writeFile(join(tempDir, 'prd-feature.json'), '{}');
      await writeFile(join(tempDir, '.hidden'), 'hidden');
      await mkdir(join(tempDir, 'subdir'));
      await mkdir(join(tempDir, '.hiddendir'));
    });

    test('lists directory contents with directories first', async () => {
      const entries = await listDirectory(tempDir);
      expect(entries.length).toBe(4); // subdir + 3 visible files (hidden excluded by default)
      expect(entries[0].isDirectory).toBe(true);
      expect(entries[0].name).toBe('subdir');
    });

    test('excludes hidden files by default', async () => {
      const entries = await listDirectory(tempDir);
      const names = entries.map((e) => e.name);
      expect(names).not.toContain('.hidden');
      expect(names).not.toContain('.hiddendir');
    });

    test('includes hidden files when showHidden is true', async () => {
      const entries = await listDirectory(tempDir, { showHidden: true });
      const names = entries.map((e) => e.name);
      expect(names).toContain('.hidden');
      expect(names).toContain('.hiddendir');
    });

    test('filters by extension', async () => {
      const entries = await listDirectory(tempDir, { extension: '.json' });
      const files = entries.filter((e) => !e.isDirectory);
      expect(files.length).toBe(2);
      expect(files.every((f) => f.name.endsWith('.json'))).toBe(true);
    });

    test('filters by filename prefix', async () => {
      const entries = await listDirectory(tempDir, { filenamePrefix: 'prd' });
      const files = entries.filter((e) => !e.isDirectory);
      expect(files.length).toBe(1);
      expect(files[0].name).toBe('prd-feature.json');
    });

    test('combines extension and prefix filters', async () => {
      const entries = await listDirectory(tempDir, { extension: '.json', filenamePrefix: 'prd' });
      const files = entries.filter((e) => !e.isDirectory);
      expect(files.length).toBe(1);
      expect(files[0].name).toBe('prd-feature.json');
    });

    test('includes directories regardless of filters', async () => {
      const entries = await listDirectory(tempDir, { extension: '.json', filenamePrefix: 'prd' });
      const dirs = entries.filter((e) => e.isDirectory);
      expect(dirs.length).toBe(1);
      expect(dirs[0].name).toBe('subdir');
    });

    test('returns absolute paths', async () => {
      const entries = await listDirectory(tempDir);
      expect(entries.every((e) => e.path.startsWith('/'))).toBe(true);
      expect(entries.every((e) => e.path.includes(tempDir))).toBe(true);
    });

    test('sorts entries alphabetically within categories', async () => {
      await writeFile(join(tempDir, 'aaa.txt'), '');
      await writeFile(join(tempDir, 'zzz.txt'), '');
      const entries = await listDirectory(tempDir);
      const files = entries.filter((e) => !e.isDirectory);
      const names = files.map((e) => e.name);
      expect(names).toEqual([...names].sort());
    });
  });

  describe('findProjectRoot', () => {
    beforeEach(async () => {
      // Create nested structure with package.json at root
      await writeFile(join(tempDir, 'package.json'), '{}');
      await mkdir(join(tempDir, 'src'));
      await mkdir(join(tempDir, 'src', 'lib'));
    });

    test('finds project root from nested directory', async () => {
      const result = await findProjectRoot(join(tempDir, 'src', 'lib'));
      // Normalize both paths for comparison (handles trailing slashes, etc.)
      expect(normalizePath(result || '')).toBe(normalizePath(tempDir));
    });

    test('finds project root from project directory', async () => {
      const result = await findProjectRoot(tempDir);
      expect(result).toBe(tempDir);
    });

    test('returns null when no marker found', async () => {
      const noMarkerDir = await mkdtemp(join(tmpdir(), 'no-marker-'));
      const result = await findProjectRoot(noMarkerDir);
      expect(result).toBe(null);
      await rmdir(noMarkerDir);
    });

    test('uses custom markers', async () => {
      const customMarker = 'custom.marker';
      await writeFile(join(tempDir, customMarker), '');
      const result = await findProjectRoot(join(tempDir, 'src'), [customMarker]);
      expect(normalizePath(result || '')).toBe(normalizePath(tempDir));
    });
  });
});
