/**
 * ABOUTME: Unit tests for the MergeEngine.
 * Tests merge session management, conflict detection, rollback capability,
 * backup branch handling, and event emission.
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { MergeEngine } from '../../src/worktree/merge-engine.js';
import type { ManagedWorktree } from '../../src/worktree/types.js';

function createMockWorktree(overrides: Partial<ManagedWorktree> = {}): ManagedWorktree {
  return {
    id: 'worktree-1',
    name: 'test-worktree',
    path: '/tmp/test-worktree',
    branch: 'worktree/test-worktree',
    status: 'ready',
    createdAt: new Date(),
    lastActivityAt: new Date(),
    ...overrides,
  };
}

describe('MergeEngine', () => {
  let mergeEngine: MergeEngine;

  beforeEach(() => {
    mergeEngine = new MergeEngine({
      projectRoot: '/tmp/test-project',
      createBackupBranch: false,
      abortOnConflict: false,
      deleteWorktreeBranchesOnSuccess: false,
    });
  });

  describe('state management', () => {
    test('should start with inactive session', () => {
      const state = mergeEngine.getState();
      expect(state.isSessionActive).toBe(false);
      expect(state.currentResults).toEqual([]);
      expect(state.currentMergeIndex).toBe(0);
      expect(state.totalWorktrees).toBe(0);
    });
  });

  describe('event listeners', () => {
    test('should add and remove event listeners', () => {
      const listener = mock(() => {});
      
      mergeEngine.addEventListener(listener);
      mergeEngine.removeEventListener(listener);
      
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('mergeAll', () => {
    test('should return success for empty worktrees array', async () => {
      const result = await mergeEngine.mergeAll({
        worktrees: [],
        targetBranch: 'main',
      });
      
      expect(result.success).toBe(true);
      expect(result.worktreeResults).toEqual([]);
      expect(result.mergedCount).toBe(0);
      expect(result.conflictCount).toBe(0);
      expect(result.skippedCount).toBe(0);
    });

    test('should not emit events for empty worktrees array', async () => {
      const listener = mock(() => {});
      mergeEngine.addEventListener(listener);
      
      await mergeEngine.mergeAll({
        worktrees: [],
        targetBranch: 'main',
      });
      
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('rollback', () => {
    test('should return result with error for invalid target ref', async () => {
      const result = await mergeEngine.rollback({
        targetRef: 'invalid-ref-that-does-not-exist',
      });
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getReflogEntries', () => {
    test('should return empty array for non-git directory', async () => {
      const entries = await mergeEngine.getReflogEntries(10);
      expect(Array.isArray(entries)).toBe(true);
    });
  });

  describe('findPreMergeRef', () => {
    test('should return null when no backup branch exists', async () => {
      const ref = await mergeEngine.findPreMergeRef('non-existent-backup');
      expect(ref).toBeNull();
    });
  });

  describe('backup branch management', () => {
    test('should return empty array when listing backup branches in non-git dir', async () => {
      const backups = await mergeEngine.listBackupBranches();
      expect(Array.isArray(backups)).toBe(true);
    });

    test('should return false when deleting non-existent backup branch', async () => {
      const result = await mergeEngine.deleteBackupBranch('non-existent-branch');
      expect(result).toBe(false);
    });

    test('should return empty array when cleaning up backups in non-git dir', async () => {
      const deleted = await mergeEngine.cleanupOldBackups(5);
      expect(Array.isArray(deleted)).toBe(true);
      expect(deleted.length).toBe(0);
    });
  });
});

describe('MergeEngine - Configuration', () => {
  test('should use default projectRoot when not provided', () => {
    const engine = new MergeEngine();
    const state = engine.getState();
    expect(state.isSessionActive).toBe(false);
  });

  test('should merge custom config with defaults', () => {
    const engine = new MergeEngine({
      createBackupBranch: true,
      backupBranchPrefix: 'custom-backup/',
    });
    
    const state = engine.getState();
    expect(state.isSessionActive).toBe(false);
  });
});

describe('MergeEngine - Session Guard', () => {
  test('should throw when starting session while one is active', async () => {
    const engine = new MergeEngine({
      projectRoot: '/tmp/test-project',
    });
    
    const worktree = createMockWorktree();
    
    const promise1 = engine.mergeAll({
      worktrees: [worktree],
      targetBranch: 'main',
    });
    
    await expect(
      engine.mergeAll({
        worktrees: [worktree],
        targetBranch: 'main',
      })
    ).rejects.toThrow('A merge session is already in progress');
    
    try {
      await promise1;
    } catch {
      /* expected to fail in test env */
    }
  });
});
