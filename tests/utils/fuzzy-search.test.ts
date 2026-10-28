/**
 * ABOUTME: Tests for fuzzy search utility functions.
 * Covers scoring algorithm, ranking, and edge cases for file path matching.
 */

import { describe, test, expect } from 'bun:test';
import { fuzzySearch, fuzzyFilter } from '../../src/utils/fuzzy-search.js';

describe('fuzzySearch', () => {
  describe('empty and basic queries', () => {
    test('returns first N items alphabetically when query is empty', () => {
      const items = ['cherry', 'apple', 'banana'];
      const results = fuzzySearch(items, '', 10);
      expect(results.map((r) => r.item)).toEqual(['apple', 'banana', 'cherry']);
      expect(results.every((r) => r.score === 0)).toBe(true);
    });

    test('returns first N items alphabetically when query is whitespace', () => {
      const items = ['zebra', 'alpha'];
      const results = fuzzySearch(items, '   ', 10);
      expect(results.map((r) => r.item)).toEqual(['alpha', 'zebra']);
    });

    test('respects limit parameter', () => {
      const items = ['a', 'b', 'c', 'd', 'e'];
      const results = fuzzySearch(items, '', 3);
      expect(results.length).toBe(3);
    });

    test('handles empty items array', () => {
      const results = fuzzySearch([], 'test', 10);
      expect(results).toEqual([]);
    });
  });

  describe('exact matching (highest priority)', () => {
    test('exact match gets highest score', () => {
      const items = ['prd.json', 'prd-auth.json', 'my-prd.json'];
      const results = fuzzySearch(items, 'prd.json', 10);
      expect(results[0].item).toBe('prd.json');
      expect(results[0].score).toBe(1000);
    });

    test('exact match is case-insensitive', () => {
      const items = ['PRD.JSON', 'prd-auth.json'];
      const results = fuzzySearch(items, 'prd.json', 10);
      expect(results[0].item).toBe('PRD.JSON');
      expect(results[0].score).toBe(1000);
    });
  });

  describe('filename matching', () => {
    test('filename exact match scores 800', () => {
      const items = ['./tasks/prd.json', './other/prd-auth.json'];
      const results = fuzzySearch(items, 'prd.json', 10);
      expect(results[0].item).toBe('./tasks/prd.json');
      expect(results[0].score).toBe(800);
    });

    test('filename starts-with scores 600+', () => {
      const items = ['prd-authentication.json', 'auth-prd.json'];
      const results = fuzzySearch(items, 'prd', 10);
      expect(results[0].item).toBe('prd-authentication.json');
      expect(results[0].score).toBeGreaterThanOrEqual(600);
      expect(results[0].score).toBeLessThan(700);
    });

    test('filename contains scores 400+', () => {
      const items = ['my-prd-file.json', 'other.json'];
      const results = fuzzySearch(items, 'prd', 10);
      expect(results[0].item).toBe('my-prd-file.json');
      expect(results[0].score).toBeGreaterThanOrEqual(400);
      expect(results[0].score).toBeLessThan(500);
    });
  });

  describe('path matching', () => {
    test('path contains query scores 200+', () => {
      const items = ['./tasks/auth/config.json', './other/stuff.json'];
      const results = fuzzySearch(items, 'auth', 10);
      expect(results[0].item).toBe('./tasks/auth/config.json');
      expect(results[0].score).toBeGreaterThanOrEqual(200);
      expect(results[0].score).toBeLessThan(300);
    });
  });

  describe('sequential (fzf-style) matching', () => {
    test('matches characters in order', () => {
      const items = ['prd-authentication.json', 'other.json'];
      // 'paj' matches p-rd-authentication.json
      const results = fuzzySearch(items, 'paj', 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].item).toBe('prd-authentication.json');
    });

    test('consecutive matches get bonus', () => {
      const items = ['abcdef.txt', 'aXbXcXdXeXf.txt'];
      const results = fuzzySearch(items, 'abc', 10);
      // 'abcdef.txt' should score higher due to consecutive bonus
      expect(results[0].item).toBe('abcdef.txt');
    });

    test('does not match if characters are out of order', () => {
      const items = ['cba.txt'];
      const results = fuzzySearch(items, 'abc', 10);
      expect(results.length).toBe(0);
    });

    test('does not match if not all characters present', () => {
      const items = ['ab.txt'];
      const results = fuzzySearch(items, 'abc', 10);
      expect(results.length).toBe(0);
    });
  });

  describe('ranking and sorting', () => {
    test('higher scores rank first', () => {
      const items = [
        './deep/path/prd.json', // filename exact: 800
        'prd-auth.json', // filename starts: 600+
        './prd/config.json', // path contains: 200+
      ];
      const results = fuzzySearch(items, 'prd', 10);
      expect(results[0].item).toBe('./deep/path/prd.json');
      expect(results[1].item).toBe('prd-auth.json');
    });

    test('ties are sorted alphabetically', () => {
      // Use same-length filenames to ensure truly equal scores
      const items = ['zzz-prd.json', 'aaa-prd.json', 'mmm-prd.json'];
      const results = fuzzySearch(items, 'prd', 10);
      // All have same length and same match position, so alphabetical
      expect(results.map((r) => r.item)).toEqual([
        'aaa-prd.json',
        'mmm-prd.json',
        'zzz-prd.json',
      ]);
    });

    test('shorter filenames with same match rank higher', () => {
      // Score formula: 400 + (queryLen / filenameLen) * 50
      // Shorter filename = higher ratio = higher score
      const items = ['alpha-prd.json', 'beta-prd.json']; // 14 chars vs 13 chars
      const results = fuzzySearch(items, 'prd', 10);
      expect(results[0].item).toBe('beta-prd.json'); // Shorter, so higher score
    });
  });

  describe('limit parameter', () => {
    test('limits results to specified count', () => {
      const items = ['a-prd.json', 'b-prd.json', 'c-prd.json', 'd-prd.json'];
      const results = fuzzySearch(items, 'prd', 2);
      expect(results.length).toBe(2);
    });

    test('default limit is 10', () => {
      const items = Array.from({ length: 20 }, (_, i) => `file${i}-prd.json`);
      const results = fuzzySearch(items, 'prd');
      expect(results.length).toBe(10);
    });
  });

  describe('real-world file patterns', () => {
    test('finds prd files in nested directories', () => {
      const items = [
        './node_modules/some-package/index.js',
        './tasks/authentication/prd.json',
        './tasks/dashboard/prd-widgets.json',
        './src/components/Button.tsx',
        './prd.json',
      ];
      const results = fuzzySearch(items, 'prd', 10);
      expect(results.length).toBe(3);
      expect(results.map((r) => r.item)).toContain('./prd.json');
      expect(results.map((r) => r.item)).toContain('./tasks/authentication/prd.json');
    });

    test('matches partial filenames for quick filtering', () => {
      const items = [
        'prd-user-authentication.json',
        'prd-dashboard-widgets.json',
        'prd-api-endpoints.json',
        'config.json',
      ];
      // User types 'auth' to find authentication PRD
      const results = fuzzySearch(items, 'auth', 10);
      expect(results[0].item).toBe('prd-user-authentication.json');
    });

    test('handles mixed case filenames', () => {
      const items = ['PRD-Auth.JSON', 'prd-auth.json', 'Prd-AUTH.Json'];
      const results = fuzzySearch(items, 'prd-auth', 10);
      expect(results.length).toBe(3);
      // All should match, alphabetically sorted for ties
    });
  });
});

describe('fuzzyFilter', () => {
  test('returns matching items without scores', () => {
    const items = ['apple', 'apricot', 'banana'];
    const results = fuzzyFilter(items, 'ap');
    expect(results).toContain('apple');
    expect(results).toContain('apricot');
    expect(results).not.toContain('banana');
  });

  test('returns all items for empty query', () => {
    const items = ['c', 'a', 'b'];
    const results = fuzzyFilter(items, '');
    expect(results).toEqual(['a', 'b', 'c']); // Sorted alphabetically
  });

  test('returns empty array when no matches', () => {
    const items = ['apple', 'banana'];
    const results = fuzzyFilter(items, 'xyz');
    expect(results).toEqual([]);
  });
});
