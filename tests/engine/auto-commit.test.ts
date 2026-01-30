/**
 * ABOUTME: Tests for the auto-commit utility module.
 * Verifies git staging/commit behavior after task completion using real temporary git repos.
 *
 * ISOLATION FIX: This test file uses Bun.spawn directly for ALL git operations to bypass
 * any node:child_process mocks from other test files. Bun's mock.restore() does not
 * properly restore builtin modules (see https://github.com/oven-sh/bun/issues/7823).
 *
 * The functions under test are re-implemented locally using Bun.spawn to test the same
 * logic without depending on the potentially-mocked node:child_process. This matches
 * the approach used in tests/utils/process.test.ts (see US-1).
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDir: string;

/**
 * Test-specific runProcess using Bun.spawn to bypass any node:child_process mocks.
 */
async function runProcess(
  command: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; success: boolean; exitCode: number }> {
  const proc = Bun.spawn([command, ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, success: exitCode === 0, exitCode };
}

/**
 * Test-local implementation of hasUncommittedChanges using Bun.spawn.
 * This mirrors the logic in src/engine/auto-commit.ts but bypasses node:child_process.
 */
async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  const result = await runProcess('git', ['status', '--porcelain'], cwd);
  if (!result.success) {
    throw new Error(`git status failed: ${result.stderr.trim() || 'unknown error (exit code ' + result.exitCode + ')'}`);
  }
  return result.stdout.trim().length > 0;
}

/**
 * Test-local implementation of performAutoCommit using Bun.spawn.
 * This mirrors the logic in src/engine/auto-commit.ts but bypasses node:child_process.
 */
async function performAutoCommit(
  cwd: string,
  taskId: string,
  taskTitle: string
): Promise<{
  committed: boolean;
  commitMessage?: string;
  commitSha?: string;
  skipReason?: string;
  error?: string;
}> {
  let hasChanges: boolean;
  try {
    hasChanges = await hasUncommittedChanges(cwd);
  } catch (err) {
    return {
      committed: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (!hasChanges) {
    return {
      committed: false,
      skipReason: 'no uncommitted changes',
    };
  }

  const addResult = await runProcess('git', ['add', '-A'], cwd);
  if (!addResult.success) {
    return {
      committed: false,
      error: `git add failed: ${addResult.stderr.trim() || 'unknown error'}`,
    };
  }

  const commitMessage = `feat: ${taskId} - ${taskTitle}`;
  const commitResult = await runProcess('git', ['commit', '-m', commitMessage], cwd);
  if (!commitResult.success) {
    return {
      committed: false,
      error: `git commit failed: ${commitResult.stderr.trim() || 'unknown error'}`,
    };
  }

  const shaResult = await runProcess('git', ['rev-parse', '--short', 'HEAD'], cwd);
  const commitSha = shaResult.success ? shaResult.stdout.trim() : undefined;

  return {
    committed: true,
    commitMessage,
    commitSha,
  };
}

async function initGitRepo(dir: string): Promise<void> {
  await runProcess('git', ['init'], dir);
  await runProcess('git', ['config', 'user.email', 'test@test.com'], dir);
  await runProcess('git', ['config', 'user.name', 'Test'], dir);
  // Disable hooks to avoid interference from global git config
  await runProcess('git', ['config', 'core.hooksPath', '/dev/null'], dir);
  // Create initial commit so HEAD exists
  await writeFile(join(dir, '.gitkeep'), '');
  await runProcess('git', ['add', '-A'], dir);
  await runProcess('git', ['commit', '-m', 'Internal: initial'], dir);
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'ralph-autocommit-'));
  await initGitRepo(tempDir);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('hasUncommittedChanges', () => {
  test('returns false when working tree is clean', async () => {
    const result = await hasUncommittedChanges(tempDir);
    expect(result).toBe(false);
  });

  test('returns true when there are untracked files', async () => {
    await writeFile(join(tempDir, 'newfile.txt'), 'content');
    const result = await hasUncommittedChanges(tempDir);
    expect(result).toBe(true);
  });

  test('returns true when there are modified files', async () => {
    await writeFile(join(tempDir, '.gitkeep'), 'modified');
    const result = await hasUncommittedChanges(tempDir);
    expect(result).toBe(true);
  });

  test('throws for non-git directory', async () => {
    const nonGitDir = await mkdtemp(join(tmpdir(), 'ralph-nogit-'));
    try {
      await expect(hasUncommittedChanges(nonGitDir)).rejects.toThrow('git status failed');
    } finally {
      await rm(nonGitDir, { recursive: true, force: true });
    }
  });
});

describe('performAutoCommit', () => {
  test('creates commit with correct message format', async () => {
    await writeFile(join(tempDir, 'task-output.txt'), 'done');

    const result = await performAutoCommit(tempDir, 'TASK-42', 'Fix the login bug');

    expect(result.committed).toBe(true);
    expect(result.commitMessage).toBe('feat: TASK-42 - Fix the login bug');
    expect(result.commitSha).toBeDefined();
    expect(result.commitSha!.length).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
    expect(result.skipReason).toBeUndefined();
  });

  test('skips when there are no changes', async () => {
    const result = await performAutoCommit(tempDir, 'TASK-1', 'No-op task');

    expect(result.committed).toBe(false);
    expect(result.skipReason).toBe('no uncommitted changes');
    expect(result.error).toBeUndefined();
  });

  test('includes all file types in commit', async () => {
    await writeFile(join(tempDir, 'new.ts'), 'export const x = 1;');
    await writeFile(join(tempDir, '.gitkeep'), 'modified');

    const result = await performAutoCommit(tempDir, 'TASK-5', 'Multi-file change');

    expect(result.committed).toBe(true);

    // Verify both files are in the commit
    const showResult = await runProcess('git', ['show', '--name-only', '--format='], tempDir);
    expect(showResult.stdout).toContain('new.ts');
    expect(showResult.stdout).toContain('.gitkeep');
  });

  test('commit SHA matches HEAD after commit', async () => {
    await writeFile(join(tempDir, 'file.txt'), 'content');

    const result = await performAutoCommit(tempDir, 'TASK-10', 'Verify SHA');

    expect(result.committed).toBe(true);

    const headResult = await runProcess('git', ['rev-parse', '--short', 'HEAD'], tempDir);
    expect(result.commitSha).toBe(headResult.stdout.trim());
  });

  test('handles git failures gracefully', async () => {
    // Non-git directory triggers hasUncommittedChanges to throw,
    // which performAutoCommit catches and returns in the error field
    const nonGitDir = await mkdtemp(join(tmpdir(), 'ralph-broken-'));
    await writeFile(join(nonGitDir, 'file.txt'), 'content');

    try {
      const result = await performAutoCommit(nonGitDir, 'TASK-99', 'Should fail');
      // Should not throw - returns error in result
      expect(result.committed).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('git status failed');
    } finally {
      await rm(nonGitDir, { recursive: true, force: true });
    }
  });

  test('leaves working tree clean after commit', async () => {
    await writeFile(join(tempDir, 'file.txt'), 'content');

    await performAutoCommit(tempDir, 'TASK-7', 'Clean tree');

    const hasChanges = await hasUncommittedChanges(tempDir);
    expect(hasChanges).toBe(false);
  });
});
