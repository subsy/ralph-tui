/**
 * ABOUTME: Tests for BaseAgentPlugin in-memory stream truncation helpers.
 * Verifies that captured stdout/stderr buffers stay bounded and keep tail content.
 */

import { describe, expect, test } from 'bun:test';
import { __test__ as baseTest } from './base.js';

describe('BaseAgentPlugin memory helpers', () => {
  test('appendWithCharLimit preserves tail across current and chunk', () => {
    const prefix = '[trim]\n';
    const result = baseTest.appendWithCharLimit(
      'current-abcdefghijklmnopqrstuvwxyz',
      'chunk-0123456789',
      24,
      prefix
    );

    expect(result.startsWith(prefix)).toBe(true);
    expect(result.length).toBeLessThanOrEqual(24);
    expect(result.endsWith('zchunk-0123456789')).toBe(true);
  });

  test('appendWithCharLimit keeps full content under limit', () => {
    const result = baseTest.appendWithCharLimit('', 'hello', 10, '[trim]');
    expect(result).toBe('hello');
  });

  test('appendWithCharLimit truncates and preserves tail content', () => {
    const marker = '<promise>COMPLETE</promise>';
    const prefix = '[trim]\n';
    const result = baseTest.appendWithCharLimit(
      '',
      `${'x'.repeat(200)}${marker}`,
      80,
      prefix
    );

    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.startsWith(prefix)).toBe(true);
    expect(result).toContain(marker);
  });
});
