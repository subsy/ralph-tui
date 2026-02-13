/**
 * ABOUTME: Tests for engine memory-safety output helpers.
 * Ensures in-memory iteration history keeps bounded output while preserving tail markers.
 */

import { describe, expect, test } from 'bun:test';
import { __test__ as engineTest } from './index.js';

describe('ExecutionEngine memory helpers', () => {
  test('appendWithCharLimit preserves tail across current and chunk', () => {
    const prefix = '[trim]\n';
    const result = engineTest.appendWithCharLimit(
      'current-abcdefghijklmnopqrstuvwxyz',
      'chunk-0123456789',
      24,
      prefix
    );

    expect(result.startsWith(prefix)).toBe(true);
    expect(result.length).toBeLessThanOrEqual(24);
    expect(result.endsWith('zchunk-0123456789')).toBe(true);
  });

  test('toMemorySafeAgentResult returns same object for small output', () => {
    const input = {
      executionId: 'exec-1',
      status: 'completed' as const,
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      durationMs: 10,
      interrupted: false,
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(10).toISOString(),
    };

    const safe = engineTest.toMemorySafeAgentResult(input);
    expect(safe).toBe(input);
  });

  test('toMemorySafeAgentResult truncates long output and keeps tail', () => {
    const marker = '<promise>COMPLETE</promise>';
    const input = {
      executionId: 'exec-2',
      status: 'completed' as const,
      exitCode: 0,
      stdout: `${'x'.repeat(150_000)}${marker}`,
      stderr: 'e'.repeat(120_000),
      durationMs: 20,
      interrupted: false,
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(20).toISOString(),
    };

    const safe = engineTest.toMemorySafeAgentResult(input);

    expect(safe).not.toBe(input);
    expect(safe.stdout.length).toBeLessThanOrEqual(100_000);
    expect(safe.stderr.length).toBeLessThanOrEqual(100_000);
    expect(safe.stdout).toContain(marker);
    expect(safe.stdout.startsWith('[...output truncated in memory...]')).toBe(true);
  });
});
