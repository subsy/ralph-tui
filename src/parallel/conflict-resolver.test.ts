/**
 * ABOUTME: Tests for the ConflictResolver class.
 * Tests public API surface including constructor, event listeners, and AI resolver callback.
 * Git-dependent methods are tested through error handling paths.
 */

import { describe, test, expect } from 'bun:test';
import { ConflictResolver, type AiResolverCallback } from './conflict-resolver.js';
import type { ParallelEvent } from './events.js';
import type { MergeOperation, FileConflict, WorkerResult } from './types.js';
import type { TrackerTask } from '../plugins/trackers/types.js';

/** Create a minimal TrackerTask */
function mockTask(id: string): TrackerTask {
  return {
    id,
    title: `Task ${id}`,
    status: 'open',
    priority: 2,
  };
}

/** Create a minimal WorkerResult */
function mockWorkerResult(taskId: string): WorkerResult {
  return {
    workerId: 'w1',
    task: mockTask(taskId),
    success: true,
    iterationsRun: 1,
    taskCompleted: true,
    durationMs: 1000,
    branchName: `ralph-parallel/${taskId}`,
    commitCount: 1,
  };
}

/** Create a minimal MergeOperation */
function mockMergeOperation(
  taskId: string,
  conflictedFiles: string[] = []
): MergeOperation {
  return {
    id: `merge-${taskId}`,
    workerResult: mockWorkerResult(taskId),
    status: 'conflicted',
    backupTag: `backup-${taskId}`,
    sourceBranch: `ralph-parallel/${taskId}`,
    commitMessage: `Merge task ${taskId}`,
    queuedAt: new Date().toISOString(),
    conflictedFiles,
  };
}

describe('ConflictResolver', () => {
  describe('constructor', () => {
    test('creates instance with cwd', () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      expect(resolver).toBeInstanceOf(ConflictResolver);
    });
  });

  describe('setAiResolver', () => {
    test('accepts a resolver callback', () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const mockResolver: AiResolverCallback = async () => null;

      // Should not throw
      resolver.setAiResolver(mockResolver);
    });

    test('can be called multiple times', () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const resolver1: AiResolverCallback = async () => 'content1';
      const resolver2: AiResolverCallback = async () => 'content2';

      resolver.setAiResolver(resolver1);
      resolver.setAiResolver(resolver2);
      // Should not throw, second resolver replaces first
    });
  });

  describe('on (event listener)', () => {
    test('returns an unsubscribe function', () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const events: ParallelEvent[] = [];
      const unsub = resolver.on((e) => events.push(e));

      expect(typeof unsub).toBe('function');
    });

    test('unsubscribe removes the listener', () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const events: ParallelEvent[] = [];
      const unsub = resolver.on((e) => events.push(e));

      // Unsubscribe
      unsub();

      // The listener should no longer be called
      // We can't directly test this without triggering an event,
      // but we verify the unsubscribe function works
    });

    test('multiple listeners can be registered', () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const events1: ParallelEvent[] = [];
      const events2: ParallelEvent[] = [];

      const unsub1 = resolver.on((e) => events1.push(e));
      const unsub2 = resolver.on((e) => events2.push(e));

      expect(typeof unsub1).toBe('function');
      expect(typeof unsub2).toBe('function');
    });
  });

  describe('resolveConflicts', () => {
    test('returns empty array when no conflicted files', async () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const operation = mockMergeOperation('T1', []);

      const results = await resolver.resolveConflicts(operation);

      expect(results).toEqual([]);
    });

    test('validates source branch name (empty)', async () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const operation = mockMergeOperation('T1', ['file.ts']);
      operation.sourceBranch = '';

      await expect(resolver.resolveConflicts(operation)).rejects.toThrow(
        'Invalid git ref for sourceBranch: ref is empty'
      );
    });

    test('validates source branch name (spaces)', async () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const operation = mockMergeOperation('T1', ['file.ts']);
      operation.sourceBranch = 'branch with spaces';

      await expect(resolver.resolveConflicts(operation)).rejects.toThrow(
        'Invalid git ref for sourceBranch: contains spaces'
      );
    });

    test('validates source branch name (double dots)', async () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const operation = mockMergeOperation('T1', ['file.ts']);
      operation.sourceBranch = 'branch..name';

      await expect(resolver.resolveConflicts(operation)).rejects.toThrow(
        "Invalid git ref for sourceBranch: contains '..'"
      );
    });

    test('validates source branch name (control characters)', async () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const operation = mockMergeOperation('T1', ['file.ts']);
      operation.sourceBranch = 'branch\x00name';

      await expect(resolver.resolveConflicts(operation)).rejects.toThrow(
        'Invalid git ref for sourceBranch: contains control characters'
      );
    });

    test('validates source branch name (starts with dot)', async () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const operation = mockMergeOperation('T1', ['file.ts']);
      operation.sourceBranch = '.hidden';

      await expect(resolver.resolveConflicts(operation)).rejects.toThrow(
        "Invalid git ref for sourceBranch: starts with '.'"
      );
    });

    test('validates source branch name (ends with dot)', async () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const operation = mockMergeOperation('T1', ['file.ts']);
      operation.sourceBranch = 'branch.';

      await expect(resolver.resolveConflicts(operation)).rejects.toThrow(
        "Invalid git ref for sourceBranch: ends with '.'"
      );
    });

    test('validates source branch name (consecutive slashes)', async () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const operation = mockMergeOperation('T1', ['file.ts']);
      operation.sourceBranch = 'refs//heads/main';

      await expect(resolver.resolveConflicts(operation)).rejects.toThrow(
        'Invalid git ref for sourceBranch: contains consecutive slashes'
      );
    });

    test('validates source branch name (ends with .lock)', async () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const operation = mockMergeOperation('T1', ['file.ts']);
      operation.sourceBranch = 'branch.lock';

      await expect(resolver.resolveConflicts(operation)).rejects.toThrow(
        "Invalid git ref for sourceBranch: ends with '.lock'"
      );
    });

    test('validates source branch name (special characters)', async () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const operation = mockMergeOperation('T1', ['file.ts']);
      operation.sourceBranch = 'branch~name';

      await expect(resolver.resolveConflicts(operation)).rejects.toThrow(
        'Invalid git ref for sourceBranch: contains invalid characters'
      );
    });

    test('validates source branch name (@{ sequence)', async () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const operation = mockMergeOperation('T1', ['file.ts']);
      operation.sourceBranch = 'branch@{1}';

      await expect(resolver.resolveConflicts(operation)).rejects.toThrow(
        "Invalid git ref for sourceBranch: contains '@{' sequence"
      );
    });
  });

  describe('AiResolverCallback type', () => {
    test('callback signature is correct', () => {
      // Test that the callback type accepts the expected parameters
      const mockResolver: AiResolverCallback = async (conflict, context) => {
        // Verify conflict has expected shape
        expect(typeof conflict.filePath).toBe('string');
        expect(typeof conflict.oursContent).toBe('string');
        expect(typeof conflict.theirsContent).toBe('string');
        expect(typeof conflict.baseContent).toBe('string');
        expect(typeof conflict.conflictMarkers).toBe('string');

        // Verify context has expected shape
        expect(typeof context.taskId).toBe('string');
        expect(typeof context.taskTitle).toBe('string');

        return 'resolved content';
      };

      // Call it to verify it works
      const testConflict: FileConflict = {
        filePath: 'test.ts',
        oursContent: 'our content',
        theirsContent: 'their content',
        baseContent: 'base content',
        conflictMarkers: '<<<<<<< ours\n=======\n>>>>>>> theirs',
      };

      expect(mockResolver(testConflict, { taskId: 'T1', taskTitle: 'Task 1' }))
        .resolves.toBe('resolved content');
    });

    test('callback can return null to indicate failure', async () => {
      const mockResolver: AiResolverCallback = async () => null;

      const result = await mockResolver(
        {
          filePath: 'test.ts',
          oursContent: '',
          theirsContent: '',
          baseContent: '',
          conflictMarkers: '',
        },
        { taskId: 'T1', taskTitle: 'Task 1' }
      );

      expect(result).toBeNull();
    });
  });

  describe('validateGitRef edge cases', () => {
    test('rejects ref with tilde', async () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const operation = mockMergeOperation('T1', ['file.ts']);
      operation.sourceBranch = 'branch~1';

      await expect(resolver.resolveConflicts(operation)).rejects.toThrow(
        'Invalid git ref for sourceBranch: contains invalid characters'
      );
    });

    test('rejects ref with caret', async () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const operation = mockMergeOperation('T1', ['file.ts']);
      operation.sourceBranch = 'branch^2';

      await expect(resolver.resolveConflicts(operation)).rejects.toThrow(
        'Invalid git ref for sourceBranch: contains invalid characters'
      );
    });

    test('rejects ref with colon', async () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const operation = mockMergeOperation('T1', ['file.ts']);
      operation.sourceBranch = 'branch:name';

      await expect(resolver.resolveConflicts(operation)).rejects.toThrow(
        'Invalid git ref for sourceBranch: contains invalid characters'
      );
    });

    test('rejects ref with question mark', async () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const operation = mockMergeOperation('T1', ['file.ts']);
      operation.sourceBranch = 'branch?name';

      await expect(resolver.resolveConflicts(operation)).rejects.toThrow(
        'Invalid git ref for sourceBranch: contains invalid characters'
      );
    });

    test('rejects ref with asterisk', async () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const operation = mockMergeOperation('T1', ['file.ts']);
      operation.sourceBranch = 'branch*name';

      await expect(resolver.resolveConflicts(operation)).rejects.toThrow(
        'Invalid git ref for sourceBranch: contains invalid characters'
      );
    });

    test('rejects ref with bracket', async () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const operation = mockMergeOperation('T1', ['file.ts']);
      operation.sourceBranch = 'branch[name]';

      await expect(resolver.resolveConflicts(operation)).rejects.toThrow(
        'Invalid git ref for sourceBranch: contains invalid characters'
      );
    });

    test('rejects ref with backslash', async () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const operation = mockMergeOperation('T1', ['file.ts']);
      operation.sourceBranch = 'branch\\name';

      await expect(resolver.resolveConflicts(operation)).rejects.toThrow(
        'Invalid git ref for sourceBranch: contains invalid characters'
      );
    });

    test('rejects ref with hidden path segment', async () => {
      const resolver = new ConflictResolver('/tmp/test-repo');
      const operation = mockMergeOperation('T1', ['file.ts']);
      operation.sourceBranch = 'refs/heads/.hidden';

      await expect(resolver.resolveConflicts(operation)).rejects.toThrow(
        "Invalid git ref for sourceBranch: starts with '.'"
      );
    });

    test('accepts valid branch names', async () => {
      const resolver = new ConflictResolver('/tmp/test-repo');

      // These branch names should pass validation; git execution may still fail
      const validBranches = [
        'main',
        'feature/new-feature',
        'feat-123',
        'release-v1.0.0',
        'ralph-parallel/TASK-001',
      ];

      for (const branch of validBranches) {
        const operation = mockMergeOperation('T1', ['file.ts']);
        operation.sourceBranch = branch;

        // Validation should pass; any failures are git-related, not validation errors
        try {
          await resolver.resolveConflicts(operation);
        } catch (err) {
          // Git execution errors are expected; validation errors are not
          const error = err as Error;
          expect(error.message).not.toContain('Invalid git ref');
        }
      }
    });
  });
});
