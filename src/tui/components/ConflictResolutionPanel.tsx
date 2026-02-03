/**
 * ABOUTME: Conflict resolution overlay for parallel execution merge conflicts.
 * Displays conflicting files with AI resolution status and provides keyboard
 * controls for accepting, rejecting, or aborting conflict resolution.
 * Follows the same overlay pattern as HelpOverlay.
 */

import type { ReactNode } from 'react';
import { memo } from 'react';
import { createTextAttributes } from '@opentui/core';
import { colors, statusIndicators } from '../theme.js';
import type { FileConflict, ConflictResolutionResult } from '../../parallel/types.js';

const boldAttr = createTextAttributes({ bold: true });

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
  /** Index of the file currently selected */
  selectedIndex: number;
}

/**
 * Get resolution status for a specific file.
 */
function getFileStatus(
  filePath: string,
  resolutions: ConflictResolutionResult[],
  aiResolving: boolean,
): { indicator: string; color: string; label: string } {
  const resolution = resolutions.find((r) => r.filePath === filePath);
  if (resolution) {
    if (resolution.success) {
      return {
        indicator: statusIndicators.merged,
        color: colors.status.success,
        label: `Resolved (${resolution.method})`,
      };
    }
    return {
      indicator: statusIndicators.error,
      color: colors.status.error,
      label: resolution.error ?? 'Resolution failed',
    };
  }
  if (aiResolving) {
    return {
      indicator: statusIndicators.merging,
      color: colors.status.info,
      label: 'AI resolving...',
    };
  }
  return {
    indicator: statusIndicators.conflicted,
    color: colors.status.warning,
    label: 'Unresolved',
  };
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
  selectedIndex,
}: ConflictResolutionPanelProps): ReactNode {
  if (!visible) {
    return null;
  }

  const resolvedCount = resolutions.filter((r) => r.success).length;
  const failedCount = resolutions.filter((r) => !r.success).length;

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
          borderColor: colors.status.warning,
          minWidth: 60,
          maxWidth: 80,
        }}
        border
      >
        {/* Header */}
        <box style={{ marginBottom: 1, justifyContent: 'center' }}>
          <text>
            <span fg={colors.status.warning} attributes={boldAttr}>{statusIndicators.conflicted} Merge Conflict Resolution</span>
          </text>
        </box>

        {/* Task info */}
        <text>
          <span fg={colors.fg.muted}>Task: </span>
          <span fg={colors.fg.secondary}>{taskId}</span>
          <span fg={colors.fg.dim}> — </span>
          <span fg={colors.fg.primary}>{taskTitle}</span>
        </text>

        {/* Summary */}
        <text>
          <span fg={colors.fg.muted}>Files: </span>
          <span fg={colors.fg.primary}>{conflicts.length} conflicted</span>
          {resolvedCount > 0 && <span fg={colors.status.success}>, {resolvedCount} resolved</span>}
          {failedCount > 0 && <span fg={colors.status.error}>, {failedCount} failed</span>}
        </text>

        {/* AI status */}
        {aiResolving && (
          <text fg={colors.status.info}>
            {statusIndicators.merging} AI conflict resolution in progress...
          </text>
        )}

        {/* Separator */}
        <text fg={colors.border.muted}>{'─'.repeat(56)}</text>

        {/* Conflicted files list */}
        {conflicts.map((conflict, i) => {
          const { indicator, color, label } = getFileStatus(conflict.filePath, resolutions, aiResolving);
          const isSelected = i === selectedIndex;
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

        {/* Footer with keyboard shortcuts */}
        <box style={{ marginTop: 1 }}>
          <text fg={colors.border.muted}>{'─'.repeat(56)}</text>
        </box>
        <text>
          <span fg={colors.accent.tertiary}>a</span>
          <span fg={colors.fg.muted}> Accept  </span>
          <span fg={colors.accent.tertiary}>r</span>
          <span fg={colors.fg.muted}> Reject  </span>
          <span fg={colors.accent.tertiary}>A</span>
          <span fg={colors.fg.muted}> Accept All  </span>
          <span fg={colors.accent.tertiary}>Esc</span>
          <span fg={colors.fg.muted}> Abort + Rollback</span>
        </text>
      </box>
    </box>
  );
});
