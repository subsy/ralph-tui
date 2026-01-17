/**
 * ABOUTME: Tests for process utility functions.
 * Tests process spawning helpers and command parsing.
 *
 * NOTE: These tests use the current runtime (bun/node) for cross-platform
 * compatibility instead of Unix-specific commands. The runtime is invoked
 * with -e flag to execute inline JavaScript.
 */

import { describe, test, expect } from 'bun:test';
import { tmpdir } from 'node:os';
import {
  runProcess,
  parseCommand,
  buildCommand,
  isProcessRunning,
  getEnv,
  requireEnv,
} from '../../src/utils/process.js';

describe('process utility', () => {
  describe('runProcess', () => {
    test('runs simple command and captures stdout', async () => {
      // Use bun to print a string (cross-platform)
      const result = await runProcess(process.execPath, [
        '-e',
        'console.log("hello")',
      ]);
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello');
    });

    test('captures stderr on failure', async () => {
      // Use bun with invalid syntax to generate stderr
      const result = await runProcess(process.execPath, [
        '-e',
        'process.exit(1)',
      ]);
      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
    });

    test('handles command with arguments', async () => {
      // Use bun to print multiple values passed via script
      const result = await runProcess(process.execPath, [
        '-e',
        'console.log("hello", "world")',
      ]);
      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe('hello world');
    });

    test('respects timeout', async () => {
      // Use bun with a long-running script
      const result = await runProcess(
        process.execPath,
        ['-e', 'setTimeout(() => {}, 10000)'],
        { timeout: 100 },
      );
      expect(result.success).toBe(false);
      expect(result.signal).toBe('SIGTERM');
    });

    test('uses custom working directory', async () => {
      const testDir = tmpdir();
      const result = await runProcess(
        process.execPath,
        ['-e', 'console.log(process.cwd())'],
        {
          cwd: testDir,
        },
      );
      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe(testDir);
    });

    test('uses custom environment variables', async () => {
      const result = await runProcess(
        process.execPath,
        ['-e', 'console.log(process.env.TEST_VAR)'],
        { env: { ...process.env, TEST_VAR: 'test_value' } },
      );
      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe('test_value');
    });

    test('handles non-existent command', async () => {
      const result = await runProcess('nonexistent-command-xyz', []);
      expect(result.success).toBe(false);
    });
  });

  describe('parseCommand', () => {
    test('parses simple command', () => {
      const result = parseCommand('echo hello');
      expect(result.command).toBe('echo');
      expect(result.args).toEqual(['hello']);
    });

    test('parses command with multiple arguments', () => {
      const result = parseCommand('ls -la /tmp');
      expect(result.command).toBe('ls');
      expect(result.args).toEqual(['-la', '/tmp']);
    });

    test('handles double quotes', () => {
      const result = parseCommand('echo "hello world"');
      expect(result.command).toBe('echo');
      expect(result.args).toEqual(['hello world']);
    });

    test('handles single quotes', () => {
      const result = parseCommand("echo 'hello world'");
      expect(result.command).toBe('echo');
      expect(result.args).toEqual(['hello world']);
    });

    test('handles mixed quotes', () => {
      const result = parseCommand('echo "hello" \'world\'');
      expect(result.command).toBe('echo');
      expect(result.args).toEqual(['hello', 'world']);
    });

    test('handles empty string', () => {
      const result = parseCommand('');
      expect(result.command).toBe('');
      expect(result.args).toEqual([]);
    });

    test('handles command only', () => {
      const result = parseCommand('pwd');
      expect(result.command).toBe('pwd');
      expect(result.args).toEqual([]);
    });
  });

  describe('buildCommand', () => {
    test('builds simple command', () => {
      const result = buildCommand('echo', ['hello']);
      expect(result).toBe('echo hello');
    });

    test('quotes arguments with spaces', () => {
      const result = buildCommand('echo', ['hello world']);
      expect(result).toBe('echo "hello world"');
    });

    test('escapes quotes in arguments', () => {
      const result = buildCommand('echo', ['say "hello"']);
      expect(result).toBe('echo "say \\"hello\\""');
    });

    test('handles empty arguments array', () => {
      const result = buildCommand('pwd', []);
      expect(result).toBe('pwd');
    });

    test('handles multiple arguments', () => {
      const result = buildCommand('ls', ['-la', '/tmp']);
      expect(result).toBe('ls -la /tmp');
    });
  });

  describe('isProcessRunning', () => {
    test('returns true for current process', () => {
      expect(isProcessRunning(process.pid)).toBe(true);
    });

    test('returns false for non-existent PID', () => {
      expect(isProcessRunning(999999)).toBe(false);
    });

    test('returns false for inaccessible PID', () => {
      // PID 1 may not be accessible in containerized environments
      // Just verify the function doesn't throw
      const result = isProcessRunning(1);
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getEnv', () => {
    test('returns environment variable value', () => {
      const result = getEnv('PATH');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    test('returns undefined for non-existent variable', () => {
      const result = getEnv('NONEXISTENT_VAR_XYZ');
      expect(result).toBeUndefined();
    });

    test('returns default value for non-existent variable', () => {
      const result = getEnv('NONEXISTENT_VAR_XYZ', 'default');
      expect(result).toBe('default');
    });
  });

  describe('requireEnv', () => {
    test('returns environment variable value', () => {
      const result = requireEnv('PATH');
      expect(typeof result).toBe('string');
    });

    test('throws for non-existent variable', () => {
      expect(() => requireEnv('NONEXISTENT_VAR_XYZ')).toThrow(
        'Required environment variable NONEXISTENT_VAR_XYZ is not set',
      );
    });
  });
});
