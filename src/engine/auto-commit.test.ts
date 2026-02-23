/**
 * ABOUTME: Tests for the auto-commit utility.
 * Verifies commit message format, iteration context, and default config behavior.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { performAutoCommit } from './auto-commit.js';

// Mock the process utility
const mockRunProcess = mock(() =>
  Promise.resolve({ success: true, stdout: '', stderr: '', exitCode: 0 })
);

mock.module('../utils/process.js', () => ({
  runProcess: mockRunProcess,
}));

describe('performAutoCommit', () => {
  beforeEach(() => {
    mockRunProcess.mockClear();
  });

  test('includes iteration number in commit message', async () => {
    // git status returns changes
    mockRunProcess
      .mockResolvedValueOnce({ success: true, stdout: 'M src/foo.ts\n', stderr: '', exitCode: 0 })
      // git add
      .mockResolvedValueOnce({ success: true, stdout: '', stderr: '', exitCode: 0 })
      // git commit
      .mockResolvedValueOnce({ success: true, stdout: '', stderr: '', exitCode: 0 })
      // git rev-parse
      .mockResolvedValueOnce({ success: true, stdout: 'abc1234\n', stderr: '', exitCode: 0 });

    const result = await performAutoCommit('/tmp/repo', 'TASK-001', 'My Task', 3);

    expect(result.committed).toBe(true);
    expect(result.commitMessage).toContain('feat(ralph): TASK-001 - My Task');
    expect(result.commitMessage).toContain('Iteration: 3');
    expect(result.commitMessage).toContain('Agent: ralph-tui');
  });

  test('commit message without iteration when not provided', async () => {
    mockRunProcess
      .mockResolvedValueOnce({ success: true, stdout: 'M src/foo.ts\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ success: true, stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ success: true, stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ success: true, stdout: 'abc1234\n', stderr: '', exitCode: 0 });

    const result = await performAutoCommit('/tmp/repo', 'TASK-002', 'Another Task');

    expect(result.committed).toBe(true);
    expect(result.commitMessage).toBe('feat(ralph): TASK-002 - Another Task');
    expect(result.commitMessage).not.toContain('Iteration:');
  });

  test('skips commit when no uncommitted changes', async () => {
    mockRunProcess.mockResolvedValueOnce({ success: true, stdout: '', stderr: '', exitCode: 0 });

    const result = await performAutoCommit('/tmp/repo', 'TASK-003', 'Empty Task', 1);

    expect(result.committed).toBe(false);
    expect(result.skipReason).toBe('no uncommitted changes');
  });

  test('returns error when git status fails', async () => {
    mockRunProcess.mockResolvedValueOnce({
      success: false,
      stdout: '',
      stderr: 'not a git repository',
      exitCode: 128,
    });

    const result = await performAutoCommit('/tmp/notarepo', 'TASK-004', 'Bad Task', 2);

    expect(result.committed).toBe(false);
    expect(result.error).toContain('git status failed');
  });

  test('returns error when git add fails', async () => {
    mockRunProcess
      .mockResolvedValueOnce({ success: true, stdout: 'M src/foo.ts\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ success: false, stdout: '', stderr: 'permission denied', exitCode: 1 });

    const result = await performAutoCommit('/tmp/repo', 'TASK-005', 'Add Fail', 1);

    expect(result.committed).toBe(false);
    expect(result.error).toContain('git add failed');
  });

  test('returns error when git commit fails', async () => {
    mockRunProcess
      .mockResolvedValueOnce({ success: true, stdout: 'M src/foo.ts\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ success: true, stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ success: false, stdout: '', stderr: 'commit hook failed', exitCode: 1 });

    const result = await performAutoCommit('/tmp/repo', 'TASK-006', 'Commit Fail', 5);

    expect(result.committed).toBe(false);
    expect(result.error).toContain('git commit failed');
  });
});

describe('default config autoCommit', () => {
  test('DEFAULT_CONFIG does not include autoCommit (it is set in buildConfig)', async () => {
    const { DEFAULT_CONFIG } = await import('../config/types.js');
    // autoCommit is not part of DEFAULT_CONFIG — it is applied in buildConfig
    // with a default of true. Verify DEFAULT_CONFIG does not set it to false.
    expect((DEFAULT_CONFIG as Record<string, unknown>).autoCommit).toBeUndefined();
  });
});

describe('parseRunArgs auto-commit flags', () => {
  test('--no-auto-commit sets autoCommit to false', async () => {
    const { parseRunArgs } = await import('../commands/run.js');
    const result = parseRunArgs(['--no-auto-commit']);
    expect(result.autoCommit).toBe(false);
  });

  test('--auto-commit sets autoCommit to true', async () => {
    const { parseRunArgs } = await import('../commands/run.js');
    const result = parseRunArgs(['--auto-commit']);
    expect(result.autoCommit).toBe(true);
  });

  test('no flag leaves autoCommit undefined (uses default)', async () => {
    const { parseRunArgs } = await import('../commands/run.js');
    const result = parseRunArgs([]);
    expect(result.autoCommit).toBeUndefined();
  });
});
