/**
 * ABOUTME: Worktree Pool Manager for git worktree lifecycle management.
 * Manages a pool of git worktrees with resource-aware spawning to prevent
 * system resource exhaustion during parallel agent execution.
 */

import { spawn } from 'node:child_process';
import { mkdir, rm, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  type WorktreePoolConfig,
  type ManagedWorktree,
  type WorktreeStatus,
  type WorktreeAcquisitionResult,
  type WorktreePoolEvent,
  type WorktreePoolEventListener,
  type WorktreeCreateOptions,
  type WorktreeCleanupOptions,
  DEFAULT_WORKTREE_POOL_CONFIG,
} from './types.js';
import { checkResourceAvailability } from './resources.js';

function execGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error(`Git command failed (exit ${code}): ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}



export class WorktreePoolManager {
  private readonly config: WorktreePoolConfig;
  private readonly projectRoot: string;
  private readonly worktreesPath: string;
  private readonly worktrees: Map<string, ManagedWorktree> = new Map();
  private readonly listeners: Set<WorktreePoolEventListener> = new Set();
  private pendingAcquisitions = 0;
  private mergeLock: Promise<void> = Promise.resolve();

  constructor(projectRoot: string, config: Partial<WorktreePoolConfig> = {}) {
    this.config = { ...DEFAULT_WORKTREE_POOL_CONFIG, ...config };
    this.projectRoot = resolve(projectRoot);
    this.worktreesPath = join(this.projectRoot, this.config.worktreeDir);
  }

  get activeWorktreeCount(): number {
    return Array.from(this.worktrees.values()).filter(
      (w) => w.status !== 'error' && w.status !== 'cleaning'
    ).length;
  }

  get maxWorktrees(): number {
    return this.config.maxWorktrees;
  }

  getWorktrees(): ManagedWorktree[] {
    return Array.from(this.worktrees.values());
  }

  getWorktree(id: string): ManagedWorktree | undefined {
    return this.worktrees.get(id);
  }

  addEventListener(listener: WorktreePoolEventListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(listener: WorktreePoolEventListener): void {
    this.listeners.delete(listener);
  }

  private emit(event: WorktreePoolEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
      }
    }
  }

  async initialize(): Promise<void> {
    await mkdir(this.worktreesPath, { recursive: true });
    await this.syncWithGit();
  }

  private async syncWithGit(): Promise<void> {
    try {
      const { stdout } = await execGit(['worktree', 'list', '--porcelain'], this.projectRoot);

      const lines = stdout.split('\n');
      let currentPath: string | null = null;
      let currentBranch: string | null = null;

      for (const line of lines) {
        if (line.startsWith('worktree ')) {
          currentPath = line.substring(9);
        } else if (line.startsWith('branch ')) {
          currentBranch = line.substring(7).replace('refs/heads/', '');
        } else if (line === '' && currentPath && currentBranch) {
          if (currentPath.startsWith(this.worktreesPath)) {
            const name = currentPath.substring(this.worktreesPath.length + 1);
            const existingWorktree = Array.from(this.worktrees.values()).find(
              (w) => w.path === currentPath
            );

            if (!existingWorktree) {
              const worktree: ManagedWorktree = {
                id: randomUUID(),
                name,
                path: currentPath,
                branch: currentBranch,
                status: 'ready',
                createdAt: new Date(),
                lastActivityAt: new Date(),
              };
              this.worktrees.set(worktree.id, worktree);
            }
          }

          currentPath = null;
          currentBranch = null;
        }
      }
    } catch (error) {
      // Git worktree list failed - emit error event but continue with current state
      this.emit({
        type: 'worktree_error',
        worktree: undefined as unknown as ManagedWorktree,
        error: error instanceof Error ? error : new Error('Failed to sync with git'),
      });
    }
  }

  async acquire(options: WorktreeCreateOptions): Promise<WorktreeAcquisitionResult> {
    if (this.activeWorktreeCount + this.pendingAcquisitions >= this.config.maxWorktrees) {
      this.emit({
        type: 'pool_exhausted',
        activeCount: this.activeWorktreeCount,
        maxWorktrees: this.config.maxWorktrees,
      });
      return { success: false, reason: 'pool_exhausted' };
    }

    this.pendingAcquisitions++;
    try {
      const resourceCheck = await checkResourceAvailability(
        this.config.minFreeMemoryMB,
        this.config.maxCpuUtilization
      );

      if (!resourceCheck.canProceed) {
        this.emit({
          type: 'resource_warning',
          resources: resourceCheck.resources,
          threshold:
            resourceCheck.reason === 'insufficient_memory'
              ? `minFreeMemoryMB: ${this.config.minFreeMemoryMB}`
              : `maxCpuUtilization: ${this.config.maxCpuUtilization}%`,
        });
        return { success: false, reason: resourceCheck.reason! };
      }

      const worktree = await this.createWorktree(options);
      return { success: true, worktree };
    } catch (error) {
      const isGitError =
        error instanceof Error && error.message.toLowerCase().includes('git');
      return { success: false, reason: isGitError ? 'git_error' : 'filesystem_error' };
    } finally {
      this.pendingAcquisitions--;
    }
  }

  private async createWorktree(options: WorktreeCreateOptions): Promise<ManagedWorktree> {
    const suffix = options.agentId || randomUUID().substring(0, 8);
    const name = `${options.baseName}-${suffix}`;
    const worktreePath = join(this.worktreesPath, name);
    const branch = options.branch || `worktree/${name}`;

    const worktree: ManagedWorktree = {
      id: randomUUID(),
      name,
      path: worktreePath,
      branch,
      status: 'creating',
      createdAt: new Date(),
      lastActivityAt: new Date(),
      taskId: options.taskId,
      agentId: options.agentId,
    };

    this.worktrees.set(worktree.id, worktree);

    try {
      const baseBranch = options.baseBranch || 'HEAD';
      await execGit(['worktree', 'add', '-b', branch, worktreePath, baseBranch], this.projectRoot);

      worktree.status = 'ready';
      worktree.lastActivityAt = new Date();

      this.emit({ type: 'worktree_created', worktree });
      return worktree;
    } catch (error) {
      worktree.status = 'error';
      this.emit({
        type: 'worktree_error',
        worktree,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  async release(worktreeId: string): Promise<void> {
    const worktree = this.worktrees.get(worktreeId);
    if (!worktree) {
      return;
    }

    worktree.status = 'ready';
    worktree.lastActivityAt = new Date();
    worktree.taskId = undefined;
    worktree.agentId = undefined;

    this.emit({ type: 'worktree_released', worktree });
  }

  async cleanup(worktreeId: string, options: WorktreeCleanupOptions = {}): Promise<boolean> {
    const worktree = this.worktrees.get(worktreeId);
    if (!worktree) {
      return false;
    }

    worktree.status = 'cleaning';
    worktree.lastActivityAt = new Date();

    try {
      if (options.mergeBefore) {
        await this.mergeLock;
        let releaseLock: () => void = () => {};
        this.mergeLock = new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
        try {
          const mergeTarget = options.mergeTarget || (await this.getDefaultBranch());
          worktree.status = 'merging';
          await execGit(['checkout', mergeTarget], this.projectRoot);
          await execGit(['merge', worktree.branch, '--no-edit'], this.projectRoot);
        } finally {
          releaseLock();
        }
      }

      await execGit(['worktree', 'remove', worktree.path, options.force ? '--force' : ''].filter(Boolean), this.projectRoot);

      if (options.deleteBranch) {
        try {
          await execGit(['branch', '-D', worktree.branch], this.projectRoot);
        } catch {
        }
      }

      this.worktrees.delete(worktreeId);
      this.emit({ type: 'worktree_cleaned', worktree });
      return true;
    } catch (error) {
      worktree.status = 'error';
      this.emit({
        type: 'worktree_error',
        worktree,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return false;
    }
  }

  async cleanupOnMergeSuccess(worktreeId: string): Promise<boolean> {
    if (!this.config.cleanupOnSuccess) {
      return false;
    }

    return this.cleanup(worktreeId, {
      mergeBefore: false,
      deleteBranch: true,
      force: false,
    });
  }

  async cleanupAll(options: WorktreeCleanupOptions = {}): Promise<number> {
    let cleaned = 0;
    const worktreeIds = Array.from(this.worktrees.keys());

    for (const id of worktreeIds) {
      const success = await this.cleanup(id, { ...options, force: true });
      if (success) {
        cleaned++;
      }
    }

    return cleaned;
  }

  private async getDefaultBranch(): Promise<string> {
    try {
      const { stdout } = await execGit(
        ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'],
        this.projectRoot
      );
      return stdout.replace('origin/', '');
    } catch {
      const exists = await this.branchExists('main');
      return exists ? 'main' : 'master';
    }
  }

  private async branchExists(branch: string): Promise<boolean> {
    try {
      await execGit(['rev-parse', '--verify', branch], this.projectRoot);
      return true;
    } catch {
      return false;
    }
  }

  async pruneOrphaned(): Promise<number> {
    let pruned = 0;

    try {
      const entries = await readdir(this.worktreesPath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const worktreePath = join(this.worktreesPath, entry.name);
        const inPool = Array.from(this.worktrees.values()).some((w) => w.path === worktreePath);

        if (!inPool) {
          try {
            await execGit(['worktree', 'remove', worktreePath, '--force'], this.projectRoot);
            pruned++;
          } catch {
            try {
              await rm(worktreePath, { recursive: true, force: true });
              pruned++;
            } catch {
            }
          }
        }
      }
    } catch {
    }

    return pruned;
  }

  async markInUse(worktreeId: string, taskId?: string, agentId?: string): Promise<void> {
    const worktree = this.worktrees.get(worktreeId);
    if (!worktree) {
      return;
    }

    worktree.status = 'in_use';
    worktree.lastActivityAt = new Date();
    if (taskId) worktree.taskId = taskId;
    if (agentId) worktree.agentId = agentId;

    this.emit({ type: 'worktree_acquired', worktree, taskId });
  }

  updateStatus(worktreeId: string, status: WorktreeStatus): void {
    const worktree = this.worktrees.get(worktreeId);
    if (worktree) {
      worktree.status = status;
      worktree.lastActivityAt = new Date();
    }
  }
}
