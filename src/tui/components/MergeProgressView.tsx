/**
 * ABOUTME: Merge queue monitoring panel for parallel execution TUI.
 * Displays the merge queue status, backup tags, and per-operation progress
 * during the sequential merge phase of parallel execution.
 */

import type { ReactNode } from 'react';
import { memo } from 'react';
import { createTextAttributes } from '@opentui/core';
import { colors, statusIndicators, formatElapsedTime } from '../theme.js';
import type { MergeOperation } from '../../parallel/types.js';

const boldAttr = createTextAttributes({ bold: true });

export interface MergeProgressViewProps {
  /** All merge operations in the queue */
  mergeQueue: MergeOperation[];
  /** Session backup tag (for full rollback) */
  sessionBackupTag?: string;
  /** Available width for rendering */
  maxWidth: number;
  /** Available height for rendering */
  maxHeight: number;
}

/**
 * Get status display info for a merge operation.
 */
function getMergeDisplay(status: MergeOperation['status']): {
  indicator: string;
  color: string;
  label: string;
} {
  switch (status) {
    case 'queued':
      return { indicator: statusIndicators.queued, color: colors.fg.muted, label: 'Queued' };
    case 'in-progress':
      return { indicator: statusIndicators.merging, color: colors.status.info, label: 'Merging...' };
    case 'completed':
      return { indicator: statusIndicators.merged, color: colors.status.success, label: 'Merged' };
    case 'conflicted':
      return { indicator: statusIndicators.conflicted, color: colors.status.warning, label: 'Conflicted' };
    case 'failed':
      return { indicator: statusIndicators.error, color: colors.status.error, label: 'Failed' };
    case 'rolled-back':
      return { indicator: statusIndicators.rolledBack, color: colors.status.warning, label: 'Rolled Back' };
  }
}

/**
 * Compute elapsed time for a merge operation.
 */
function getMergeElapsed(op: MergeOperation): string {
  if (!op.startedAt) return '';
  const start = new Date(op.startedAt).getTime();
  const end = op.completedAt ? new Date(op.completedAt).getTime() : Date.now();
  const seconds = Math.floor((end - start) / 1000);
  return formatElapsedTime(seconds);
}

/**
 * Single merge operation row.
 */
function MergeOperationRow({
  operation,
  maxWidth,
}: {
  operation: MergeOperation;
  maxWidth: number;
}): ReactNode {
  const { indicator, color, label } = getMergeDisplay(operation.status);
  const elapsed = getMergeElapsed(operation);
  const taskId = operation.workerResult.task.id;
  const taskTitle = operation.workerResult.task.title;

  // Build the line: indicator taskId → main  label  elapsed
  const prefix = `${indicator} `;
  const arrow = ' → main  ';
  const suffix = elapsed ? `  ${elapsed}` : '';
  const fixedLen = prefix.length + taskId.length + arrow.length + label.length + suffix.length;
  const titleSpace = maxWidth - fixedLen - 2;
  const title = titleSpace > 3
    ? (taskTitle.length > titleSpace ? taskTitle.slice(0, titleSpace - 1) + '…' : taskTitle)
    : '';

  return (
    <box style={{ flexDirection: 'column' }}>
      <text>
        <span fg={color}>{indicator} </span>
        <span fg={colors.fg.secondary}>{taskId}</span>
        <span fg={colors.fg.dim}>{arrow}</span>
        <span fg={color}>{label}</span>
        {suffix && <span fg={colors.fg.dim}>{suffix}</span>}
      </text>
      {title && (
        <text>
          <span fg={colors.fg.dim}>  </span>
          <span fg={colors.fg.muted}>{title}</span>
        </text>
      )}
      {operation.status === 'conflicted' && operation.conflictedFiles && (
        <text>
          <span fg={colors.status.warning}>  {statusIndicators.conflicted} {operation.conflictedFiles.length} conflicting file{operation.conflictedFiles.length > 1 ? 's' : ''}</span>
        </text>
      )}
      {operation.status === 'failed' && operation.error && (
        <text>
          <span fg={colors.status.error}>  {maxWidth > 4 ? operation.error.slice(0, maxWidth - 4) : ''}</span>
        </text>
      )}
    </box>
  );
}

/**
 * Merge progress view showing the full merge queue and rollback info.
 */
export const MergeProgressView = memo(function MergeProgressView({
  mergeQueue,
  sessionBackupTag,
  maxWidth,
  maxHeight,
}: MergeProgressViewProps): ReactNode {
  const completed = mergeQueue.filter((op) => op.status === 'completed').length;
  const failed = mergeQueue.filter((op) => op.status === 'failed' || op.status === 'rolled-back').length;
  const inProgress = mergeQueue.filter((op) => op.status === 'in-progress').length;
  const conflicted = mergeQueue.filter((op) => op.status === 'conflicted').length;

  // Reserve header lines
  const headerLines = 4;
  const availableHeight = Math.max(1, maxHeight - headerLines);

  // Show the most relevant operations (in-progress first, then queued, then completed)
  const prioritized = [...mergeQueue].sort((a, b) => {
    const order: Record<MergeOperation['status'], number> = {
      'in-progress': 0,
      'conflicted': 1,
      'queued': 2,
      'failed': 3,
      'rolled-back': 4,
      'completed': 5,
    };
    return order[a.status] - order[b.status];
  });

  const visible = prioritized.slice(0, availableHeight);

  return (
    <box flexDirection="column" width={maxWidth}>
      {/* Header */}
      <text>
        <span fg={colors.accent.primary} attributes={boldAttr}>{statusIndicators.merging} Merge Queue</span>
        <span fg={colors.fg.dim}> ({completed}/{mergeQueue.length} merged</span>
        {failed > 0 && <span fg={colors.status.error}>, {failed} failed</span>}
        {conflicted > 0 && <span fg={colors.status.warning}>, {conflicted} conflicted</span>}
        {inProgress > 0 && <span fg={colors.status.info}>, {inProgress} merging</span>}
        <span fg={colors.fg.dim}>)</span>
      </text>

      {/* Session backup tag */}
      {sessionBackupTag && (
        <text>
          <span fg={colors.fg.muted}>Backup: </span>
          <span fg={colors.fg.dim}>{sessionBackupTag}</span>
        </text>
      )}

      {/* Separator */}
      <text fg={colors.border.muted}>{'─'.repeat(Math.min(maxWidth, 60))}</text>

      {/* Merge operations */}
      {visible.map((op) => (
        <MergeOperationRow
          key={op.id}
          operation={op}
          maxWidth={maxWidth - 2}
        />
      ))}

      {/* Overflow indicator */}
      {prioritized.length > availableHeight && (
        <text fg={colors.fg.dim}>
          ... {prioritized.length - availableHeight} more
        </text>
      )}
    </box>
  );
});
