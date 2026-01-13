/**
 * ABOUTME: Unit tests for the WorktreePoolManager.
 * Tests worktree lifecycle management, resource-aware spawning,
 * pool limits, and event emission.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { WorktreePoolManager } from '../../src/worktree/manager.js';
import { DEFAULT_WORKTREE_POOL_CONFIG } from '../../src/worktree/types.js';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('WorktreePoolManager', () => {
  let tempDir: string;
  let manager: WorktreePoolManager;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `ralph-tui-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    
    manager = new WorktreePoolManager(tempDir, {
      maxWorktrees: 4,
      worktreeDir: '.worktrees',
      minFreeMemoryMB: 100,
      maxCpuUtilization: 95,
    });
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      /* cleanup errors ignored */
    }
  });

  describe('initialization', () => {
    test('should create worktrees directory on initialize', async () => {
      await manager.initialize();
      const { stat } = await import('node:fs/promises');
      const worktreesPath = join(tempDir, '.worktrees');
      const stats = await stat(worktreesPath);
      expect(stats.isDirectory()).toBe(true);
    });

    test('should start with zero active worktrees', () => {
      expect(manager.activeWorktreeCount).toBe(0);
    });

    test('should respect maxWorktrees configuration', () => {
      expect(manager.maxWorktrees).toBe(4);
    });
  });

  describe('getWorktrees', () => {
    test('should return empty array when no worktrees exist', () => {
      const worktrees = manager.getWorktrees();
      expect(worktrees).toEqual([]);
    });
  });

  describe('event listeners', () => {
    test('should add and remove event listeners', () => {
      const listener = mock(() => {});
      
      manager.addEventListener(listener);
      manager.removeEventListener(listener);
      
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('pool exhaustion', () => {
    test('should reject acquisition when pool is exhausted', async () => {
      const exhaustedManager = new WorktreePoolManager(tempDir, {
        maxWorktrees: 0,
        worktreeDir: '.worktrees',
      });
      
      await exhaustedManager.initialize();
      
      const result = await exhaustedManager.acquire({
        baseName: 'test',
        taskId: 'task-1',
      });
      
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('pool_exhausted');
      }
    });
  });

  describe('worktree status management', () => {
    test('should update worktree status without throwing for non-existent', async () => {
      const worktreeId = 'test-worktree-id';
      expect(() => manager.updateStatus(worktreeId, 'in_use')).not.toThrow();
    });

    test('should mark worktree in use without throwing for non-existent', async () => {
      const worktreeId = 'test-worktree-id';
      await expect(manager.markInUse(worktreeId, 'task-1', 'agent-1')).resolves.toBeUndefined();
    });
  });

  describe('getWorktree', () => {
    test('should return undefined for non-existent worktree', () => {
      const worktree = manager.getWorktree('non-existent-id');
      expect(worktree).toBeUndefined();
    });
  });

  describe('release', () => {
    test('should not throw when releasing non-existent worktree', async () => {
      await expect(manager.release('non-existent-id')).resolves.toBeUndefined();
    });
  });

  describe('cleanup', () => {
    test('should return false when cleaning non-existent worktree', async () => {
      const result = await manager.cleanup('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('cleanupOnMergeSuccess', () => {
    test('should return false when cleanup is disabled', async () => {
      const noCleanupManager = new WorktreePoolManager(tempDir, {
        maxWorktrees: 4,
        worktreeDir: '.worktrees',
        cleanupOnSuccess: false,
      });
      
      const result = await noCleanupManager.cleanupOnMergeSuccess('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('cleanupAll', () => {
    test('should return 0 when no worktrees exist', async () => {
      const cleaned = await manager.cleanupAll();
      expect(cleaned).toBe(0);
    });
  });

  describe('pruneOrphaned', () => {
    test('should return 0 when worktrees directory is empty', async () => {
      await manager.initialize();
      const pruned = await manager.pruneOrphaned();
      expect(pruned).toBe(0);
    });
  });
});

describe('WorktreePoolManager - Configuration', () => {
  test('should use default config when not provided', () => {
    const tempDir = join(tmpdir(), 'ralph-test-default');
    const manager = new WorktreePoolManager(tempDir);
    
    expect(manager.maxWorktrees).toBe(DEFAULT_WORKTREE_POOL_CONFIG.maxWorktrees);
  });

  test('should merge custom config with defaults', () => {
    const tempDir = join(tmpdir(), 'ralph-test-custom');
    const manager = new WorktreePoolManager(tempDir, {
      maxWorktrees: 8,
    });
    
    expect(manager.maxWorktrees).toBe(8);
  });
});
