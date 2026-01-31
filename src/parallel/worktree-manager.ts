/**
 * ABOUTME: Git worktree pool manager for parallel execution.
 * Creates, tracks, and cleans up git worktrees used by parallel workers.
 * Each worker gets an isolated worktree with its own branch to make changes
 * independently without filesystem conflicts.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorktreeInfo, WorktreeManagerConfig } from './types.js';

/**
 * Sanitize a task ID into a valid git branch name.
 * Removes/replaces invalid characters and ensures the result is safe for git.
 */
function sanitizeBranchName(taskId: string): string {
  let sanitized = taskId;

  // Replace spaces and invalid characters with dashes
  sanitized = sanitized.replace(/[\s~^:?*\[\\@{]/g, '-');

  // Remove control characters
  sanitized = sanitized.replace(/\p{Cc}/gu, '');

  // Collapse multiple slashes and dashes
  sanitized = sanitized.replace(/\/+/g, '/').replace(/-+/g, '-');

  // Remove consecutive dots
  sanitized = sanitized.replace(/\.{2,}/g, '.');

  // Strip leading/trailing slashes, dots, and dashes
  sanitized = sanitized.replace(/^[./-]+|[./-]+$/g, '');

  // Don't end with .lock
  if (sanitized.endsWith('.lock')) {
    sanitized = sanitized.slice(0, -5);
  }

  // If sanitization resulted in empty string, use a hash of the original
  if (!sanitized) {
    // Simple deterministic fallback: use first 8 chars of base64 encoded task ID
    sanitized = Buffer.from(taskId).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'task';
  }

  return sanitized;
}

/** Default minimum free disk space (500 MB) before creating a worktree */
const DEFAULT_MIN_FREE_DISK_SPACE = 500 * 1024 * 1024;

/** Default worktree directory relative to project root */
const DEFAULT_WORKTREE_DIR = '.ralph-tui/worktrees';

/**
 * Manages a pool of git worktrees for parallel task execution.
 *
 * Lifecycle:
 * 1. `acquire()` — Creates a worktree + branch for a worker
 * 2. Worker uses the worktree for execution (separate from this class)
 * 3. `release()` — Marks worktree as inactive
 * 4. `cleanupAll()` — Removes all worktrees + branches at session end
 */
export class WorktreeManager {
  private readonly config: WorktreeManagerConfig;
  private readonly worktrees = new Map<string, WorktreeInfo>();

  constructor(config: Partial<WorktreeManagerConfig> & { cwd: string }) {
    this.config = {
      worktreeDir: config.worktreeDir ?? DEFAULT_WORKTREE_DIR,
      cwd: config.cwd,
      maxWorktrees: config.maxWorktrees ?? 8,
      minFreeDiskSpace: config.minFreeDiskSpace ?? DEFAULT_MIN_FREE_DISK_SPACE,
    };
  }

  /**
   * Acquire a worktree for a worker.
   * Creates a new git worktree with a dedicated branch from current HEAD.
   *
   * @param workerId - Identifier for the worker using this worktree
   * @param taskId - Task that will be executed in this worktree
   * @returns Information about the created worktree
   * @throws If worktree creation fails or disk space is insufficient
   */
  async acquire(workerId: string, taskId: string): Promise<WorktreeInfo> {
    if (this.worktrees.size >= this.config.maxWorktrees) {
      throw new Error(
        `Maximum worktrees reached (${this.config.maxWorktrees}). ` +
          'Release existing worktrees before acquiring new ones.'
      );
    }

    await this.checkDiskSpace();

    const worktreeId = `worker-${workerId}`;
    // Sanitize task ID to create a valid git branch name
    const sanitizedTaskId = sanitizeBranchName(taskId);
    const branchName = `ralph-parallel/${sanitizedTaskId}`;
    const worktreePath = path.resolve(
      this.config.cwd,
      this.config.worktreeDir,
      worktreeId
    );

    // Ensure parent directory exists
    await this.ensureWorktreeDir();

    // Clean up any stale worktree at this path
    await this.cleanupStaleWorktree(worktreePath, branchName);

    // Create the worktree with a new branch from HEAD
    this.git(['worktree', 'add', '-b', branchName, worktreePath, 'HEAD']);

    // Copy ralph-tui config into the worktree so the agent has project context
    await this.copyConfig(worktreePath);

    const info: WorktreeInfo = {
      id: worktreeId,
      path: worktreePath,
      branch: branchName,
      workerId,
      taskId,
      active: true,
      dirty: false,
      createdAt: new Date().toISOString(),
    };

    this.worktrees.set(worktreeId, info);
    return info;
  }

  /**
   * Release a worktree (mark as inactive).
   * The worktree remains on disk until cleanup.
   */
  release(worktreeId: string): void {
    const info = this.worktrees.get(worktreeId);
    if (info) {
      info.active = false;
      info.workerId = undefined;
    }
  }

  /**
   * Check if a worktree has uncommitted changes.
   */
  isDirty(worktreeId: string): boolean {
    const info = this.worktrees.get(worktreeId);
    if (!info) return false;

    try {
      const status = this.gitInWorktree(info.path, ['status', '--porcelain']);
      const dirty = status.trim().length > 0;
      info.dirty = dirty;
      return dirty;
    } catch {
      return false;
    }
  }

  /**
   * Get information about a specific worktree.
   */
  getWorktree(worktreeId: string): WorktreeInfo | undefined {
    return this.worktrees.get(worktreeId);
  }

  /**
   * Get all managed worktrees.
   */
  getAllWorktrees(): WorktreeInfo[] {
    return [...this.worktrees.values()];
  }

  /**
   * Get the number of commits ahead of the base branch in a worktree.
   */
  getCommitCount(worktreeId: string): number {
    const info = this.worktrees.get(worktreeId);
    if (!info) return 0;

    try {
      // Count commits on the branch that aren't on the main HEAD
      const log = this.git(['log', '--oneline', info.branch, '--not', 'HEAD']);
      return log.trim().split('\n').filter((l) => l.trim()).length;
    } catch {
      return 0;
    }
  }

  /**
   * Remove all worktrees and their branches.
   * Called at session end or during cleanup.
   */
  async cleanupAll(): Promise<void> {
    const errors: string[] = [];

    for (const [id, info] of this.worktrees) {
      try {
        await this.removeWorktree(info);
      } catch (err) {
        errors.push(`Failed to clean up ${id}: ${err}`);
      }
    }

    this.worktrees.clear();

    // Remove the worktrees directory if empty
    const worktreeBaseDir = path.resolve(
      this.config.cwd,
      this.config.worktreeDir
    );
    try {
      const entries = fs.readdirSync(worktreeBaseDir);
      if (entries.length === 0) {
        fs.rmdirSync(worktreeBaseDir);
      }
    } catch {
      // Directory may not exist or not be empty
    }

    if (errors.length > 0) {
      throw new Error(
        `Worktree cleanup had ${errors.length} error(s):\n${errors.join('\n')}`
      );
    }
  }

  /**
   * Remove a single worktree and its branch.
   */
  private async removeWorktree(info: WorktreeInfo): Promise<void> {
    // Force remove the worktree
    try {
      this.git(['worktree', 'remove', '--force', info.path]);
    } catch {
      // If git worktree remove fails, try manual cleanup
      if (fs.existsSync(info.path)) {
        fs.rmSync(info.path, { recursive: true, force: true });
      }
      // Prune worktree references
      try {
        this.git(['worktree', 'prune']);
      } catch {
        // Best effort
      }
    }

    // Delete the branch
    try {
      this.git(['branch', '-D', info.branch]);
    } catch {
      // Branch may already be deleted
    }
  }

  /**
   * Clean up a stale worktree at the given path if it exists.
   */
  private async cleanupStaleWorktree(
    worktreePath: string,
    branchName: string
  ): Promise<void> {
    if (fs.existsSync(worktreePath)) {
      try {
        this.git(['worktree', 'remove', '--force', worktreePath]);
      } catch {
        fs.rmSync(worktreePath, { recursive: true, force: true });
        this.git(['worktree', 'prune']);
      }
    }

    // Also remove the branch if it exists
    try {
      this.git(['branch', '-D', branchName]);
    } catch {
      // Branch may not exist
    }
  }

  /**
   * Ensure the worktree base directory exists and is in .gitignore.
   */
  private async ensureWorktreeDir(): Promise<void> {
    const worktreeBaseDir = path.resolve(
      this.config.cwd,
      this.config.worktreeDir
    );
    fs.mkdirSync(worktreeBaseDir, { recursive: true });

    // Ensure .ralph-tui/worktrees is in .gitignore
    await this.ensureGitignore();
  }

  /**
   * Add worktree directory to .gitignore if not already present.
   */
  private async ensureGitignore(): Promise<void> {
    const gitignorePath = path.join(this.config.cwd, '.gitignore');
    const worktreePattern = this.config.worktreeDir;

    let content = '';
    try {
      content = fs.readFileSync(gitignorePath, 'utf-8');
    } catch {
      // .gitignore doesn't exist yet
    }

    // Check if pattern is already present
    const lines = content.split('\n');
    const hasPattern = lines.some(
      (line) =>
        line.trim() === worktreePattern ||
        line.trim() === `/${worktreePattern}` ||
        line.trim() === `${worktreePattern}/`
    );

    if (!hasPattern) {
      const separator = content.endsWith('\n') || content === '' ? '' : '\n';
      const newContent =
        content +
        separator +
        `\n# Ralph TUI parallel execution worktrees\n${worktreePattern}/\n`;
      fs.writeFileSync(gitignorePath, newContent, 'utf-8');
    }
  }

  /**
   * Copy ralph-tui configuration into a worktree.
   */
  private async copyConfig(worktreePath: string): Promise<void> {
    const configDir = path.join(this.config.cwd, '.ralph-tui');
    const targetDir = path.join(worktreePath, '.ralph-tui');

    // Copy config.toml if it exists
    const configFile = path.join(configDir, 'config.toml');
    if (fs.existsSync(configFile)) {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(configFile, path.join(targetDir, 'config.toml'));
    }

    // Also copy config.yaml / config.yml if they exist
    for (const ext of ['yaml', 'yml']) {
      const yamlConfig = path.join(configDir, `config.${ext}`);
      if (fs.existsSync(yamlConfig)) {
        fs.mkdirSync(targetDir, { recursive: true });
        fs.copyFileSync(yamlConfig, path.join(targetDir, `config.${ext}`));
      }
    }
  }

  /**
   * Check if there is enough disk space to create a worktree.
   * Uses Node.js fs.statfs() for cross-platform compatibility (macOS, Linux, Windows).
   * @throws If available space is below the minimum threshold
   */
  private async checkDiskSpace(): Promise<void> {
    try {
      // Use fs.statfs for cross-platform disk space checking
      const stats = await fs.promises.statfs(this.config.cwd);
      // bavail = free blocks available to unprivileged user
      // bsize = block size
      const available = stats.bavail * stats.bsize;

      if (available < this.config.minFreeDiskSpace) {
        const availMB = Math.round(available / (1024 * 1024));
        const reqMB = Math.round(this.config.minFreeDiskSpace / (1024 * 1024));
        throw new Error(
          `Insufficient disk space for worktree: ${availMB}MB available, ${reqMB}MB required`
        );
      }
    } catch (err) {
      // Re-throw insufficient space errors
      if (
        err instanceof Error &&
        err.message.includes('Insufficient disk space')
      ) {
        throw err;
      }
      // fs.statfs may not be available on older Node versions or some systems
      // In that case, continue without the check
    }
  }

  /**
   * Execute a git command in the main repository.
   * Uses execFileSync with argument array to prevent shell injection.
   * Pipes stdio so git output (especially stderr) doesn't bleed through to the TUI.
   */
  private git(args: string[]): string {
    return execFileSync('git', ['-C', this.config.cwd, ...args], {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  /**
   * Execute a git command in a specific worktree.
   * Uses execFileSync with argument array to prevent shell injection.
   * Pipes stdio so git output doesn't bleed through to the TUI.
   */
  private gitInWorktree(worktreePath: string, args: string[]): string {
    return execFileSync('git', ['-C', worktreePath, ...args], {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
}
