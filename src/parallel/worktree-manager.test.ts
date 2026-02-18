/**
 * ABOUTME: Tests for the git worktree pool manager.
 * Uses real temporary git repositories to test worktree creation, release,
 * cleanup, dirty checking, and configuration copying.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WorktreeManager } from './worktree-manager.js';

/** Create a temporary git repo for testing */
function createTempRepo(): string {
  const dir = path.join(
    '/tmp',
    `ralph-test-wt-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init');
  git(dir, 'config user.email "test@test.com"');
  git(dir, 'config user.name "Test"');
  // Create an initial commit (worktrees require at least one commit)
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

describe('WorktreeManager', () => {
  let repoDir: string;
  let manager: WorktreeManager;

  beforeEach(() => {
    repoDir = createTempRepo();
    manager = new WorktreeManager({
      cwd: repoDir,
      worktreeDir: '.ralph-tui/worktrees',
      maxWorktrees: 4,
    });
  });

  afterEach(() => {
    // Clean up worktrees before removing the repo directory
    try {
      const worktrees = git(repoDir, 'worktree list --porcelain');
      // Force remove any lingering worktrees
      for (const line of worktrees.split('\n')) {
        if (line.startsWith('worktree ')) {
          const wtPath = line.replace('worktree ', '').trim();
          // Compare normalized paths to determine if this is the main repo
          const normalizedWtPath = path.resolve(wtPath);
          const normalizedRepoDir = path.resolve(repoDir);
          if (normalizedWtPath !== normalizedRepoDir) {
            try {
              git(repoDir, `worktree remove --force "${wtPath}"`);
            } catch {
              // Best effort
            }
          }
        }
      }
    } catch {
      // Best effort
    }
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  type DiskCheckAccessor = {
    checkDiskSpace: () => Promise<void>;
    getAvailableDiskSpaceFromStatFs: () => Promise<number | null>;
    getAvailableDiskSpaceFromDf: () => number | null;
  };

  describe('disk space checks', () => {
    test('falls back to df when statfs reports zero but df reports sufficient space', async () => {
      const minFreeDiskSpace = 500 * 1024 * 1024;
      manager = new WorktreeManager({
        cwd: repoDir,
        worktreeDir: '.ralph-tui/worktrees',
        maxWorktrees: 4,
        minFreeDiskSpace,
      });

      const managerWithDiskCheck = manager as unknown as DiskCheckAccessor;
      const originalStatFs = managerWithDiskCheck.getAvailableDiskSpaceFromStatFs;
      const originalDf = managerWithDiskCheck.getAvailableDiskSpaceFromDf;

      managerWithDiskCheck.getAvailableDiskSpaceFromStatFs = async () => 0;
      managerWithDiskCheck.getAvailableDiskSpaceFromDf = () => minFreeDiskSpace + 1024 * 1024;

      try {
        await expect(managerWithDiskCheck.checkDiskSpace()).resolves.toBeUndefined();
      } finally {
        managerWithDiskCheck.getAvailableDiskSpaceFromStatFs = originalStatFs;
        managerWithDiskCheck.getAvailableDiskSpaceFromDf = originalDf;
      }
    });

    test('throws when both statfs and df report insufficient space', async () => {
      const minFreeDiskSpace = 500 * 1024 * 1024;
      manager = new WorktreeManager({
        cwd: repoDir,
        worktreeDir: '.ralph-tui/worktrees',
        maxWorktrees: 4,
        minFreeDiskSpace,
      });

      const managerWithDiskCheck = manager as unknown as DiskCheckAccessor;
      const originalStatFs = managerWithDiskCheck.getAvailableDiskSpaceFromStatFs;
      const originalDf = managerWithDiskCheck.getAvailableDiskSpaceFromDf;

      managerWithDiskCheck.getAvailableDiskSpaceFromStatFs = async () => 0;
      managerWithDiskCheck.getAvailableDiskSpaceFromDf = () => minFreeDiskSpace / 2;

      try {
        await expect(managerWithDiskCheck.checkDiskSpace()).rejects.toThrow(
          'Insufficient disk space for worktree'
        );
      } finally {
        managerWithDiskCheck.getAvailableDiskSpaceFromStatFs = originalStatFs;
        managerWithDiskCheck.getAvailableDiskSpaceFromDf = originalDf;
      }
    });
  });

  describe('acquire', () => {
    test('creates a worktree with a dedicated branch', async () => {
      const info = await manager.acquire('w1', 'task-001');

      expect(info.id).toBe('worker-w1');
      expect(info.branch).toBe('ralph-parallel/task-001');
      expect(info.workerId).toBe('w1');
      expect(info.taskId).toBe('task-001');
      expect(info.active).toBe(true);
      expect(info.dirty).toBe(false);
      expect(info.createdAt).toBeTruthy();

      // Verify the worktree directory exists
      expect(fs.existsSync(info.path)).toBe(true);

      // Verify it's a valid git worktree
      const worktreeList = git(repoDir, 'worktree list --porcelain');
      expect(worktreeList).toContain(info.path);
    });

    test('creates the worktree base directory', async () => {
      const worktreeBaseDir = path.join(repoDir, '.ralph-tui/worktrees');
      expect(fs.existsSync(worktreeBaseDir)).toBe(false);

      await manager.acquire('w1', 'task-001');

      expect(fs.existsSync(worktreeBaseDir)).toBe(true);
    });

    test('copies config.toml into the worktree', async () => {
      // Create a config file in the main repo
      const configDir = path.join(repoDir, '.ralph-tui');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'config.toml'),
        'agent = "claude"\n'
      );

      const info = await manager.acquire('w1', 'task-001');

      const worktreeConfig = path.join(info.path, '.ralph-tui', 'config.toml');
      expect(fs.existsSync(worktreeConfig)).toBe(true);
      expect(fs.readFileSync(worktreeConfig, 'utf-8')).toBe('agent = "claude"\n');
    });

    test('throws when maximum worktrees reached', async () => {
      const smallManager = new WorktreeManager({
        cwd: repoDir,
        maxWorktrees: 1,
      });

      await smallManager.acquire('w1', 'task-001');

      await expect(
        smallManager.acquire('w2', 'task-002')
      ).rejects.toThrow('Maximum worktrees reached');
    });

    test('creates multiple worktrees', async () => {
      const info1 = await manager.acquire('w1', 'task-001');
      const info2 = await manager.acquire('w2', 'task-002');

      expect(info1.path).not.toBe(info2.path);
      expect(info1.branch).not.toBe(info2.branch);
      expect(fs.existsSync(info1.path)).toBe(true);
      expect(fs.existsSync(info2.path)).toBe(true);
    });

    test('cleans up stale worktree at the same path', async () => {
      // First acquire
      const info1 = await manager.acquire('w1', 'task-001');
      const firstPath = info1.path;
      expect(fs.existsSync(firstPath)).toBe(true);

      // Release and cleanup to reset internal state
      await manager.cleanupAll();

      // Re-create manager and acquire at the same path
      const newManager = new WorktreeManager({
        cwd: repoDir,
        maxWorktrees: 4,
      });

      // This should succeed by cleaning up the stale worktree
      const info2 = await newManager.acquire('w1', 'task-001');
      expect(fs.existsSync(info2.path)).toBe(true);
    });
  });

  describe('release', () => {
    test('marks a worktree as inactive', async () => {
      const info = await manager.acquire('w1', 'task-001');
      expect(info.active).toBe(true);

      manager.release('worker-w1');

      const released = manager.getWorktree('worker-w1');
      expect(released?.active).toBe(false);
      expect(released?.workerId).toBeUndefined();
    });

    test('does nothing for unknown worktree ID', () => {
      // Should not throw
      manager.release('nonexistent');
    });

    test('allows acquiring a new worktree after release without cleanupAll', async () => {
      const smallManager = new WorktreeManager({
        cwd: repoDir,
        maxWorktrees: 1,
      });

      const first = await smallManager.acquire('w1', 'task-001');
      smallManager.release(first.id);

      await expect(
        smallManager.acquire('w2', 'task-002')
      ).resolves.toBeTruthy();
    });
  });

  describe('isDirty', () => {
    test('returns false for a clean worktree', async () => {
      await manager.acquire('w1', 'task-001');
      expect(manager.isDirty('worker-w1')).toBe(false);
    });

    test('returns true when worktree has uncommitted changes', async () => {
      const info = await manager.acquire('w1', 'task-001');

      // Create an uncommitted file in the worktree
      fs.writeFileSync(path.join(info.path, 'uncommitted.txt'), 'dirty\n');

      expect(manager.isDirty('worker-w1')).toBe(true);
    });

    test('returns false for unknown worktree ID', () => {
      expect(manager.isDirty('nonexistent')).toBe(false);
    });
  });

  describe('getWorktree / getAllWorktrees', () => {
    test('getWorktree returns the correct worktree info', async () => {
      await manager.acquire('w1', 'task-001');

      const info = manager.getWorktree('worker-w1');
      expect(info).toBeTruthy();
      expect(info!.taskId).toBe('task-001');
    });

    test('getWorktree returns undefined for unknown ID', () => {
      expect(manager.getWorktree('nonexistent')).toBeUndefined();
    });

    test('getAllWorktrees returns all managed worktrees', async () => {
      await manager.acquire('w1', 'task-001');
      await manager.acquire('w2', 'task-002');

      const all = manager.getAllWorktrees();
      expect(all).toHaveLength(2);
    });
  });

  describe('cleanupAll', () => {
    test('removes all worktrees and their branches', async () => {
      const info1 = await manager.acquire('w1', 'task-001');
      const info2 = await manager.acquire('w2', 'task-002');

      await manager.cleanupAll();

      // Worktree directories should be removed
      expect(fs.existsSync(info1.path)).toBe(false);
      expect(fs.existsSync(info2.path)).toBe(false);

      // Branches should be deleted
      const branches = git(repoDir, 'branch');
      expect(branches).not.toContain('ralph-parallel/task-001');
      expect(branches).not.toContain('ralph-parallel/task-002');

      // Internal state should be cleared
      expect(manager.getAllWorktrees()).toHaveLength(0);
    });

    test('removes empty worktree base directory', async () => {
      await manager.acquire('w1', 'task-001');
      const worktreeBaseDir = path.join(repoDir, '.ralph-tui/worktrees');
      expect(fs.existsSync(worktreeBaseDir)).toBe(true);

      await manager.cleanupAll();

      expect(fs.existsSync(worktreeBaseDir)).toBe(false);
    });

    test('succeeds when no worktrees exist', async () => {
      // Should not throw
      await manager.cleanupAll();
    });
  });

  describe('getCommitCount', () => {
    test('returns 0 for unknown worktree', () => {
      expect(manager.getCommitCount('nonexistent')).toBe(0);
    });
  });

  describe('defaults', () => {
    test('uses default worktree directory when not specified', () => {
      const defaultManager = new WorktreeManager({ cwd: repoDir });
      // Internal config is private, but we can test behavior by acquiring
      // (it would use ../.ralph-worktrees/<project-name> by default)
      expect(defaultManager).toBeTruthy();
    });
  });
});
