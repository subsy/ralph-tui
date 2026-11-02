/**
 * ABOUTME: Tests for the checkBunVersion validation function.
 * Verifies that minimum Bun version enforcement works correctly.
 */

import { describe, expect, test } from 'bun:test';
import { checkBunVersion } from './validation.js';

describe('checkBunVersion', () => {
  const MIN_VERSION = '1.3.6';

  test('returns null when version matches exactly', () => {
    expect(checkBunVersion('1.3.6', MIN_VERSION)).toBeNull();
  });

  test('returns null when patch is higher', () => {
    expect(checkBunVersion('1.3.7', MIN_VERSION)).toBeNull();
  });

  test('returns null when minor is higher', () => {
    expect(checkBunVersion('1.4.0', MIN_VERSION)).toBeNull();
  });

  test('returns null when major is higher', () => {
    expect(checkBunVersion('2.0.0', MIN_VERSION)).toBeNull();
  });

  test('returns error when patch is lower', () => {
    const result = checkBunVersion('1.3.5', MIN_VERSION);
    expect(result).not.toBeNull();
    expect(result).toContain('requires Bun >= 1.3.6');
    expect(result).toContain('Bun 1.3.5');
    expect(result).toContain('bun upgrade');
    expect(result).toContain('https://bun.sh/docs/installation');
  });

  test('returns error when minor is lower', () => {
    const result = checkBunVersion('1.2.9', MIN_VERSION);
    expect(result).not.toBeNull();
    expect(result).toContain('requires Bun >= 1.3.6');
    expect(result).toContain('Bun 1.2.9');
  });

  test('returns error when major is lower', () => {
    const result = checkBunVersion('0.9.9', MIN_VERSION);
    expect(result).not.toBeNull();
    expect(result).toContain('Bun 0.9.9');
  });

  test('handles pre-release versions by stripping metadata', () => {
    // 1.3.6-beta should compare as 1.3.6 (equal, so OK)
    expect(checkBunVersion('1.3.6-beta', MIN_VERSION)).toBeNull();
  });

  test('pre-release below minimum returns error', () => {
    // 1.3.5-beta strips to 1.3.5, which is below 1.3.6
    const result = checkBunVersion('1.3.5-beta', MIN_VERSION);
    expect(result).not.toBeNull();
    expect(result).toContain('requires Bun >= 1.3.6');
    expect(result).toContain('Bun 1.3.5-beta');
  });

  test('handles build metadata in versions', () => {
    expect(checkBunVersion('1.3.6+build123', MIN_VERSION)).toBeNull();
  });

  test('handles numeric comparison correctly (1.10.0 > 1.9.0)', () => {
    expect(checkBunVersion('1.10.0', '1.9.0')).toBeNull();
  });
});
