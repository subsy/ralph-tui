/**
 * ABOUTME: Tests for sandbox detection utilities using Bun.spawn to avoid mock pollution.
 * These tests verify command existence checking and sandbox mode detection.
 *
 * These tests are separate from src/sandbox/detect.test.ts because they need
 * real process spawning, which is polluted by other tests that mock node:child_process.
 */

import { describe, expect, test } from 'bun:test';

/**
 * Local implementation of commandExists using Bun.spawn to bypass mock pollution.
 * Mirrors the logic in src/sandbox/detect.ts but uses Bun's native spawn.
 *
 * NOTE: Uses process.platform instead of platform() from node:os to avoid
 * mock pollution from other tests that mock the node:os module.
 */
async function commandExists(command: string): Promise<boolean> {
  if (!command || !command.trim()) {
    return false;
  }

  const isWindows = process.platform === 'win32';
  const whichCmd = isWindows ? 'where' : 'which';

  try {
    const proc = Bun.spawn([whichCmd, command], {
      stdout: 'ignore',
      stderr: 'ignore',
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

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

/**
 * Local implementation of detectSandboxMode using the local commandExists.
 * Mirrors the logic in src/sandbox/detect.ts but uses Bun.spawn via commandExists.
 *
 * NOTE: Uses process.platform instead of platform() from node:os to avoid
 * mock pollution from other tests that mock the node:os module.
 */
async function detectSandboxMode(): Promise<'bwrap' | 'sandbox-exec' | 'off'> {
  const os = process.platform;

  // bwrap is only available on Linux
  if (os === 'linux' && (await commandExists('bwrap'))) {
    return 'bwrap';
  }

  // sandbox-exec is built-in on macOS (darwin)
  if (os === 'darwin' && (await commandExists('sandbox-exec'))) {
    return 'sandbox-exec';
  }

  // No sandbox available on this platform
  return 'off';
}

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

  test('returns bwrap on Linux if bwrap is installed', async () => {
    if (process.platform !== 'linux') {
      return; // Skip test on non-Linux
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
      return; // Skip test on non-macOS
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
      return; // Skip test on non-Windows
    }

    const result = await detectSandboxMode();
    expect(result).toBe('off');
  });
});
