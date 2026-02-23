/**
 * ABOUTME: Tests for the verification gate runner.
 * Covers runVerification and formatVerificationErrors for post-completion checks.
 */

import { describe, it, expect, mock, beforeAll } from 'bun:test';
import { DEFAULT_VERIFICATION_CONFIG } from '../../src/config/types';
import type { VerificationResult } from '../../src/engine/verification';

// We test runVerification by mocking runProcess to avoid real process spawning
// (Bun's mock.module can interfere with child_process across test files)

let mockRunProcess: ReturnType<typeof mock>;
let runVerification: typeof import('../../src/engine/verification').runVerification;
let formatVerificationErrors: typeof import('../../src/engine/verification').formatVerificationErrors;

beforeAll(async () => {
  mockRunProcess = mock();
  mock.module('../../src/utils/process.js', () => ({
    runProcess: mockRunProcess,
  }));
  const mod = await import('../../src/engine/verification');
  runVerification = mod.runVerification;
  formatVerificationErrors = mod.formatVerificationErrors;
});

const successResult = { exitCode: 0, signal: null, stdout: '', stderr: '', success: true };
const failResult = { exitCode: 1, signal: null, stdout: '', stderr: 'error output', success: false };

describe('runVerification', () => {
  it('returns passed=true when all commands succeed', async () => {
    mockRunProcess.mockResolvedValueOnce(successResult);
    mockRunProcess.mockResolvedValueOnce(successResult);
    const result = await runVerification('/cwd', {
      ...DEFAULT_VERIFICATION_CONFIG,
      commands: ['cmd1', 'cmd2'],
    });
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results.every(r => r.passed)).toBe(true);
  });

  it('returns passed=true for empty commands array (vacuously true)', async () => {
    const result = await runVerification('/cwd', {
      ...DEFAULT_VERIFICATION_CONFIG,
      commands: [],
    });
    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(0);
  });

  it('stops at first failure and returns passed=false', async () => {
    mockRunProcess.mockResolvedValueOnce(failResult);
    const result = await runVerification('/cwd', {
      ...DEFAULT_VERIFICATION_CONFIG,
      commands: ['fail-cmd', 'success-cmd'],
    });
    expect(result.passed).toBe(false);
    // Should stop after first failure — only 1 command run
    expect(result.results).toHaveLength(1);
    expect(result.results[0].passed).toBe(false);
    expect(result.results[0].exitCode).toBe(1);
  });

  it('captures stdout and stderr from commands', async () => {
    mockRunProcess.mockResolvedValueOnce({
      exitCode: 1,
      signal: null,
      stdout: 'hello stdout',
      stderr: 'hello stderr',
      success: false,
    });
    const result = await runVerification('/cwd', {
      ...DEFAULT_VERIFICATION_CONFIG,
      commands: ['my-cmd'],
    });
    expect(result.passed).toBe(false);
    expect(result.results[0].stdout).toContain('hello stdout');
    expect(result.results[0].stderr).toContain('hello stderr');
  });

  it('returns passed=false when command times out (process returns non-success)', async () => {
    mockRunProcess.mockResolvedValueOnce({
      exitCode: null,
      signal: 'SIGTERM',
      stdout: '',
      stderr: '',
      success: false,
    });
    const result = await runVerification('/cwd', {
      ...DEFAULT_VERIFICATION_CONFIG,
      commands: ['sleep-cmd'],
      timeoutMs: 100,
    });
    expect(result.passed).toBe(false);
  });

  it('records durationMs', async () => {
    mockRunProcess.mockResolvedValueOnce(successResult);
    const result = await runVerification('/cwd', {
      ...DEFAULT_VERIFICATION_CONFIG,
      commands: ['fast-cmd'],
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('passes correct cwd and timeout to runProcess', async () => {
    mockRunProcess.mockResolvedValueOnce(successResult);
    await runVerification('/my/project', {
      ...DEFAULT_VERIFICATION_CONFIG,
      commands: ['check-cmd'],
      timeoutMs: 30000,
    });
    expect(mockRunProcess).toHaveBeenCalledWith(
      'sh',
      ['-c', 'check-cmd'],
      { cwd: '/my/project', timeout: 30000 }
    );
  });
});

describe('formatVerificationErrors', () => {
  it('returns empty string when all commands passed', () => {
    const result: VerificationResult = {
      passed: true,
      durationMs: 100,
      results: [
        { command: 'bun run typecheck', exitCode: 0, stdout: '', stderr: '', passed: true, durationMs: 50 },
      ],
    };
    expect(formatVerificationErrors(result)).toBe('');
  });

  it('formats failed commands into readable multi-line string', () => {
    const result: VerificationResult = {
      passed: false,
      durationMs: 100,
      results: [
        {
          command: 'bun run typecheck',
          exitCode: 1,
          stdout: 'some output',
          stderr: 'Type error: foo is not defined',
          passed: false,
          durationMs: 50,
        },
      ],
    };
    const formatted = formatVerificationErrors(result);
    expect(formatted).toContain('bun run typecheck');
    expect(formatted).toContain('Exit code: 1');
    expect(formatted).toContain('Type error: foo is not defined');
    expect(formatted).toContain('some output');
  });

  it('only includes failed commands, not passed ones', () => {
    const result: VerificationResult = {
      passed: false,
      durationMs: 100,
      results: [
        { command: 'cmd-ok', exitCode: 0, stdout: '', stderr: '', passed: true, durationMs: 10 },
        { command: 'bun run build', exitCode: 2, stdout: '', stderr: 'Build failed', passed: false, durationMs: 40 },
      ],
    };
    const formatted = formatVerificationErrors(result);
    expect(formatted).toContain('bun run build');
    expect(formatted).not.toContain('cmd-ok');
  });

  it('returns empty string when no results', () => {
    const result: VerificationResult = {
      passed: true,
      durationMs: 0,
      results: [],
    };
    expect(formatVerificationErrors(result)).toBe('');
  });
});
