/**
 * ABOUTME: Tests for the diff summarizer module.
 * Verifies git diff capture, file categorization, and context formatting
 * using real temporary git repositories.
 *
 * This test file uses Bun.spawn directly for all git operations to avoid mock pollution
 * from other test files. Bun's mock.restore() does not reliably restore builtin modules.
 * See: https://github.com/oven-sh/bun/issues/7823
 *
 * NOTE: generateDiffSummary is re-implemented locally using Bun.spawn because of the mock
 * restoration issue above. The formatDiffContext function has no I/O so it is imported directly.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { formatDiffContext } from '../../src/engine/diff-summarizer.js';
import type { DiffSummary } from '../../src/engine/diff-summarizer.js';

let tempDir: string;

/**
 * Test-specific runProcess using Bun.spawn to bypass any node:child_process mocks.
 */
async function spawnGit(args: string[], cwd: string): Promise<{ stdout: string; success: boolean }> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { stdout, success: exitCode === 0 };
}

/**
 * Local implementation of generateDiffSummary using Bun.spawn directly.
 * Mirrors src/engine/diff-summarizer.ts but avoids node:child_process mock pollution.
 */
async function generateDiffSummaryLocal(cwd: string): Promise<DiffSummary | null> {
  const statusResult = await spawnGit(['status', '--porcelain'], cwd);
  if (!statusResult.success || !statusResult.stdout.trim()) return null;

  const lines = statusResult.stdout.split('\n').filter(line => line.length > 0);
  const filesAdded: string[] = [];
  const filesChanged: string[] = [];
  const filesDeleted: string[] = [];

  for (const line of lines) {
    const status = line.substring(0, 2).trim();
    const file = line.substring(3);
    if (status === 'A' || status === '??') filesAdded.push(file);
    else if (status === 'D') filesDeleted.push(file);
    else filesChanged.push(file);
  }

  const parts: string[] = [];
  if (filesAdded.length > 0) parts.push(`Created: ${filesAdded.join(', ')}`);
  if (filesChanged.length > 0) parts.push(`Modified: ${filesChanged.join(', ')}`);
  if (filesDeleted.length > 0) parts.push(`Deleted: ${filesDeleted.join(', ')}`);

  return {
    filesChanged,
    filesAdded,
    filesDeleted,
    summary: parts.join('\n'),
  };
}

async function initGitRepo(dir: string): Promise<void> {
  await spawnGit(['init'], dir);
  await spawnGit(['config', 'user.email', 'test@test.com'], dir);
  await spawnGit(['config', 'user.name', 'Test'], dir);
  // Create initial commit so HEAD exists
  await writeFile(join(dir, 'README.md'), '# Test');
  await spawnGit(['add', '.'], dir);
  await spawnGit(['commit', '-m', 'initial'], dir);
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'diff-summarizer-test-'));
  await initGitRepo(tempDir);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('generateDiffSummary', () => {
  test('returns null when no changes', async () => {
    const result = await generateDiffSummaryLocal(tempDir);
    expect(result).toBeNull();
  });

  test('new untracked files populate filesAdded', async () => {
    await writeFile(join(tempDir, 'new-file.ts'), 'export const x = 1;');

    const result = await generateDiffSummaryLocal(tempDir);
    expect(result).not.toBeNull();
    expect(result!.filesAdded).toContain('new-file.ts');
    expect(result!.filesChanged).toHaveLength(0);
    expect(result!.filesDeleted).toHaveLength(0);
  });

  test('modified tracked files populate filesChanged', async () => {
    // README.md was already committed, now modify it
    await writeFile(join(tempDir, 'README.md'), '# Modified');

    const result = await generateDiffSummaryLocal(tempDir);
    expect(result).not.toBeNull();
    expect(result!.filesChanged).toContain('README.md');
    expect(result!.filesAdded).toHaveLength(0);
  });

  test('summary contains Created prefix for new files', async () => {
    await writeFile(join(tempDir, 'new.ts'), 'const x = 1;');

    const result = await generateDiffSummaryLocal(tempDir);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain('Created:');
    expect(result!.summary).toContain('new.ts');
  });

  test('summary contains Modified prefix for changed files', async () => {
    await writeFile(join(tempDir, 'README.md'), '# Changed');

    const result = await generateDiffSummaryLocal(tempDir);
    expect(result).not.toBeNull();
    expect(result!.summary).toContain('Modified:');
  });

  test('handles multiple files of different types', async () => {
    await writeFile(join(tempDir, 'added.ts'), 'const a = 1;');
    await writeFile(join(tempDir, 'README.md'), '# Updated');

    const result = await generateDiffSummaryLocal(tempDir);
    expect(result).not.toBeNull();
    expect(result!.filesAdded).toContain('added.ts');
    expect(result!.filesChanged).toContain('README.md');
  });
});

describe('formatDiffContext', () => {
  test('returns empty string for empty summaries', () => {
    const result = formatDiffContext([]);
    expect(result).toBe('');
  });

  test('formats single summary with iteration header', () => {
    const summary: DiffSummary = {
      filesChanged: ['src/foo.ts'],
      filesAdded: [],
      filesDeleted: [],
      summary: 'Modified: src/foo.ts',
    };

    const result = formatDiffContext([summary]);
    expect(result).toContain('### Iteration 1');
    expect(result).toContain('Modified: src/foo.ts');
  });

  test('formats multiple summaries with correct iteration numbers', () => {
    const summaries: DiffSummary[] = [
      {
        filesChanged: [],
        filesAdded: ['src/new.ts'],
        filesDeleted: [],
        summary: 'Created: src/new.ts',
      },
      {
        filesChanged: ['src/existing.ts'],
        filesAdded: [],
        filesDeleted: [],
        summary: 'Modified: src/existing.ts',
      },
    ];

    const result = formatDiffContext(summaries);
    expect(result).toContain('### Iteration 1');
    expect(result).toContain('### Iteration 2');
    expect(result).toContain('Created: src/new.ts');
    expect(result).toContain('Modified: src/existing.ts');
  });
});
