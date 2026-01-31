/**
 * ABOUTME: Tests for the sequential merge queue.
 * Uses real temporary git repositories to test merge operations including
 * fast-forward, merge commits, conflict detection, backup/rollback, and event emission.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MergeEngine } from './merge-engine.js';
import type { WorkerResult } from './types.js';
import type { TrackerTask } from '../plugins/trackers/types.js';
import type { ParallelEvent } from './events.js';

/** Create a temporary git repo for testing */
function createTempRepo(): string {
  const dir = path.join(
    '/tmp',
    `ralph-test-merge-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init');
  git(dir, 'config user.email "test@test.com"');
  git(dir, 'config user.name "Test"');
  // Create an initial commit
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test Repo\n');
  git(dir, 'add .');
  git(dir, 'commit -m "Initial commit"');
  return dir;
}

/** Execute a git command in a directory */
function git(cwd: string, args: string): string {
  return execSync(`git -C "${cwd}" ${args}`, {
    encoding: 'utf-8',
    timeout: 10000,
  });
}

/** Create a mock TrackerTask */
function mockTask(id: string): TrackerTask {
  return {
    id,
    title: `Task ${id}`,
    status: 'open',
    priority: 2,
  };
}

/** Create a mock WorkerResult */
function mockWorkerResult(
  task: TrackerTask,
  branchName: string,
  opts: Partial<WorkerResult> = {}
): WorkerResult {
  return {
    workerId: `w-${task.id}`,
    task,
    success: true,
    iterationsRun: 1,
    taskCompleted: true,
    durationMs: 1000,
    branchName,
    commitCount: 1,
    ...opts,
  };
}

/** Create a branch with a commit that modifies a new file */
function createBranchWithCommit(
  repoDir: string,
  branchName: string,
  fileName: string,
  content: string
): void {
  git(repoDir, `checkout -b "${branchName}"`);
  fs.writeFileSync(path.join(repoDir, fileName), content);
  git(repoDir, `add "${fileName}"`);
  git(repoDir, `commit -m "Add ${fileName}"`);
  // Switch back to main
  git(repoDir, 'checkout -');
}

describe('MergeEngine', () => {
  let repoDir: string;
  let engine: MergeEngine;

  beforeEach(() => {
    repoDir = createTempRepo();
    engine = new MergeEngine(repoDir);
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  describe('enqueue', () => {
    test('adds a merge operation to the queue', () => {
      const task = mockTask('T1');
      const result = mockWorkerResult(task, 'ralph-parallel/T1');
      const operation = engine.enqueue(result);

      expect(operation.status).toBe('queued');
      expect(operation.sourceBranch).toBe('ralph-parallel/T1');
      expect(operation.commitMessage).toContain('T1');
      expect(operation.commitMessage).toContain('Task T1');
      expect(operation.queuedAt).toBeTruthy();
      expect(engine.getPendingCount()).toBe(1);
    });

    test('emits a merge:queued event', () => {
      const events: ParallelEvent[] = [];
      engine.on((e) => events.push(e));

      const task = mockTask('T1');
      engine.enqueue(mockWorkerResult(task, 'ralph-parallel/T1'));

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('merge:queued');
    });
  });

  describe('processNext', () => {
    test('returns null when queue is empty', async () => {
      const result = await engine.processNext();
      expect(result).toBeNull();
    });

    test('fast-forward merges a clean branch', async () => {
      const branchName = 'ralph-parallel/T1';
      createBranchWithCommit(repoDir, branchName, 'feature.ts', 'export const x = 1;\n');

      const task = mockTask('T1');
      engine.enqueue(mockWorkerResult(task, branchName));

      const result = await engine.processNext();

      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.strategy).toBe('fast-forward');
      expect(result!.hadConflicts).toBe(false);
      expect(result!.filesChanged).toBeGreaterThan(0);

      // Verify the file is now on the main branch
      expect(fs.existsSync(path.join(repoDir, 'feature.ts'))).toBe(true);
    });

    test('uses merge commit when fast-forward is not possible', async () => {
      // Create a branch
      const branchName = 'ralph-parallel/T2';
      createBranchWithCommit(repoDir, branchName, 'branch-file.ts', 'branch content\n');

      // Add a commit on main to diverge history
      fs.writeFileSync(path.join(repoDir, 'main-file.ts'), 'main content\n');
      git(repoDir, 'add main-file.ts');
      git(repoDir, 'commit -m "Main commit"');

      const task = mockTask('T2');
      engine.enqueue(mockWorkerResult(task, branchName));

      const result = await engine.processNext();

      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);
      expect(result!.strategy).toBe('merge-commit');
      expect(result!.commitSha).toBeTruthy();
    });

    test('detects and handles conflicts', async () => {
      // Create a branch that modifies the same file
      const branchName = 'ralph-parallel/T3';
      git(repoDir, `checkout -b "${branchName}"`);
      fs.writeFileSync(path.join(repoDir, 'README.md'), 'Branch version\n');
      git(repoDir, 'add README.md');
      git(repoDir, 'commit -m "Branch change"');
      git(repoDir, 'checkout -');

      // Make a conflicting change on main
      fs.writeFileSync(path.join(repoDir, 'README.md'), 'Main version\n');
      git(repoDir, 'add README.md');
      git(repoDir, 'commit -m "Main change"');

      const task = mockTask('T3');
      engine.enqueue(mockWorkerResult(task, branchName));

      const result = await engine.processNext();

      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.hadConflicts).toBe(true);
      expect(result!.error).toContain('README.md');
    });

    test('fails gracefully for a branch with no commits ahead', async () => {
      // Create a branch at the same point as main (no new commits)
      git(repoDir, 'branch "ralph-parallel/T4"');

      const task = mockTask('T4');
      engine.enqueue(mockWorkerResult(task, 'ralph-parallel/T4'));

      const result = await engine.processNext();

      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.error).toContain('No commits to merge');
    });

    test('emits merge lifecycle events (started, completed)', async () => {
      const events: ParallelEvent[] = [];
      engine.on((e) => events.push(e));

      const branchName = 'ralph-parallel/T5';
      createBranchWithCommit(repoDir, branchName, 'event-file.ts', 'content\n');

      const task = mockTask('T5');
      engine.enqueue(mockWorkerResult(task, branchName));
      await engine.processNext();

      const types = events.map((e) => e.type);
      expect(types).toContain('merge:queued');
      expect(types).toContain('merge:started');
      expect(types).toContain('merge:completed');
    });

    test('emits merge:failed event on conflict', async () => {
      const events: ParallelEvent[] = [];
      engine.on((e) => events.push(e));

      // Create conflicting branch
      const branchName = 'ralph-parallel/T6';
      git(repoDir, `checkout -b "${branchName}"`);
      fs.writeFileSync(path.join(repoDir, 'README.md'), 'Branch\n');
      git(repoDir, 'add README.md');
      git(repoDir, 'commit -m "Branch"');
      git(repoDir, 'checkout -');

      fs.writeFileSync(path.join(repoDir, 'README.md'), 'Main\n');
      git(repoDir, 'add README.md');
      git(repoDir, 'commit -m "Main"');

      const task = mockTask('T6');
      engine.enqueue(mockWorkerResult(task, branchName));
      await engine.processNext();

      const types = events.map((e) => e.type);
      expect(types).toContain('conflict:detected');
      expect(types).toContain('merge:failed');
    });
  });

  describe('processAll', () => {
    test('processes multiple queued merges sequentially', async () => {
      // Create two non-conflicting branches
      createBranchWithCommit(repoDir, 'ralph-parallel/A', 'file-a.ts', 'a\n');
      createBranchWithCommit(repoDir, 'ralph-parallel/B', 'file-b.ts', 'b\n');

      engine.enqueue(mockWorkerResult(mockTask('A'), 'ralph-parallel/A'));
      engine.enqueue(mockWorkerResult(mockTask('B'), 'ralph-parallel/B'));

      const results = await engine.processAll();

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);

      // Both files should exist on main now
      expect(fs.existsSync(path.join(repoDir, 'file-a.ts'))).toBe(true);
      expect(fs.existsSync(path.join(repoDir, 'file-b.ts'))).toBe(true);
    });
  });

  describe('session backup', () => {
    test('creates a session backup tag', () => {
      const tag = engine.createSessionBackup('session-123');

      expect(tag).toBe('ralph/session-start/session-123');
      expect(engine.getSessionStartTag()).toBe(tag);

      // Verify tag exists in git
      const tags = git(repoDir, 'tag');
      expect(tags).toContain('ralph/session-start/session-123');
    });
  });

  describe('rollbackMerge', () => {
    test('rolls back a specific merge to its backup tag', async () => {
      const branchName = 'ralph-parallel/RB1';
      createBranchWithCommit(repoDir, branchName, 'rollback-file.ts', 'content\n');

      const task = mockTask('RB1');
      engine.enqueue(mockWorkerResult(task, branchName));

      const result = await engine.processNext();
      expect(result!.success).toBe(true);
      expect(fs.existsSync(path.join(repoDir, 'rollback-file.ts'))).toBe(true);

      // Rollback
      const operation = engine.getQueue()[0];
      engine.rollbackMerge(operation.id);

      // File should no longer exist
      expect(fs.existsSync(path.join(repoDir, 'rollback-file.ts'))).toBe(false);
    });

    test('throws for unknown operation ID', () => {
      expect(() => engine.rollbackMerge('nonexistent')).toThrow(
        'not found'
      );
    });
  });

  describe('rollbackSession', () => {
    test('rolls back all merges to session start point', async () => {
      engine.createSessionBackup('session-rollback');

      createBranchWithCommit(repoDir, 'ralph-parallel/S1', 'file-s1.ts', 's1\n');
      createBranchWithCommit(repoDir, 'ralph-parallel/S2', 'file-s2.ts', 's2\n');

      engine.enqueue(mockWorkerResult(mockTask('S1'), 'ralph-parallel/S1'));
      engine.enqueue(mockWorkerResult(mockTask('S2'), 'ralph-parallel/S2'));

      await engine.processAll();
      expect(fs.existsSync(path.join(repoDir, 'file-s1.ts'))).toBe(true);
      expect(fs.existsSync(path.join(repoDir, 'file-s2.ts'))).toBe(true);

      // Rollback entire session
      engine.rollbackSession();

      // Both files should be gone
      expect(fs.existsSync(path.join(repoDir, 'file-s1.ts'))).toBe(false);
      expect(fs.existsSync(path.join(repoDir, 'file-s2.ts'))).toBe(false);
    });

    test('throws when no session start tag exists', () => {
      expect(() => engine.rollbackSession()).toThrow(
        'No session start tag'
      );
    });
  });

  describe('cleanupTags', () => {
    test('removes backup tags and session start tag', async () => {
      engine.createSessionBackup('cleanup-test');

      const branchName = 'ralph-parallel/CL1';
      createBranchWithCommit(repoDir, branchName, 'cleanup.ts', 'c\n');
      engine.enqueue(mockWorkerResult(mockTask('CL1'), branchName));
      await engine.processNext();

      // Tags should exist
      let tags = git(repoDir, 'tag');
      expect(tags).toContain('ralph/session-start/cleanup-test');
      expect(tags).toContain('ralph/pre-merge/CL1/');

      // Clean up
      engine.cleanupTags();

      tags = git(repoDir, 'tag');
      expect(tags).not.toContain('ralph/session-start/cleanup-test');
      expect(tags).not.toContain('ralph/pre-merge/CL1');
    });
  });

  describe('event listener', () => {
    test('on() returns an unsubscribe function', () => {
      const events: ParallelEvent[] = [];
      const unsub = engine.on((e) => events.push(e));

      engine.enqueue(mockWorkerResult(mockTask('unsub'), 'branch'));
      expect(events).toHaveLength(1);

      unsub();

      engine.enqueue(mockWorkerResult(mockTask('unsub2'), 'branch2'));
      // Should still be 1 since listener was removed
      expect(events).toHaveLength(1);
    });
  });
});
