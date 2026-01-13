/**
 * ABOUTME: Type definitions for the Merge Progress View.
 * Defines display state, events, and user interaction types for
 * showing merge progress and conflict resolution in the TUI.
 */

import type {
  WorktreeMergeStatus,
  WorktreeMergeResult,
  MergeSessionResult,
  BackupBranchInfo,
} from '../worktree/merge-engine-types.js';
import type {
  FileResolutionResult,
  ConflictResolutionResult,
  UserResolutionChoice,
} from '../worktree/conflict-resolver-types.js';
import type { ManagedWorktree } from '../worktree/types.js';

/**
 * Display status for a worktree in the merge progress view.
 * Maps to WorktreeMergeStatus but with display-friendly naming.
 */
export type MergeDisplayStatus =
  | 'pending'      // Waiting to be merged
  | 'in-progress'  // Currently merging
  | 'complete'     // Successfully merged
  | 'conflict'     // Has conflicts needing resolution
  | 'resolved'     // Conflicts resolved successfully
  | 'skipped'      // Skipped (earlier conflict when abortOnConflict=true)
  | 'error';       // Failed with error

/**
 * Progress entry for a single worktree in the merge view.
 */
export interface WorktreeMergeProgress {
  /** Worktree being merged */
  worktree: ManagedWorktree;

  /** Current display status */
  status: MergeDisplayStatus;

  /** Branch name being merged */
  branchName: string;

  /** Task ID associated with this worktree */
  taskId?: string;

  /** Task title for display */
  taskTitle?: string;

  /** Merge commit SHA if completed */
  mergeCommitSha?: string;

  /** Error message if failed */
  error?: string;

  /** Files with conflicts */
  conflictingFiles?: string[];

  /** AI resolution result if attempted */
  aiResolution?: ConflictResolutionResult;

  /** Time taken in milliseconds */
  durationMs: number;

  /** Index in the merge sequence (1-based) */
  index: number;

  /** Total worktrees to merge */
  total: number;
}

/**
 * Conflict details for a single file.
 * Combines file path with AI resolution suggestion for TUI display.
 */
export interface ConflictDetail {
  /** File path relative to project root */
  filePath: string;

  /** AI-generated resolution suggestion */
  suggestion?: string;

  /** Confidence level of AI resolution (0-1) */
  confidence: number;

  /** Strategy used for resolution */
  strategy?: 'ours' | 'theirs' | 'merged' | 'semantic';

  /** Reasoning behind the AI suggestion */
  reasoning?: string;

  /** Whether this conflict requires user input */
  requiresUserInput: boolean;

  /** Whether user has made a decision */
  resolved: boolean;

  /** User's choice if resolved */
  userChoice?: UserResolutionChoice;
}

/**
 * Props for the MergeProgressView component.
 */
export interface MergeProgressViewProps {
  /** Progress for all worktrees */
  worktrees: WorktreeMergeProgress[];

  /** Backup branch info */
  backupBranch?: BackupBranchInfo;

  /** Target branch being merged into */
  targetBranch: string;

  /** Currently selected worktree index */
  selectedIndex: number;

  /** Whether a conflict is being resolved */
  isResolvingConflict: boolean;

  /** Current conflict details when resolving */
  currentConflicts?: ConflictDetail[];

  /** Currently selected conflict index */
  selectedConflictIndex?: number;

  /** Callback when user accepts AI resolution */
  onAcceptResolution?: (fileIndex: number) => void;

  /** Callback when user rejects AI resolution */
  onRejectResolution?: (fileIndex: number) => void;

  /** Callback when user wants to use 'ours' version */
  onUseOurs?: (fileIndex: number) => void;

  /** Callback when user wants to use 'theirs' version */
  onUseTheirs?: (fileIndex: number) => void;

  /** Callback when user wants to manually resolve */
  onManualResolve?: (fileIndex: number) => void;

  /** Callback to abort all conflict resolution */
  onAbortAll?: () => void;

  /** Callback when navigating worktrees */
  onSelectWorktree?: (index: number) => void;

  /** Callback when navigating conflicts */
  onSelectConflict?: (index: number) => void;

  /** Callback when merge phase is complete */
  onMergeComplete?: (result: MergeSessionResult) => void;

  /** Callback to close the view */
  onClose?: () => void;
}

/**
 * Props for the WorktreeMergeCard component.
 */
export interface WorktreeMergeCardProps {
  /** Worktree merge progress to display */
  progress: WorktreeMergeProgress;

  /** Whether this card is currently selected */
  isSelected: boolean;

  /** Whether to show compact view */
  compact?: boolean;

  /** Callback when card is selected */
  onSelect?: () => void;
}

/**
 * Props for the ConflictResolutionPanel component.
 */
export interface ConflictResolutionPanelProps {
  /** Worktree with conflicts */
  worktree: WorktreeMergeProgress;

  /** All conflicts for the worktree */
  conflicts: ConflictDetail[];

  /** Currently selected conflict index */
  selectedIndex: number;

  /** Callback when accepting AI resolution */
  onAccept?: (fileIndex: number) => void;

  /** Callback when rejecting AI resolution */
  onReject?: (fileIndex: number) => void;

  /** Callback when using 'ours' version */
  onUseOurs?: (fileIndex: number) => void;

  /** Callback when using 'theirs' version */
  onUseTheirs?: (fileIndex: number) => void;

  /** Callback when manually resolving */
  onManualResolve?: (fileIndex: number) => void;

  /** Callback to abort all */
  onAbortAll?: () => void;

  /** Callback when navigating conflicts */
  onSelectConflict?: (index: number) => void;

  /** Callback to go back to worktree list */
  onBack?: () => void;
}

/**
 * View mode for the merge progress view.
 */
export type MergeProgressViewMode =
  | 'overview'    // Shows all worktrees and their status
  | 'conflict';   // Shows conflict resolution for selected worktree

/**
 * Events for merge progress updates.
 */
export type MergeProgressEvent =
  | { type: 'worktree_started'; progress: WorktreeMergeProgress }
  | { type: 'worktree_completed'; progress: WorktreeMergeProgress }
  | { type: 'worktree_conflict'; progress: WorktreeMergeProgress; conflicts: ConflictDetail[] }
  | { type: 'conflict_resolved'; fileIndex: number; choice: UserResolutionChoice }
  | { type: 'merge_complete'; result: MergeSessionResult }
  | { type: 'merge_aborted'; reason: string };

/**
 * Callback type for merge progress event listeners.
 */
export type MergeProgressEventListener = (event: MergeProgressEvent) => void;

/**
 * Map WorktreeMergeStatus to MergeDisplayStatus.
 */
export function toDisplayStatus(status: WorktreeMergeStatus): MergeDisplayStatus {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'merging':
      return 'in-progress';
    case 'merged':
      return 'complete';
    case 'conflict':
      return 'conflict';
    case 'conflict_resolved':
      return 'resolved';
    case 'conflict_pending_user':
      return 'conflict';
    case 'skipped':
      return 'skipped';
    case 'error':
      return 'error';
  }
}

/**
 * Get display color for merge status.
 */
export function getMergeStatusColor(status: MergeDisplayStatus): string {
  switch (status) {
    case 'complete':
    case 'resolved':
      return '#9ece6a';
    case 'in-progress':
      return '#7aa2f7';
    case 'conflict':
      return '#e0af68';
    case 'error':
      return '#f7768e';
    case 'skipped':
    case 'pending':
    default:
      return '#565f89';
  }
}

/**
 * Get status indicator for merge status.
 */
export function getMergeStatusIndicator(status: MergeDisplayStatus): string {
  switch (status) {
    case 'complete':
      return '\u2713';
    case 'resolved':
      return '\u2713';
    case 'in-progress':
      return '\u25B6';
    case 'conflict':
      return '\u26A0';
    case 'error':
      return '\u2717';
    case 'skipped':
      return '\u2298';
    case 'pending':
    default:
      return '\u25CB';
  }
}

/**
 * Get display label for merge status.
 */
export function getMergeStatusLabel(status: MergeDisplayStatus): string {
  switch (status) {
    case 'complete':
      return 'Complete';
    case 'resolved':
      return 'Resolved';
    case 'in-progress':
      return 'Merging...';
    case 'conflict':
      return 'Conflict';
    case 'error':
      return 'Error';
    case 'skipped':
      return 'Skipped';
    case 'pending':
    default:
      return 'Pending';
  }
}

/**
 * Get confidence level display string and color.
 */
export function getConfidenceDisplay(confidence: number): { label: string; color: string } {
  if (confidence >= 0.9) {
    return { label: 'High', color: '#9ece6a' };
  } else if (confidence >= 0.7) {
    return { label: 'Medium', color: '#e0af68' };
  } else if (confidence >= 0.5) {
    return { label: 'Low', color: '#e0af68' };
  } else {
    return { label: 'Very Low', color: '#f7768e' };
  }
}

/**
 * Format duration for display.
 */
export function formatMergeDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);

  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Convert WorktreeMergeResult to WorktreeMergeProgress.
 */
export function resultToProgress(
  result: WorktreeMergeResult,
  index: number,
  total: number
): WorktreeMergeProgress {
  return {
    worktree: result.worktree,
    status: toDisplayStatus(result.status),
    branchName: result.worktree.branch,
    taskId: result.worktree.taskId,
    taskTitle: undefined,
    mergeCommitSha: result.mergeCommitSha,
    error: result.error,
    conflictingFiles: result.conflictingFiles,
    aiResolution: result.aiResolution,
    durationMs: result.durationMs,
    index,
    total,
  };
}

/**
 * Convert FileResolutionResult to ConflictDetail.
 */
export function fileResultToConflictDetail(
  result: FileResolutionResult
): ConflictDetail {
  return {
    filePath: result.filePath,
    suggestion: result.resolution?.resolvedContent,
    confidence: result.resolution?.confidence ?? 0,
    strategy: result.resolution?.strategy,
    reasoning: result.resolution?.reasoning,
    requiresUserInput: result.requiresUserInput,
    resolved: !result.requiresUserInput && result.success,
    userChoice: undefined,
  };
}

/**
 * Keyboard shortcuts for merge progress view.
 */
export const mergeProgressShortcuts = [
  { key: 'a', description: 'Accept AI resolution' },
  { key: 'r', description: 'Reject AI resolution' },
  { key: 'o', description: 'Use ours' },
  { key: 't', description: 'Use theirs' },
  { key: 'm', description: 'Manual resolve' },
  { key: 'Esc', description: 'Back / Abort' },
  { key: '\u2191\u2193', description: 'Navigate' },
  { key: 'Enter', description: 'View conflicts' },
] as const;
