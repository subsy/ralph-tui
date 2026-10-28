/**
 * ABOUTME: Tests for FileBrowser helper functions and logic.
 * Tests the pure utility functions used by the FileBrowser component,
 * including fuzzy search integration for file filtering.
 */

import { describe, test, expect } from 'bun:test';
import { homedir } from 'node:os';
import { sep, resolve, isAbsolute } from 'node:path';
import { formatPath, truncateText } from '../../src/tui/components/FileBrowser.js';
import { fuzzySearch } from '../../src/utils/fuzzy-search.js';
import type { DirectoryEntry } from '../../src/utils/files.js';

describe('FileBrowser helpers', () => {
  describe('formatPath', () => {
    test('replaces home directory with ~', () => {
      const home = homedir();
      expect(formatPath(home)).toBe('~');
    });

    test('replaces home directory prefix with ~', () => {
      const home = homedir();
      const subdir = `${home}${sep}projects${sep}my-app`;
      expect(formatPath(subdir)).toBe('~/projects/my-app');
    });

    test('returns path unchanged if not under home', () => {
      expect(formatPath('/tmp/test')).toBe('/tmp/test');
      expect(formatPath('/var/log')).toBe('/var/log');
    });

    test('handles root path', () => {
      expect(formatPath('/')).toBe('/');
    });

    test('does not replace partial home matches', () => {
      const home = homedir();
      // Path that starts with same prefix but is not actually under home
      const fakePath = home + 'extra/path';
      expect(formatPath(fakePath)).toBe(fakePath);
    });
  });

  describe('truncateText', () => {
    test('returns text unchanged if within max width', () => {
      expect(truncateText('hello', 10)).toBe('hello');
      expect(truncateText('hello', 5)).toBe('hello');
    });

    test('truncates text with ellipsis when exceeding max width', () => {
      expect(truncateText('hello world', 8)).toBe('hello w…');
      expect(truncateText('hello world', 6)).toBe('hello…');
    });

    test('handles single character max width', () => {
      expect(truncateText('hello', 1)).toBe('…');
    });

    test('handles empty string', () => {
      expect(truncateText('', 10)).toBe('');
    });

    test('handles exact length match', () => {
      expect(truncateText('hello', 5)).toBe('hello');
    });
  });

  describe('navigation logic', () => {
    /**
     * Calculate new selection index when navigating with j/k keys
     * (Mirrors logic from FileBrowser.tsx)
     */
    function calculateNewIndex(
      currentIndex: number,
      direction: 'up' | 'down',
      totalEntries: number
    ): number {
      if (totalEntries === 0) return 0;
      if (direction === 'up') {
        return Math.max(0, currentIndex - 1);
      } else {
        return Math.min(totalEntries - 1, currentIndex + 1);
      }
    }

    test('moves up correctly', () => {
      expect(calculateNewIndex(5, 'up', 10)).toBe(4);
      expect(calculateNewIndex(0, 'up', 10)).toBe(0); // Can't go below 0
    });

    test('moves down correctly', () => {
      expect(calculateNewIndex(5, 'down', 10)).toBe(6);
      expect(calculateNewIndex(9, 'down', 10)).toBe(9); // Can't go above max
    });

    test('handles empty list', () => {
      expect(calculateNewIndex(0, 'up', 0)).toBe(0);
      expect(calculateNewIndex(0, 'down', 0)).toBe(0);
    });

    test('handles single item list', () => {
      expect(calculateNewIndex(0, 'up', 1)).toBe(0);
      expect(calculateNewIndex(0, 'down', 1)).toBe(0);
    });
  });

  describe('path resolution logic', () => {
    /**
     * Resolve a path input from the user relative to the current browsing directory.
     * (Mirrors expandPath logic from FileBrowser.tsx)
     */
    function resolvePathInput(input: string, currentPath: string): string {
      const trimmed = input.trim();

      // Tilde expands to home directory
      if (trimmed.startsWith('~')) {
        const expanded = homedir() + trimmed.slice(1);
        return resolve(expanded);
      }

      // Absolute paths resolve directly
      if (isAbsolute(trimmed)) {
        return resolve(trimmed);
      }

      // Relative paths resolve against current browsing directory
      return resolve(currentPath, trimmed);
    }

    test('expands ~ to home directory', () => {
      const home = homedir();
      expect(resolvePathInput('~/projects', '/tmp')).toBe(resolve(`${home}/projects`));
      expect(resolvePathInput('~', '/tmp')).toBe(home);
    });

    test('resolves absolute paths directly', () => {
      expect(resolvePathInput('/var/log', '/tmp')).toBe('/var/log');
      expect(resolvePathInput('/home/user', '/current')).toBe('/home/user');
    });

    test('resolves relative paths from current browsing directory', () => {
      expect(resolvePathInput('subdir', '/current/path')).toBe('/current/path/subdir');
      expect(resolvePathInput('a/b/c', '/root')).toBe('/root/a/b/c');
    });

    test('resolves ./ relative paths from current browsing directory', () => {
      expect(resolvePathInput('./subdir', '/current/path')).toBe('/current/path/subdir');
      expect(resolvePathInput('./a/b', '/root')).toBe('/root/a/b');
    });

    test('resolves ../ relative paths from current browsing directory', () => {
      expect(resolvePathInput('../sibling', '/current/path')).toBe('/current/sibling');
      expect(resolvePathInput('../../top', '/a/b/c')).toBe('/a/top');
    });

    test('does not use process.cwd() for relative paths', () => {
      // This is the key test: relative paths should resolve against currentPath,
      // not process.cwd(). We verify by using a currentPath that's different from cwd.
      const currentPath = '/some/browsing/directory';
      const result = resolvePathInput('myfile', currentPath);
      expect(result).toBe('/some/browsing/directory/myfile');
      expect(result).not.toContain(process.cwd());
    });
  });

  describe('fuzzy search integration', () => {
    /**
     * Simulate the FileBrowser's fuzzy filtering of directory entries.
     * This mirrors the useMemo logic in FileBrowser.tsx.
     */
    function filterEntriesWithFuzzySearch(
      entries: DirectoryEntry[],
      searchQuery: string
    ): DirectoryEntry[] {
      if (!searchQuery) {
        return entries;
      }
      const entryNames = entries.map((e) => e.name);
      const matches = fuzzySearch(entryNames, searchQuery, entries.length);
      const matchedNames = new Set(matches.map((m) => m.item));
      return entries
        .filter((e) => matchedNames.has(e.name))
        .sort((a, b) => {
          const aIndex = matches.findIndex((m) => m.item === a.name);
          const bIndex = matches.findIndex((m) => m.item === b.name);
          return aIndex - bIndex;
        });
    }

    const mockEntries: DirectoryEntry[] = [
      { name: 'prd.json', path: '/project/prd.json', isDirectory: false },
      { name: 'prd-auth.json', path: '/project/prd-auth.json', isDirectory: false },
      { name: 'config.json', path: '/project/config.json', isDirectory: false },
      { name: 'tasks', path: '/project/tasks', isDirectory: true },
      { name: 'src', path: '/project/src', isDirectory: true },
      { name: 'my-prd-file.json', path: '/project/my-prd-file.json', isDirectory: false },
    ];

    test('returns all entries when search query is empty', () => {
      const filtered = filterEntriesWithFuzzySearch(mockEntries, '');
      expect(filtered).toEqual(mockEntries);
    });

    test('filters entries by fuzzy match', () => {
      const filtered = filterEntriesWithFuzzySearch(mockEntries, 'prd');
      expect(filtered.length).toBe(3);
      expect(filtered.map((e) => e.name)).toContain('prd.json');
      expect(filtered.map((e) => e.name)).toContain('prd-auth.json');
      expect(filtered.map((e) => e.name)).toContain('my-prd-file.json');
    });

    test('filters entries by CJK fuzzy query', () => {
      const entries: DirectoryEntry[] = [
        { name: 'prd-中文.json', path: '/project/prd-中文.json', isDirectory: false },
      ];

      const filtered = filterEntriesWithFuzzySearch(entries, '中文');

      expect(filtered.map((e) => e.name)).toContain('prd-中文.json');
    });

    test('ranks exact filename match first', () => {
      const filtered = filterEntriesWithFuzzySearch(mockEntries, 'prd.json');
      expect(filtered[0].name).toBe('prd.json');
    });

    test('ranks filename-starts-with before contains', () => {
      const filtered = filterEntriesWithFuzzySearch(mockEntries, 'prd');
      // prd.json (exact filename) should come before prd-auth.json (starts with)
      // which should come before my-prd-file.json (contains)
      const names = filtered.map((e) => e.name);
      expect(names.indexOf('prd.json')).toBeLessThan(names.indexOf('my-prd-file.json'));
    });

    test('filters directories as well as files', () => {
      const filtered = filterEntriesWithFuzzySearch(mockEntries, 'src');
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('src');
      expect(filtered[0].isDirectory).toBe(true);
    });

    test('returns empty array when no matches', () => {
      const filtered = filterEntriesWithFuzzySearch(mockEntries, 'xyz123');
      expect(filtered).toEqual([]);
    });

    test('matches partial query with fzf-style sequential matching', () => {
      // 'taj' should match 'tasks' (t-a-sks matches t, a is found, then nothing for j fails)
      // Actually let's use a better example: 'tsk' matching 'tasks'
      const filtered = filterEntriesWithFuzzySearch(mockEntries, 'tsk');
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe('tasks');
    });

    test('preserves DirectoryEntry structure after filtering', () => {
      const filtered = filterEntriesWithFuzzySearch(mockEntries, 'config');
      expect(filtered.length).toBe(1);
      expect(filtered[0]).toEqual({
        name: 'config.json',
        path: '/project/config.json',
        isDirectory: false,
      });
    });
  });

  describe('search mode index calculation', () => {
    /**
     * Calculate the correct entry index based on search mode.
     * In normal mode, index 0 is ".." (parent), entries start at 1.
     * In search mode, there's no "..", entries start at 0.
     */
    function getEntryIndex(selectedIndex: number, isSearching: boolean): number {
      return isSearching ? selectedIndex : selectedIndex - 1;
    }

    test('in normal mode, index 0 is parent directory', () => {
      expect(getEntryIndex(0, false)).toBe(-1); // No entry at -1, it's ".."
      expect(getEntryIndex(1, false)).toBe(0); // First actual entry
      expect(getEntryIndex(2, false)).toBe(1); // Second entry
    });

    test('in search mode, index 0 is first entry', () => {
      expect(getEntryIndex(0, true)).toBe(0); // First entry
      expect(getEntryIndex(1, true)).toBe(1); // Second entry
      expect(getEntryIndex(2, true)).toBe(2); // Third entry
    });

    /**
     * Calculate max selectable index based on mode.
     */
    function getMaxIndex(entriesLength: number, isSearching: boolean): number {
      return isSearching ? entriesLength - 1 : entriesLength;
    }

    test('max index accounts for parent entry in normal mode', () => {
      // 5 entries: ".." at 0, then entries at 1-5
      expect(getMaxIndex(5, false)).toBe(5);
    });

    test('max index is entries.length - 1 in search mode', () => {
      // 5 entries: entries at 0-4
      expect(getMaxIndex(5, true)).toBe(4);
    });

    test('handles empty entries in search mode', () => {
      expect(getMaxIndex(0, true)).toBe(-1);
    });
  });
});
