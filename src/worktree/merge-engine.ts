/**
 * ABOUTME: Merge Engine for consolidating worktree branches back to the original branch.
 * Provides automatic backup branch creation, sequential merge with conflict detection,
 * AI-powered conflict resolution, and reflog-based rollback to pre-merge state.
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { ManagedWorktree } from './types.js';
import {
  type MergeEngineConfig,
  type MergeEngineState,
  type MergeEngineEvent,
  type MergeEngineEventListener,
  type MergeSessionOptions,
  type MergeSessionResult,
  type WorktreeMergeResult,
  type WorktreeMergeStatus,
  type BackupBranchInfo,
  type RollbackOptions,
  type RollbackResult,
  type ReflogEntry,
  DEFAULT_MERGE_ENGINE_CONFIG,
} from './merge-engine-types.js';
import { ConflictResolver } from './conflict-resolver.js';

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

export class MergeEngine {
  private readonly config: MergeEngineConfig;
  private readonly listeners: Set<MergeEngineEventListener> = new Set();
  private state: MergeEngineState = {
    isSessionActive: false,
    currentResults: [],
    currentMergeIndex: 0,
    totalWorktrees: 0,
  };

  constructor(config: Partial<MergeEngineConfig> = {}) {
    this.config = {
      ...DEFAULT_MERGE_ENGINE_CONFIG,
      ...config,
      projectRoot: resolve(config.projectRoot || DEFAULT_MERGE_ENGINE_CONFIG.projectRoot),
    };
  }

  addEventListener(listener: MergeEngineEventListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(listener: MergeEngineEventListener): void {
    this.listeners.delete(listener);
  }

  private emit(event: MergeEngineEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
      }
    }
  }

  getState(): Readonly<MergeEngineState> {
    return { ...this.state };
  }

  async mergeAll(options: MergeSessionOptions = {}): Promise<MergeSessionResult> {
    if (this.state.isSessionActive) {
      throw new Error('A merge session is already in progress');
    }

    const startTime = Date.now();
    const sessionConfig = { ...this.config, ...options.config };
    const worktrees = options.worktrees || [];

    if (worktrees.length === 0) {
      return {
        success: true,
        targetBranch: options.targetBranch || 'main',
        premergeReflogRef: '',
        worktreeResults: [],
        totalDurationMs: Date.now() - startTime,
        mergedCount: 0,
        conflictCount: 0,
        skippedCount: 0,
      };
    }

    const targetBranch = options.targetBranch || (await this.getDefaultBranch());

    this.state = {
      isSessionActive: true,
      currentTargetBranch: targetBranch,
      currentResults: [],
      currentMergeIndex: 0,
      totalWorktrees: worktrees.length,
    };

    this.emit({
      type: 'session_started',
      targetBranch,
      worktreeCount: worktrees.length,
    });

    try {
      await execGit(['checkout', targetBranch], this.config.projectRoot);

      const premergeRef = await this.getCurrentHeadSha();

      let backupBranch: BackupBranchInfo | undefined;
      if (sessionConfig.createBackupBranch) {
        backupBranch = await this.createBackupBranch(
          targetBranch,
          premergeRef,
          options.backupBranchName
        );
        this.state.currentBackupBranch = backupBranch;
        this.emit({ type: 'backup_created', backupBranch });
      }

      this.state.currentPremergeRef = premergeRef;

      const results: WorktreeMergeResult[] = [];
      let aborted = false;

      for (let i = 0; i < worktrees.length; i++) {
        const worktree = worktrees[i];
        this.state.currentMergeIndex = i;

        if (aborted) {
          results.push({
            worktree,
            status: 'skipped',
            durationMs: 0,
          });
          continue;
        }

        this.emit({
          type: 'worktree_merge_started',
          worktree,
          index: i,
          total: worktrees.length,
        });

        const result = await this.mergeWorktree(worktree, targetBranch, sessionConfig);
        results.push(result);
        this.state.currentResults.push(result);

        this.emit({
          type: 'worktree_merge_completed',
          result,
          index: i,
          total: worktrees.length,
        });

        if (result.status === 'conflict') {
          this.emit({
            type: 'worktree_merge_conflict',
            worktree,
            conflictingFiles: result.conflictingFiles || [],
          });

          if (sessionConfig.abortOnConflict) {
            aborted = true;
          }
        }
      }

      const sessionResult: MergeSessionResult = {
        success: results.every((r) => r.status === 'merged' || r.status === 'skipped'),
        targetBranch,
        backupBranch: backupBranch?.name,
        premergeReflogRef: premergeRef,
        worktreeResults: results,
        totalDurationMs: Date.now() - startTime,
        mergedCount: results.filter((r) => r.status === 'merged').length,
        conflictCount: results.filter((r) => r.status === 'conflict').length,
        skippedCount: results.filter((r) => r.status === 'skipped').length,
      };

      this.emit({ type: 'session_completed', result: sessionResult });
      return sessionResult;
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      this.emit({ type: 'error', error: errorObj, context: 'merge_session' });

      this.emit({
        type: 'session_aborted',
        reason: errorObj.message,
        partialResult: {
          targetBranch,
          worktreeResults: this.state.currentResults,
        },
      });

      throw error;
    } finally {
      this.state = {
        isSessionActive: false,
        currentResults: [],
        currentMergeIndex: 0,
        totalWorktrees: 0,
      };
    }
  }

  private async mergeWorktree(
    worktree: ManagedWorktree,
    targetBranch: string,
    config: MergeEngineConfig
  ): Promise<WorktreeMergeResult> {
    const startTime = Date.now();

    try {
      await execGit(['checkout', targetBranch], config.projectRoot);

      await execGit(['merge', worktree.branch, '--no-edit'], config.projectRoot);

      const mergeCommitSha = await this.getCurrentHeadSha();

      if (config.deleteWorktreeBranchesOnSuccess) {
        try {
          await execGit(['branch', '-d', worktree.branch], config.projectRoot);
        } catch {
        }
      }

      return {
        worktree,
        status: 'merged' as WorktreeMergeStatus,
        mergeCommitSha,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.toLowerCase().includes('conflict') || errorMessage.includes('CONFLICT')) {
        const conflictingFiles = await this.getConflictingFiles();

        if (config.conflictResolution?.autoResolve !== false && conflictingFiles.length > 0) {
          const resolutionResult = await this.attemptAIResolution(
            worktree,
            conflictingFiles,
            config
          );

          if (resolutionResult) {
            return resolutionResult;
          }
        }

        await this.abortMerge();

        return {
          worktree,
          status: 'conflict' as WorktreeMergeStatus,
          error: errorMessage,
          conflictingFiles,
          durationMs: Date.now() - startTime,
        };
      }

      return {
        worktree,
        status: 'error' as WorktreeMergeStatus,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };
    }
  }

  private async attemptAIResolution(
    worktree: ManagedWorktree,
    conflictingFiles: string[],
    config: MergeEngineConfig
  ): Promise<WorktreeMergeResult | null> {
    const startTime = Date.now();

    this.emit({
      type: 'conflict_resolution_started',
      worktree,
      fileCount: conflictingFiles.length,
    });

    try {
      const resolver = new ConflictResolver({
        projectRoot: config.projectRoot,
        ...config.conflictResolution,
        onUserPrompt: config.onUserPrompt,
      });

      const result = await resolver.resolveConflicts(conflictingFiles);

      this.emit({
        type: 'conflict_resolution_completed',
        worktree,
        result,
      });

      if (result.success && result.stats.successRate >= 0.85) {
        await execGit(['commit', '-m', `Merge ${worktree.branch} (AI-resolved conflicts)`], config.projectRoot);
        const mergeCommitSha = await this.getCurrentHeadSha();

        if (config.deleteWorktreeBranchesOnSuccess) {
          try {
            await execGit(['branch', '-d', worktree.branch], config.projectRoot);
          } catch {
          }
        }

        return {
          worktree,
          status: 'conflict_resolved' as WorktreeMergeStatus,
          mergeCommitSha,
          aiResolution: result,
          durationMs: Date.now() - startTime,
        };
      }

      if (result.pendingFiles.length > 0) {
        this.emit({
          type: 'conflict_user_prompt_required',
          worktree,
          pendingFileCount: result.pendingFiles.length,
        });

        return {
          worktree,
          status: 'conflict_pending_user' as WorktreeMergeStatus,
          conflictingFiles,
          aiResolution: result,
          durationMs: Date.now() - startTime,
        };
      }

      return null;
    } catch (error) {
      this.emit({
        type: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
        context: 'AI conflict resolution',
      });
      return null;
    }
  }

  private async getConflictingFiles(): Promise<string[]> {
    try {
      const { stdout } = await execGit(['diff', '--name-only', '--diff-filter=U'], this.config.projectRoot);
      return stdout.split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  private async abortMerge(): Promise<void> {
    try {
      await execGit(['merge', '--abort'], this.config.projectRoot);
    } catch {
    }
  }

  async rollback(options: RollbackOptions): Promise<RollbackResult> {
    const { targetRef, cleanupMergeBranches = false, force = false } = options;

    this.emit({ type: 'rollback_started', targetRef });

    try {
      const currentBranch = await this.getCurrentBranch();
      const fromSha = await this.getCurrentHeadSha();

      if (!force) {
        const status = await execGit(['status', '--porcelain'], this.config.projectRoot);
        if (status.stdout.trim()) {
          throw new Error('Working directory has uncommitted changes. Use force=true to override.');
        }
      }

      await execGit(['reset', '--hard', targetRef], this.config.projectRoot);

      const toSha = await this.getCurrentHeadSha();

      const deletedBranches: string[] = [];
      if (cleanupMergeBranches) {
        const branches = await this.getWorktreeBranches();
        for (const branch of branches) {
        try {
          await execGit(['branch', '-D', branch], this.config.projectRoot);
          deletedBranches.push(branch);
        } catch {
        }
        }
      }

      const result: RollbackResult = {
        success: true,
        branch: currentBranch,
        fromSha,
        toSha,
        deletedBranches: deletedBranches.length > 0 ? deletedBranches : undefined,
      };

      this.emit({ type: 'rollback_completed', result });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const result: RollbackResult = {
        success: false,
        branch: '',
        fromSha: '',
        toSha: '',
        error: errorMessage,
      };

      this.emit({ type: 'rollback_completed', result });
      return result;
    }
  }

  async getReflogEntries(count: number = 10): Promise<ReflogEntry[]> {
    try {
      const { stdout } = await execGit(
        ['reflog', '--format=%H|%gd|%gs|%at', `-n${count}`],
        this.config.projectRoot
      );

      return stdout.split('\n').filter(Boolean).map((line) => {
        const [sha, selector, message, timestamp] = line.split('|');
        return {
          sha,
          selector,
          message,
          timestamp: new Date(parseInt(timestamp, 10) * 1000),
        };
      });
    } catch {
      return [];
    }
  }

  async findPreMergeRef(backupBranchName?: string): Promise<string | null> {
    if (backupBranchName) {
      try {
        const { stdout } = await execGit(['rev-parse', backupBranchName], this.config.projectRoot);
        return stdout.trim();
      } catch {
      }
    }

    const entries = await this.getReflogEntries(50);
    for (const entry of entries) {
      if (entry.message.includes('pre-parallel-merge') || entry.message.includes('backup')) {
        return entry.sha;
      }
    }

    return null;
  }

  private async createBackupBranch(
    targetBranch: string,
    sha: string,
    customName?: string
  ): Promise<BackupBranchInfo> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const branchName = customName || `${this.config.backupBranchPrefix}${timestamp}`;

    await execGit(['branch', branchName, sha], this.config.projectRoot);

    return {
      name: branchName,
      sha,
      createdAt: new Date(),
      originalBranch: targetBranch,
    };
  }

  private async getDefaultBranch(): Promise<string> {
    try {
      const { stdout } = await execGit(
        ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'],
        this.config.projectRoot
      );
      return stdout.replace('origin/', '');
    } catch {
      const exists = await this.branchExists('main');
      return exists ? 'main' : 'master';
    }
  }

  private async branchExists(branch: string): Promise<boolean> {
    try {
      await execGit(['rev-parse', '--verify', branch], this.config.projectRoot);
      return true;
    } catch {
      return false;
    }
  }

  private async getCurrentHeadSha(): Promise<string> {
    const { stdout } = await execGit(['rev-parse', 'HEAD'], this.config.projectRoot);
    return stdout.trim();
  }

  private async getCurrentBranch(): Promise<string> {
    const { stdout } = await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], this.config.projectRoot);
    return stdout.trim();
  }

  private async getWorktreeBranches(): Promise<string[]> {
    try {
      const { stdout } = await execGit(['branch', '--list', 'worktree/*'], this.config.projectRoot);
      return stdout
        .split('\n')
        .map((line) => line.trim().replace(/^\*\s*/, ''))
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  async deleteBackupBranch(branchName: string): Promise<boolean> {
    try {
      await execGit(['branch', '-D', branchName], this.config.projectRoot);
      return true;
    } catch {
      return false;
    }
  }

  async listBackupBranches(): Promise<BackupBranchInfo[]> {
    try {
      const { stdout } = await execGit(
        ['branch', '--list', `${this.config.backupBranchPrefix}*`, '--format=%(refname:short)|%(objectname)|%(creatordate:unix)'],
        this.config.projectRoot
      );

      return stdout.split('\n').filter(Boolean).map((line) => {
        const [name, sha, timestamp] = line.split('|');
        return {
          name,
          sha,
          createdAt: new Date(parseInt(timestamp, 10) * 1000),
          originalBranch: 'unknown',
        };
      });
    } catch {
      return [];
    }
  }

  async cleanupOldBackups(keepCount: number = 5): Promise<string[]> {
    const backups = await this.listBackupBranches();
    const sorted = backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const toDelete = sorted.slice(keepCount);
    const deleted: string[] = [];

    for (const backup of toDelete) {
      if (await this.deleteBackupBranch(backup.name)) {
        deleted.push(backup.name);
      }
    }

    return deleted;
  }
}
