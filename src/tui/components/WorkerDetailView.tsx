/**
 * ABOUTME: Drill-down view for a single parallel worker.
 * Shows the worker's task details, agent output stream, and progress.
 * Reuses output display patterns from the existing RightPanel.
 */

import type { ReactNode } from 'react';
import { memo } from 'react';
import { createTextAttributes } from '@opentui/core';
import { colors, statusIndicators, formatElapsedTime } from '../theme.js';
import type { WorkerDisplayState } from '../../parallel/types.js';

const boldAttr = createTextAttributes({ bold: true });

export interface WorkerDetailViewProps {
  /** Worker to display details for */
  worker: WorkerDisplayState;
  /** Worker index (0-based, for display as W1, W2, etc.) */
  workerIndex: number;
  /** Recent output lines from this worker */
  outputLines: string[];
  /** Available width for rendering */
  maxWidth: number;
  /** Available height for rendering */
  maxHeight: number;
}

/**
 * Detail view for a single worker, showing task info and agent output.
 */
export const WorkerDetailView = memo(function WorkerDetailView({
  worker,
  workerIndex,
  outputLines,
  maxWidth,
  maxHeight,
}: WorkerDetailViewProps): ReactNode {
  const statusColor =
    worker.status === 'running'
      ? colors.status.success
      : worker.status === 'completed'
        ? colors.task.done
        : worker.status === 'failed'
          ? colors.status.error
          : colors.fg.muted;

  const statusText =
    worker.status === 'running'
      ? `${statusIndicators.active} Running`
      : worker.status === 'completed'
        ? `${statusIndicators.done} Completed`
        : worker.status === 'failed'
          ? `${statusIndicators.error} Failed`
          : `${statusIndicators.pending} ${worker.status}`;

  const elapsed = worker.elapsedMs > 0
    ? formatElapsedTime(Math.floor(worker.elapsedMs / 1000))
    : '0s';

  // Reserve lines for header info (title, task, progress/git, worktree path, separator)
  // With worktreePath: title(1) + task(1) + progress(1) + worktree(1) + separator(1) = 5
  // Without worktreePath: title(1) + task(1) + progress(1) + separator(1) = 4
  const headerLines = worker.worktreePath ? 5 : 4;
  const outputHeight = Math.max(1, maxHeight - headerLines);

  // Take the last N output lines that fit
  const visibleOutput = outputLines.slice(-outputHeight);

  return (
    <box flexDirection="column" width={maxWidth}>
      {/* Worker header */}
      <text>
        <span fg={colors.accent.primary} attributes={boldAttr}>{statusIndicators.worker} Worker W{workerIndex + 1}</span>
        <span fg={statusColor}> {statusText}</span>
        <span fg={colors.fg.dim}> {elapsed}</span>
      </text>

      {/* Task info */}
      <text>
        <span fg={colors.fg.muted}>Task: </span>
        <span fg={colors.fg.secondary}>{worker.task.id}</span>
        <span fg={colors.fg.dim}> — </span>
        <span fg={colors.fg.primary}>{worker.task.title}</span>
      </text>

      {/* Progress and git info */}
      <text>
        <span fg={colors.fg.muted}>Iteration </span>
        <span fg={colors.fg.secondary}>{worker.currentIteration}/{worker.maxIterations}</span>
        {worker.branchName && (
          <>
            <span fg={colors.fg.dim}> │ </span>
            <span fg={colors.fg.muted}>Branch: </span>
            <span fg={colors.accent.secondary}>{worker.branchName}</span>
          </>
        )}
        {worker.commitSha && (
          <>
            <span fg={colors.fg.dim}> │ </span>
            <span fg={colors.fg.muted}>Commit: </span>
            <span fg={colors.status.success}>{worker.commitSha}</span>
          </>
        )}
      </text>

      {/* Worktree path */}
      {worker.worktreePath && (
        <text>
          <span fg={colors.fg.muted}>Worktree: </span>
          <span fg={colors.fg.dim}>{worker.worktreePath}</span>
        </text>
      )}

      {/* Separator */}
      <text fg={colors.border.muted}>{'─'.repeat(Math.min(maxWidth, 60))}</text>

      {/* Agent output */}
      {visibleOutput.map((line, i) => (
        <text key={i} fg={colors.fg.secondary}>
          {line.length > maxWidth ? line.slice(0, maxWidth - 1) + '…' : line}
        </text>
      ))}
    </box>
  );
});
