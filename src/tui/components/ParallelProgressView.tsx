/**
 * ABOUTME: Worker overview panel for parallel execution TUI.
 * Displays all active workers, their progress, and the merge queue status
 * in a compact left-panel view.
 */

import type { ReactNode } from 'react';
import { memo } from 'react';
import { createTextAttributes } from '@opentui/core';
import { colors, statusIndicators, formatElapsedTime } from '../theme.js';
import type { WorkerDisplayState, MergeOperation } from '../../parallel/types.js';

const boldAttr = createTextAttributes({ bold: true });

export interface ParallelProgressViewProps {
  /** Active and recently completed workers */
  workers: WorkerDisplayState[];
  /** Current merge queue */
  mergeQueue: MergeOperation[];
  /** Current group index (0-based) */
  currentGroup: number;
  /** Total number of groups */
  totalGroups: number;
  /** Available width for rendering */
  maxWidth: number;
  /** Currently selected worker index (-1 = none) */
  selectedWorkerIndex: number;
}

/**
 * Get the status indicator and color for a worker.
 */
function getWorkerStatusDisplay(status: WorkerDisplayState['status']): {
  indicator: string;
  color: string;
} {
  switch (status) {
    case 'running':
      return { indicator: statusIndicators.active, color: colors.status.success };
    case 'completed':
      return { indicator: statusIndicators.done, color: colors.task.done };
    case 'failed':
      return { indicator: statusIndicators.error, color: colors.status.error };
    case 'cancelled':
      return { indicator: statusIndicators.stopped, color: colors.fg.muted };
    case 'idle':
    default:
      return { indicator: statusIndicators.pending, color: colors.fg.dim };
  }
}

/**
 * Get the status indicator for a merge operation.
 */
function getMergeStatusDisplay(status: MergeOperation['status']): {
  indicator: string;
  color: string;
  label: string;
} {
  switch (status) {
    case 'queued':
      return { indicator: statusIndicators.queued, color: colors.fg.muted, label: 'queued' };
    case 'in-progress':
      return { indicator: statusIndicators.merging, color: colors.status.info, label: 'merging...' };
    case 'completed':
      return { indicator: statusIndicators.merged, color: colors.status.success, label: 'merged' };
    case 'conflicted':
      return { indicator: statusIndicators.conflicted, color: colors.status.warning, label: 'conflicted' };
    case 'failed':
      return { indicator: statusIndicators.error, color: colors.status.error, label: 'failed' };
    case 'rolled-back':
      return { indicator: statusIndicators.rolledBack, color: colors.status.warning, label: 'rolled back' };
  }
}

/**
 * Single worker row showing status, progress, and task title.
 */
function WorkerRow({
  worker,
  index,
  isSelected,
  maxWidth,
}: {
  worker: WorkerDisplayState;
  index: number;
  isSelected: boolean;
  maxWidth: number;
}): ReactNode {
  const { indicator, color: statusColor } = getWorkerStatusDisplay(worker.status);
  const progress = `[${worker.currentIteration}/${worker.maxIterations}]`;
  const elapsed = worker.elapsedMs > 0 ? formatElapsedTime(Math.floor(worker.elapsedMs / 1000)) : '';

  const prefix = `${indicator} W${index + 1} ${progress} `;
  const suffix = elapsed ? ` ${elapsed}` : '';
  const titleWidth = maxWidth - prefix.length - suffix.length;
  const title = worker.task.title.length > titleWidth
    ? worker.task.title.slice(0, titleWidth - 1) + '…'
    : worker.task.title;

  const titleColor = isSelected ? colors.fg.primary : colors.fg.secondary;

  return (
    <text>
      <span fg={statusColor}>{indicator}</span>
      <span fg={colors.fg.muted}> W{index + 1} </span>
      <span fg={colors.fg.dim}>{progress} </span>
      <span fg={titleColor}>{title}</span>
      {suffix && <span fg={colors.fg.dim}>{suffix}</span>}
    </text>
  );
}

/**
 * Merge queue entry showing merge status.
 */
function MergeRow({
  operation,
  maxWidth,
}: {
  operation: MergeOperation;
  maxWidth: number;
}): ReactNode {
  const { indicator, color: mergeColor, label } = getMergeStatusDisplay(operation.status);
  const taskId = operation.workerResult.task.id;

  const line = `${indicator} ${taskId} → main  ${label}`;

  return (
    <text fg={mergeColor}>{line.slice(0, maxWidth)}</text>
  );
}

/**
 * Parallel progress view showing all workers and merge queue.
 */
export const ParallelProgressView = memo(function ParallelProgressView({
  workers,
  mergeQueue,
  currentGroup,
  totalGroups,
  maxWidth,
  selectedWorkerIndex,
}: ParallelProgressViewProps): ReactNode {
  const activeMerges = mergeQueue.filter(
    (op) => op.status !== 'completed' || Date.now() - new Date(op.completedAt ?? 0).getTime() < 5000
  );

  return (
    <box flexDirection="column" width={maxWidth}>
      {/* Header */}
      <text>
        <span fg={colors.accent.primary} attributes={boldAttr}>{statusIndicators.worker} Workers ({workers.length})</span>
        <span fg={colors.fg.dim}> Group {currentGroup + 1}/{totalGroups}</span>
      </text>

      {/* Worker list */}
      {workers.map((worker, i) => (
        <WorkerRow
          key={worker.id}
          worker={worker}
          index={i}
          isSelected={i === selectedWorkerIndex}
          maxWidth={maxWidth - 2}
        />
      ))}

      {/* Merge queue separator */}
      {activeMerges.length > 0 && (
        <>
          <text fg={colors.fg.dim}>─── Merge Queue ───</text>
          {activeMerges.map((op) => (
            <MergeRow key={op.id} operation={op} maxWidth={maxWidth - 2} />
          ))}
        </>
      )}
    </box>
  );
});
