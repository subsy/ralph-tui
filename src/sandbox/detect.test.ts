/**
 * ABOUTME: Unit tests for sandbox detection utilities that don't require real process spawning.
 *
 * NOTE: Tests for commandExists and detectSandboxMode that require real process spawning
 * are in tests/sandbox/detect.test.ts using Bun.spawn to avoid mock pollution from
 * other test files that mock node:child_process.
 *
 * This file is intentionally minimal - most sandbox detection tests need real spawn.
 */

import { describe, expect, test } from 'bun:test';
import { platform } from 'node:os';

describe('sandbox detection constants', () => {
  test('platform returns expected values', () => {
    const currentPlatform = platform();
    // platform() should return a known value
    expect(['darwin', 'linux', 'win32', 'freebsd', 'openbsd', 'sunos', 'aix']).toContain(
      currentPlatform
    );
  });
});
