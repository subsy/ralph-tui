/**
 * ABOUTME: Tests for sandbox detection utilities.
 * Verifies command existence checking and platform-based sandbox mode detection.
 */

import { describe, expect, test } from 'bun:test';
import { commandExists, detectSandboxMode } from './detect.js';

describe('commandExists', () => {
  test('returns true for existing command (bun)', async () => {
    // 'bun' should exist in the test environment
    const result = await commandExists('bun');
    expect(result).toBe(true);
  });

  test('returns true for which command', async () => {
    // 'which' doesn't exist on Windows (uses 'where' instead)
    if (process.platform === 'win32') {
      return; // Skip on Windows
    }
    // 'which' should exist on Linux/macOS
    const result = await commandExists('which');
    expect(result).toBe(true);
  });

  test('returns false for non-existent command', async () => {
    const result = await commandExists('this-command-definitely-does-not-exist-12345');
    expect(result).toBe(false);
  });

  test('returns false for empty command string', async () => {
    const result = await commandExists('');
    expect(result).toBe(false);
  });

  test('returns false for command with spaces only', async () => {
    const result = await commandExists('   ');
    expect(result).toBe(false);
  });
});

describe('detectSandboxMode', () => {
  test('returns a valid sandbox mode', async () => {
    const result = await detectSandboxMode();

    // Should return one of the valid modes (excluding 'auto' which is resolved)
    expect(['bwrap', 'sandbox-exec', 'off']).toContain(result);
  });

  test('does not return auto mode', async () => {
    const result = await detectSandboxMode();

    // detectSandboxMode resolves 'auto' to a concrete mode
    expect(result).not.toBe('auto');
  });

  // Platform-specific tests - these verify the actual behavior on the running system
  test('returns bwrap on Linux if bwrap is installed', async () => {
    if (process.platform !== 'linux') {
      // Skip test on non-Linux
      return;
    }

    const hasBwrap = await commandExists('bwrap');
    const result = await detectSandboxMode();

    if (hasBwrap) {
      expect(result).toBe('bwrap');
    } else {
      expect(result).toBe('off');
    }
  });

  test('returns sandbox-exec on macOS if available', async () => {
    if (process.platform !== 'darwin') {
      // Skip test on non-macOS
      return;
    }

    const hasSandboxExec = await commandExists('sandbox-exec');
    const result = await detectSandboxMode();

    if (hasSandboxExec) {
      expect(result).toBe('sandbox-exec');
    } else {
      expect(result).toBe('off');
    }
  });

  test('returns off on Windows', async () => {
    if (process.platform !== 'win32') {
      // Skip test on non-Windows
      return;
    }

    const result = await detectSandboxMode();
    expect(result).toBe('off');
  });
});

describe('commandExists timing', () => {
  test('resolves within reasonable time for existing command', async () => {
    const start = Date.now();
    await commandExists('bun');
    const elapsed = Date.now() - start;

    // Should resolve quickly for existing commands
    expect(elapsed).toBeLessThan(1000);
  });

  test('resolves within reasonable time for non-existent command', async () => {
    const start = Date.now();
    await commandExists('nonexistent-command-xyz');
    const elapsed = Date.now() - start;

    // Should resolve quickly even for non-existent commands
    // (which returns non-zero exit code quickly)
    expect(elapsed).toBeLessThan(1000);
  });
});
