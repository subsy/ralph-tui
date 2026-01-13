/**
 * ABOUTME: WorktreeMergeCard displays a single worktree's merge status.
 * Shows branch name, task info, status indicator, and progress for each worktree.
 */

import type { ReactNode } from 'react';
import { colors } from '../theme.js';
import type { WorktreeMergeCardProps } from '../merge-progress-types.js';
import {
  getMergeStatusColor,
  getMergeStatusIndicator,
  getMergeStatusLabel,
  formatMergeDuration,
} from '../merge-progress-types.js';

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '\u2026';
}

export function WorktreeMergeCard({
  progress,
  isSelected,
  compact = false,
}: WorktreeMergeCardProps): ReactNode {
  const statusColor = getMergeStatusColor(progress.status);
  const statusIndicator = getMergeStatusIndicator(progress.status);
  const statusLabel = getMergeStatusLabel(progress.status);
  const durationText = formatMergeDuration(progress.durationMs);

  const bgColor = isSelected ? colors.bg.highlight : colors.bg.secondary;
  const borderColor = isSelected ? colors.border.active : colors.border.normal;

  const conflictIndicator = progress.conflictingFiles && progress.conflictingFiles.length > 0
    ? ` (${progress.conflictingFiles.length} files)`
    : '';

  if (compact) {
    return (
      <box
        style={{
          flexDirection: 'row',
          backgroundColor: bgColor,
          padding: 0,
        }}
      >
        <text>
          <span fg={statusColor}>{statusIndicator}</span>
          <span fg={colors.fg.muted}> {truncate(progress.branchName, 20)}</span>
          <span fg={colors.fg.secondary}> {truncate(progress.taskTitle ?? progress.taskId ?? '', 20)}</span>
          <span fg={statusColor}> {statusLabel}</span>
        </text>
      </box>
    );
  }

  return (
    <box
      style={{
        flexDirection: 'column',
        backgroundColor: bgColor,
        border: true,
        borderColor,
        padding: 1,
        marginBottom: 1,
      }}
    >
      <box style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <text>
          <span fg={statusColor}>{statusIndicator}</span>
          <span fg={colors.accent.secondary}> {truncate(progress.branchName, 30)}</span>
          {progress.taskId && (
            <span fg={colors.fg.muted}> [{progress.taskId}]</span>
          )}
        </text>
        <text fg={colors.fg.muted}>{durationText}</text>
      </box>

      {progress.taskTitle && (
        <box style={{ flexDirection: 'row' }}>
          <text fg={colors.fg.primary}>{truncate(progress.taskTitle, 50)}</text>
        </box>
      )}

      <box style={{ flexDirection: 'row', gap: 1 }}>
        <text fg={statusColor}>
          {statusLabel}{conflictIndicator}
        </text>
        {progress.status === 'complete' && progress.mergeCommitSha && (
          <text fg={colors.fg.dim}> {progress.mergeCommitSha.slice(0, 7)}</text>
        )}
        {progress.status === 'error' && progress.error && (
          <text fg={colors.status.error}> {truncate(progress.error, 40)}</text>
        )}
      </box>

      {progress.status === 'conflict' && progress.aiResolution && (
        <box style={{ flexDirection: 'row', marginTop: 1 }}>
          <text>
            <span fg={colors.fg.muted}>AI Resolution: </span>
            <span fg={colors.accent.tertiary}>
              {progress.aiResolution.stats.autoResolved}/{progress.aiResolution.stats.totalFiles} auto-resolved
            </span>
            {progress.aiResolution.stats.pendingUserInput > 0 && (
              <span fg={colors.status.warning}>
                {' '}{progress.aiResolution.stats.pendingUserInput} pending
              </span>
            )}
          </text>
        </box>
      )}

      <box style={{ flexDirection: 'row' }}>
        <text fg={colors.fg.dim}>
          {progress.index}/{progress.total}
        </text>
      </box>
    </box>
  );
}
