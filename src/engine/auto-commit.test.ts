/**
 * ABOUTME: Tests for the auto-commit utility.
 * Verifies commit message format, iteration context, and default config behavior.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { performAutoCommit, renderCommitMessage } from './auto-commit.js';

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

    const rendered = renderCommitMessage(
      'feat(ralph): {{taskId}} - {{taskTitle}}\n\nIteration: {{iteration}}\nAgent: {{agent}}',
      { taskId: 'TASK-001', taskTitle: 'My Task', iteration: 3 }
    );
    const result = await performAutoCommit('/tmp/repo', rendered.message);

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

    const result = await performAutoCommit('/tmp/repo', 'feat(ralph): TASK-002 - Another Task');

    expect(result.committed).toBe(true);
    expect(result.commitMessage).toBe('feat(ralph): TASK-002 - Another Task');
    expect(result.commitMessage).not.toContain('Iteration:');
  });

  test('skips commit when no uncommitted changes', async () => {
    mockRunProcess.mockResolvedValueOnce({ success: true, stdout: '', stderr: '', exitCode: 0 });

    const result = await performAutoCommit('/tmp/repo', 'feat(ralph): TASK-003 - Empty Task');

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

    const result = await performAutoCommit('/tmp/notarepo', 'feat(ralph): TASK-004 - Bad Task');

    expect(result.committed).toBe(false);
    expect(result.error).toContain('git status failed');
  });

  test('returns error when git add fails', async () => {
    mockRunProcess
      .mockResolvedValueOnce({ success: true, stdout: 'M src/foo.ts\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ success: false, stdout: '', stderr: 'permission denied', exitCode: 1 });

    const result = await performAutoCommit('/tmp/repo', 'feat(ralph): TASK-005 - Add Fail');

    expect(result.committed).toBe(false);
    expect(result.error).toContain('git add failed');
  });

  test('returns error when git commit fails', async () => {
    mockRunProcess
      .mockResolvedValueOnce({ success: true, stdout: 'M src/foo.ts\n', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ success: true, stdout: '', stderr: '', exitCode: 0 })
      .mockResolvedValueOnce({ success: false, stdout: '', stderr: 'commit hook failed', exitCode: 1 });

    const result = await performAutoCommit('/tmp/repo', 'feat(ralph): TASK-006 - Commit Fail');

    expect(result.committed).toBe(false);
    expect(result.error).toContain('git commit failed');
  });
});

describe('default config autoCommit', () => {
  test('DEFAULT_CONFIG does not include autoCommit (it is set in buildConfig)', async () => {
    const { DEFAULT_CONFIG } = await import('../config/types.js');
    // autoCommit is applied in buildConfig, not DEFAULT_CONFIG.
    expect((DEFAULT_CONFIG as Record<string, unknown>).autoCommit).toBeUndefined();
  });
});
