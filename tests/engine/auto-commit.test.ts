/**
 * ABOUTME: Tests for the auto-commit utility module.
 * Verifies git staging/commit behavior after task completion using real temporary git repos,
 * plus Handlebars-based rendering of configurable commit message templates.
 *
 * This test file uses Bun.spawn directly for all git operations to avoid mock pollution
 * from other test files. Bun's mock.restore() does not reliably restore builtin modules.
 * See: https://github.com/oven-sh/bun/issues/7823
 *
 * NOTE: The functions hasUncommittedChanges and performAutoCommit are re-implemented
 * locally using Bun.spawn because of the mock restoration issue above. Replace these
 * with imports from src/engine/auto-commit.ts when Bun's module mock restoration is
 * fixed, to keep tests in sync with production. `renderCommitMessage` is pure and is
 * imported directly from production.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  renderCommitMessage,
  DEFAULT_COMMIT_MESSAGE_TEMPLATE,
  DEFAULT_TASK_TYPE,
} from '../../src/engine/auto-commit.js';

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
 *
 * Signature matches the production function: callers pass a pre-rendered subject
 * (commit message templates are rendered in the engine via renderCommitMessage).
 */
async function performAutoCommit(
  cwd: string,
  commitMessage: string
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
  const runOrFail = async (args: string[], description: string): Promise<void> => {
    const result = await runProcess('git', args, dir);
    if (!result.success) {
      throw new Error(`${description} failed (exit ${result.exitCode}): ${result.stderr}`);
    }
  };

  await runOrFail(['init'], 'git init');
  await runOrFail(['config', 'user.email', 'test@test.com'], 'git config user.email');
  await runOrFail(['config', 'user.name', 'Test'], 'git config user.name');
  // Disable hooks to avoid interference from global git config
  await runOrFail(['config', 'core.hooksPath', '/dev/null'], 'git config core.hooksPath');
  // Create initial commit so HEAD exists
  await writeFile(join(dir, '.gitkeep'), '');
  await runOrFail(['add', '-A'], 'git add');
  await runOrFail(['commit', '-m', 'Internal: initial'], 'git commit');
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
  test('creates commit with supplied subject line', async () => {
    await writeFile(join(tempDir, 'task-output.txt'), 'done');

    const result = await performAutoCommit(tempDir, 'feature: TASK-42 Fix the login bug');

    expect(result.committed).toBe(true);
    expect(result.commitMessage).toBe('feature: TASK-42 Fix the login bug');
    expect(result.commitSha).toBeDefined();
    expect(result.commitSha!.length).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
    expect(result.skipReason).toBeUndefined();
  });

  test('skips when there are no changes', async () => {
    const result = await performAutoCommit(tempDir, 'chore: TASK-1 No-op task');

    expect(result.committed).toBe(false);
    expect(result.skipReason).toBe('no uncommitted changes');
    expect(result.error).toBeUndefined();
  });

  test('includes all file types in commit', async () => {
    await writeFile(join(tempDir, 'new.ts'), 'export const x = 1;');
    await writeFile(join(tempDir, '.gitkeep'), 'modified');

    const result = await performAutoCommit(tempDir, 'chore: TASK-5 Multi-file change');

    expect(result.committed).toBe(true);

    // Verify both files are in the commit
    const showResult = await runProcess('git', ['show', '--name-only', '--format='], tempDir);
    expect(showResult.stdout).toContain('new.ts');
    expect(showResult.stdout).toContain('.gitkeep');
  });

  test('commit SHA matches HEAD after commit', async () => {
    await writeFile(join(tempDir, 'file.txt'), 'content');

    const result = await performAutoCommit(tempDir, 'chore: TASK-10 Verify SHA');

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
      const result = await performAutoCommit(nonGitDir, 'chore: TASK-99 Should fail');
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

    await performAutoCommit(tempDir, 'chore: TASK-7 Clean tree');

    const hasChanges = await hasUncommittedChanges(tempDir);
    expect(hasChanges).toBe(false);
  });
});

describe('renderCommitMessage', () => {
  test('default template uses task.type when present', () => {
    const result = renderCommitMessage(undefined, {
      taskId: 'TASK-42',
      taskTitle: 'Fix the login bug',
      taskType: 'feature',
    });

    expect(result.message).toBe('feature: TASK-42 Fix the login bug');
    expect(result.usedFallback).toBe(false);
    expect(result.fallbackReason).toBeUndefined();
  });

  test('default template falls back to "chore" when task.type missing', () => {
    const result = renderCommitMessage(undefined, {
      taskId: 'TASK-1',
      taskTitle: 'Untyped work',
    });

    expect(result.message).toBe('chore: TASK-1 Untyped work');
    expect(result.usedFallback).toBe(false);
  });

  test('default template falls back to "chore" when task.type is whitespace', () => {
    const result = renderCommitMessage(undefined, {
      taskId: 'TASK-2',
      taskTitle: 'Empty type',
      taskType: '   ',
    });

    expect(result.message).toBe(`${DEFAULT_TASK_TYPE}: TASK-2 Empty type`);
    expect(result.usedFallback).toBe(false);
  });

  test('custom template references taskId, taskTitle, and taskType', () => {
    const result = renderCommitMessage('{{taskType}}({{taskId}}): {{taskTitle}}', {
      taskId: 'US-001',
      taskTitle: 'Prepare fs',
      taskType: 'feat',
    });

    expect(result.message).toBe('feat(US-001): Prepare fs');
    expect(result.usedFallback).toBe(false);
  });

  test('custom template that renders to whitespace falls back to default', () => {
    const result = renderCommitMessage('   ', {
      taskId: 'TASK-3',
      taskTitle: 'Whitespace template',
      taskType: 'bug',
    });

    expect(result.message).toBe('bug: TASK-3 Whitespace template');
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBeDefined();
  });

  test('invalid Handlebars syntax falls back to default and surfaces reason', () => {
    // Unclosed mustache triggers a Handlebars parse error.
    const result = renderCommitMessage('{{taskId', {
      taskId: 'TASK-4',
      taskTitle: 'Broken template',
      taskType: 'bug',
    });

    expect(result.message).toBe('bug: TASK-4 Broken template');
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toBeDefined();
    expect(result.fallbackReason!.length).toBeGreaterThan(0);
  });

  test('does not HTML-escape characters in task titles', () => {
    const result = renderCommitMessage(undefined, {
      taskId: 'TASK-5',
      taskTitle: `Handle "quotes" & <brackets>`,
      taskType: 'fix',
    });

    expect(result.message).toBe(`fix: TASK-5 Handle "quotes" & <brackets>`);
    expect(result.usedFallback).toBe(false);
  });

  test('exports DEFAULT_COMMIT_MESSAGE_TEMPLATE matching the documented default', () => {
    expect(DEFAULT_COMMIT_MESSAGE_TEMPLATE).toBe('{{taskType}}: {{taskId}} {{taskTitle}}');
  });
});
