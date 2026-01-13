/**
 * ABOUTME: Type definitions for the Merge Engine.
 * Defines configuration, state, and event types for merging worktree branches
 * back to the original branch with automatic backup and conflict detection.
 */

import type { ManagedWorktree } from './types.js';
import type { ConflictResolutionConfig } from '../config/types.js';
import type { UserPromptCallback, ConflictResolutionResult } from './conflict-resolver-types.js';

/**
 * Configuration for the merge engine.
 */
export interface MergeEngineConfig {
  /** Project root directory (where main .git is located) */
  projectRoot: string;

  /** Prefix for backup branches (default: 'pre-parallel-merge/') */
  backupBranchPrefix: string;

  /** Whether to create backup branches before merging (default: true) */
  createBackupBranch: boolean;

  /** Whether to automatically delete worktree branches after successful merge (default: true) */
  deleteWorktreeBranchesOnSuccess: boolean;

  /** Whether to abort on first conflict or continue with remaining worktrees (default: true) */
  abortOnConflict: boolean;

  /** AI-powered conflict resolution configuration */
  conflictResolution?: ConflictResolutionConfig;

  /** Callback for user prompts when AI confidence is low */
  onUserPrompt?: UserPromptCallback;
}

/**
 * Default merge engine configuration.
 */
export const DEFAULT_MERGE_ENGINE_CONFIG: MergeEngineConfig = {
  projectRoot: process.cwd(),
  backupBranchPrefix: 'pre-parallel-merge/',
  createBackupBranch: true,
  deleteWorktreeBranchesOnSuccess: true,
  abortOnConflict: true,
};

/**
 * Status of a merge operation for a single worktree.
 */
export type WorktreeMergeStatus =
  | 'pending'
  | 'merging'
  | 'merged'
  | 'conflict'
  | 'conflict_resolved'
  | 'conflict_pending_user'
  | 'skipped'
  | 'error';

/**
 * Result of merging a single worktree branch.
 */
export interface WorktreeMergeResult {
  /** The worktree that was merged */
  worktree: ManagedWorktree;

  /** Status of the merge */
  status: WorktreeMergeStatus;

  /** Merge commit SHA if successful */
  mergeCommitSha?: string;

  /** Error message if merge failed */
  error?: string;

  /** List of conflicting files if conflict occurred */
  conflictingFiles?: string[];

  /** AI conflict resolution result if auto-resolution was attempted */
  aiResolution?: ConflictResolutionResult;

  /** Time taken to merge in milliseconds */
  durationMs: number;
}

/**
 * Complete result of merging all worktrees.
 */
export interface MergeSessionResult {
  /** Whether all merges completed successfully */
  success: boolean;

  /** Target branch that worktrees were merged into */
  targetBranch: string;

  /** Backup branch created before merging (if enabled) */
  backupBranch?: string;

  /** SHA of the target branch before any merges (for rollback) */
  premergeReflogRef: string;

  /** Individual results for each worktree merge */
  worktreeResults: WorktreeMergeResult[];

  /** Total time for the entire merge session in milliseconds */
  totalDurationMs: number;

  /** Number of worktrees successfully merged */
  mergedCount: number;

  /** Number of worktrees that had conflicts */
  conflictCount: number;

  /** Number of worktrees skipped (due to earlier conflict when abortOnConflict=true) */
  skippedCount: number;
}

/**
 * Information about a backup branch.
 */
export interface BackupBranchInfo {
  /** Full name of the backup branch */
  name: string;

  /** SHA that the backup branch points to */
  sha: string;

  /** Timestamp when the backup was created */
  createdAt: Date;

  /** The target branch this is a backup of */
  originalBranch: string;
}

/**
 * Options for initiating a merge session.
 */
export interface MergeSessionOptions {
  /** Target branch to merge into (default: main or master) */
  targetBranch?: string;

  /** Worktrees to merge (if not provided, uses all ready worktrees) */
  worktrees?: ManagedWorktree[];

  /** Override config for this session */
  config?: Partial<MergeEngineConfig>;

  /** Custom backup branch name (if not provided, uses timestamp) */
  backupBranchName?: string;
}

/**
 * Options for rollback operation.
 */
export interface RollbackOptions {
  /** The reflog reference or SHA to rollback to */
  targetRef: string;

  /** Whether to delete any branches created during the merge session */
  cleanupMergeBranches?: boolean;

  /** Whether to force the rollback even if there are uncommitted changes */
  force?: boolean;
}

/**
 * Result of a rollback operation.
 */
export interface RollbackResult {
  /** Whether the rollback was successful */
  success: boolean;

  /** The branch that was rolled back */
  branch: string;

  /** The SHA that was rolled back from */
  fromSha: string;

  /** The SHA that was rolled back to */
  toSha: string;

  /** Error message if rollback failed */
  error?: string;

  /** List of branches deleted during cleanup */
  deletedBranches?: string[];
}

/**
 * Events emitted by the merge engine.
 */
export type MergeEngineEvent =
  | { type: 'session_started'; targetBranch: string; worktreeCount: number }
  | { type: 'backup_created'; backupBranch: BackupBranchInfo }
  | { type: 'worktree_merge_started'; worktree: ManagedWorktree; index: number; total: number }
  | { type: 'worktree_merge_completed'; result: WorktreeMergeResult; index: number; total: number }
  | { type: 'worktree_merge_conflict'; worktree: ManagedWorktree; conflictingFiles: string[] }
  | { type: 'conflict_resolution_started'; worktree: ManagedWorktree; fileCount: number }
  | { type: 'conflict_resolution_completed'; worktree: ManagedWorktree; result: ConflictResolutionResult }
  | { type: 'conflict_user_prompt_required'; worktree: ManagedWorktree; pendingFileCount: number }
  | { type: 'session_completed'; result: MergeSessionResult }
  | { type: 'session_aborted'; reason: string; partialResult: Partial<MergeSessionResult> }
  | { type: 'rollback_started'; targetRef: string }
  | { type: 'rollback_completed'; result: RollbackResult }
  | { type: 'error'; error: Error; context?: string };

/**
 * Callback type for merge engine event listeners.
 */
export type MergeEngineEventListener = (event: MergeEngineEvent) => void;

/**
 * State of the merge engine.
 */
export interface MergeEngineState {
  /** Whether a merge session is currently in progress */
  isSessionActive: boolean;

  /** Current target branch for the active session */
  currentTargetBranch?: string;

  /** Backup branch for the active session */
  currentBackupBranch?: BackupBranchInfo;

  /** Pre-merge reflog reference for the active session */
  currentPremergeRef?: string;

  /** Results accumulated so far in the active session */
  currentResults: WorktreeMergeResult[];

  /** Index of the worktree currently being merged */
  currentMergeIndex: number;

  /** Total worktrees to merge in the active session */
  totalWorktrees: number;
}

/**
 * Reflog entry for tracking git history.
 */
export interface ReflogEntry {
  /** The SHA this entry points to */
  sha: string;

  /** The reflog message */
  message: string;

  /** Timestamp of the entry */
  timestamp: Date;

  /** The reflog selector (e.g., HEAD@{0}) */
  selector: string;
}
