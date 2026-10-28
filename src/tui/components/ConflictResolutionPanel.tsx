/**
 * ABOUTME: Conflict resolution overlay for parallel execution merge conflicts.
 * Displays conflicting files with AI resolution status and provides keyboard
 * controls for retry, skip, or abort when resolution fails.
 * Follows the same overlay pattern as HelpOverlay.
 */

import type { ReactNode } from 'react';
import { memo, useState, useEffect } from 'react';
import { createTextAttributes } from '@opentui/core';
import { colors, statusIndicators } from '../theme.js';
import type { FileConflict, ConflictResolutionResult } from '../../parallel/types.js';

const boldAttr = createTextAttributes({ bold: true });

/** Spinner frames for animation */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Maximum number of files to show before scrolling */
const MAX_VISIBLE_FILES = 10;

export interface ConflictResolutionPanelProps {
  /** Whether the overlay is visible */
  visible: boolean;
  /** List of file conflicts in the current merge */
  conflicts: FileConflict[];
  /** Resolution results for files that have been resolved */
  resolutions: ConflictResolutionResult[];
  /** Task ID whose merge is conflicting */
  taskId: string;
  /** Task title for display */
  taskTitle: string;
  /** Whether AI resolution is currently running */
  aiResolving: boolean;
  /** The file currently being resolved by AI */
  currentlyResolvingFile?: string;
  /** Index of the file currently selected */
  selectedIndex: number;
  /** Callback when user requests retry (r key) */
  onRetry?: () => void;
  /** Callback when user requests skip (s key) */
  onSkip?: () => void;
}

/**
 * Resolution state for determining which controls to show.
 */
type ResolutionState = 'in-progress' | 'all-resolved' | 'has-failures' | 'waiting';

/**
 * Per-file status for display.
 */
type FileStatus = 'resolved' | 'failed' | 'resolving' | 'pending';

/**
 * Determine the overall resolution state.
 */
function getResolutionState(
  conflicts: FileConflict[],
  resolutions: ConflictResolutionResult[],
  aiResolving: boolean,
): ResolutionState {
  if (aiResolving) {
    return 'in-progress';
  }

  if (resolutions.length === 0) {
    return 'waiting';
  }

  const hasFailures = resolutions.some((r) => !r.success);
  if (hasFailures) {
    return 'has-failures';
  }

  const allResolved = conflicts.every((c) =>
    resolutions.some((r) => r.filePath === c.filePath && r.success)
  );
  if (allResolved) {
    return 'all-resolved';
  }

  return 'waiting';
}

/**
 * Get resolution status for a specific file.
 */
function getFileStatus(
  filePath: string,
  resolutions: ConflictResolutionResult[],
  currentlyResolvingFile?: string,
): FileStatus {
  const resolution = resolutions.find((r) => r.filePath === filePath);
  if (resolution) {
    return resolution.success ? 'resolved' : 'failed';
  }
  if (currentlyResolvingFile === filePath) {
    return 'resolving';
  }
  return 'pending';
}

/**
 * Get display properties for a file status.
 */
function getFileStatusDisplay(
  status: FileStatus,
  resolution: ConflictResolutionResult | undefined,
  spinnerFrame: number,
): { indicator: string; color: string; label: string } {
  switch (status) {
    case 'resolved':
      return {
        indicator: statusIndicators.merged,
        color: colors.status.success,
        label: `Resolved (${resolution?.method ?? 'ai'})`,
      };
    case 'failed':
      return {
        indicator: statusIndicators.error,
        color: colors.status.error,
        label: resolution?.error ?? 'Resolution failed',
      };
    case 'resolving':
      return {
        indicator: SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length] ?? '⠋',
        color: colors.status.info,
        label: 'Resolving...',
      };
    case 'pending':
      return {
        indicator: statusIndicators.conflicted,
        color: colors.status.warning,
        label: 'Waiting',
      };
  }
}

/**
 * Conflict resolution panel overlay.
 */
export const ConflictResolutionPanel = memo(function ConflictResolutionPanel({
  visible,
  conflicts,
  resolutions,
  taskId,
  taskTitle,
  aiResolving,
  currentlyResolvingFile,
  selectedIndex,
  onRetry,
  onSkip,
}: ConflictResolutionPanelProps): ReactNode {
  // Spinner animation frame
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  // Scroll offset for file list
  const [scrollOffset, setScrollOffset] = useState(0);

  // Update spinner frame when AI is resolving
  useEffect(() => {
    if (!aiResolving) {
      return;
    }
    const interval = setInterval(() => {
      setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(interval);
  }, [aiResolving]);

  // Adjust scroll offset based on selected index
  useEffect(() => {
    if (selectedIndex < scrollOffset) {
      setScrollOffset(selectedIndex);
    } else if (selectedIndex >= scrollOffset + MAX_VISIBLE_FILES) {
      setScrollOffset(selectedIndex - MAX_VISIBLE_FILES + 1);
    }
  }, [selectedIndex, scrollOffset]);

  if (!visible) {
    return null;
  }

  const resolvedCount = resolutions.filter((r) => r.success).length;
  const failedCount = resolutions.filter((r) => !r.success).length;
  const pendingCount = conflicts.length - resolvedCount - failedCount;
  const state = getResolutionState(conflicts, resolutions, aiResolving);

  // Calculate visible files based on scroll
  const needsScroll = conflicts.length > MAX_VISIBLE_FILES;
  const visibleConflicts = needsScroll
    ? conflicts.slice(scrollOffset, scrollOffset + MAX_VISIBLE_FILES)
    : conflicts;

  return (
    <box
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#000000B3',
      }}
    >
      <box
        style={{
          flexDirection: 'column',
          padding: 2,
          backgroundColor: colors.bg.secondary,
          borderColor: state === 'has-failures' ? colors.status.error : colors.status.warning,
          minWidth: 60,
          maxWidth: 80,
        }}
        border
      >
        {/* Header */}
        <box style={{ marginBottom: 1, justifyContent: 'center' }}>
          <text>
            {state === 'has-failures' ? (
              <span fg={colors.status.error} attributes={boldAttr}>
                {statusIndicators.error} Conflict Resolution Failed
              </span>
            ) : state === 'in-progress' ? (
              <span fg={colors.status.info} attributes={boldAttr}>
                {statusIndicators.merging} AI Resolving Conflicts
              </span>
            ) : (
              <span fg={colors.status.warning} attributes={boldAttr}>
                {statusIndicators.conflicted} Merge Conflict Resolution
              </span>
            )}
          </text>
        </box>

        {/* Task info */}
        <text>
          <span fg={colors.fg.muted}>Task: </span>
          <span fg={colors.fg.secondary}>{taskId}</span>
          <span fg={colors.fg.dim}> — </span>
          <span fg={colors.fg.primary}>{taskTitle}</span>
        </text>

        {/* Summary with progress */}
        <text>
          <span fg={colors.fg.muted}>Files: </span>
          <span fg={colors.status.success}>{resolvedCount}</span>
          <span fg={colors.fg.dim}>/</span>
          <span fg={colors.fg.primary}>{conflicts.length}</span>
          <span fg={colors.fg.muted}> resolved</span>
          {failedCount > 0 && (
            <>
              <span fg={colors.fg.dim}> · </span>
              <span fg={colors.status.error}>{failedCount} failed</span>
            </>
          )}
          {pendingCount > 0 && aiResolving && (
            <>
              <span fg={colors.fg.dim}> · </span>
              <span fg={colors.status.warning}>{pendingCount} pending</span>
            </>
          )}
        </text>

        {/* State-specific status message */}
        {state === 'has-failures' && (
          <box style={{ marginTop: 1, marginBottom: 1 }}>
            <text fg={colors.status.error}>
              AI was unable to resolve all conflicts. Choose an action:
            </text>
          </box>
        )}

        {/* Separator */}
        <text fg={colors.border.muted}>{'─'.repeat(56)}</text>

        {/* Scroll indicator - top */}
        {needsScroll && scrollOffset > 0 && (
          <text fg={colors.fg.dim}>
            {'  '}↑ {scrollOffset} more file{scrollOffset !== 1 ? 's' : ''} above
          </text>
        )}

        {/* Conflicted files list - fixed height with scroll */}
        {visibleConflicts.map((conflict, i) => {
          const absoluteIndex = scrollOffset + i;
          const status = getFileStatus(conflict.filePath, resolutions, currentlyResolvingFile);
          const resolution = resolutions.find((r) => r.filePath === conflict.filePath);
          const { indicator, color, label } = getFileStatusDisplay(status, resolution, spinnerFrame);
          const isSelected = absoluteIndex === selectedIndex;
          const prefix = isSelected ? '▸ ' : '  ';

          return (
            <box key={conflict.filePath} style={{ flexDirection: 'column' }}>
              <text>
                <span fg={isSelected ? colors.fg.primary : colors.fg.dim}>{prefix}</span>
                <span fg={color}>{indicator} </span>
                <span fg={isSelected ? colors.fg.primary : colors.fg.secondary}>{conflict.filePath}</span>
              </text>
              <text>
                <span fg={colors.fg.dim}>    </span>
                <span fg={color}>{label}</span>
              </text>
            </box>
          );
        })}

        {/* Scroll indicator - bottom */}
        {needsScroll && scrollOffset + MAX_VISIBLE_FILES < conflicts.length && (
          <text fg={colors.fg.dim}>
            {'  '}↓ {conflicts.length - scrollOffset - MAX_VISIBLE_FILES} more file
            {conflicts.length - scrollOffset - MAX_VISIBLE_FILES !== 1 ? 's' : ''} below
          </text>
        )}

        {/* Footer with keyboard shortcuts - varies by state */}
        <box style={{ marginTop: 1 }}>
          <text fg={colors.border.muted}>{'─'.repeat(56)}</text>
        </box>

        {state === 'has-failures' ? (
          <>
            {/* Failure state - show retry/skip/abort options */}
            <text>
              {onRetry && (
                <>
                  <span fg={colors.accent.tertiary}>r</span>
                  <span fg={colors.fg.muted}> Retry AI  </span>
                </>
              )}
              {onSkip && (
                <>
                  <span fg={colors.accent.tertiary}>s</span>
                  <span fg={colors.fg.muted}> Skip Task  </span>
                </>
              )}
              <span fg={colors.accent.tertiary}>Esc</span>
              <span fg={colors.fg.muted}> Abort Session</span>
            </text>
            {(onRetry || onSkip) && (
              <text fg={colors.fg.dim}>
                {onRetry && 'Retry: re-attempt AI resolution. '}
                {onSkip && "Skip: abandon this task's merge."}
              </text>
            )}
            {!onRetry && !onSkip && (
              <text fg={colors.fg.dim}>
                Manual resolution: git merge {`<worktree-branch>`} in project dir
              </text>
            )}
          </>
        ) : (
          <>
            {/* Normal state - navigation only */}
            <text>
              <span fg={colors.accent.tertiary}>j/↓</span>
              <span fg={colors.fg.muted}> Down  </span>
              <span fg={colors.accent.tertiary}>k/↑</span>
              <span fg={colors.fg.muted}> Up  </span>
              <span fg={colors.accent.tertiary}>Esc</span>
              <span fg={colors.fg.muted}> Close Panel</span>
            </text>
            <text fg={colors.fg.dim}>
              AI resolution runs automatically. Merge completes when all files resolve.
            </text>
          </>
        )}
      </box>
    </box>
  );
});
