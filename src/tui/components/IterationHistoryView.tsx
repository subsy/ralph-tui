/**
 * ABOUTME: IterationHistoryView component for the Ralph TUI.
 * Displays a list of all iterations with status, task, duration, outcome, and subagent summary.
 * Supports keyboard navigation through iterations with Enter to drill into details.
 */

import type { ReactNode } from 'react';
import { colors, formatElapsedTime } from '../theme.js';
import type { IterationResult, IterationStatus } from '../../engine/types.js';
import type { SubagentTraceStats } from '../../logs/types.js';

/**
 * Extended status type that includes 'pending' for display purposes
 * (pending iterations don't have an IterationResult yet)
 */
type DisplayIterationStatus = IterationStatus | 'pending';

/**
 * Status indicator symbols for iterations
 */
const iterationStatusIndicators: Record<DisplayIterationStatus, string> = {
  completed: '✓',
  running: '▶',
  pending: '○',
  failed: '✗',
  interrupted: '⊘',
  skipped: '⊖',
};

/**
 * Status colors for iterations
 */
const iterationStatusColors: Record<DisplayIterationStatus, string> = {
  completed: colors.status.success,
  running: colors.accent.primary,
  pending: colors.fg.muted,
  failed: colors.status.error,
  interrupted: colors.status.warning,
  skipped: colors.fg.dim,
};

/**
 * Get display text for iteration outcome
 */
function getOutcomeText(result: IterationResult, isRunning: boolean): string {
  if (isRunning) return 'Running...';
  if (result.status === 'skipped') return 'Skipped';
  if (result.status === 'interrupted') return 'Interrupted';
  if (result.status === 'failed') return result.error || 'Failed';
  if (result.reviewEnabled) {
    if (result.reviewPassed === true) return 'Review passed';
    if (result.reviewPassed === false) return 'Review failed';
    return 'Review pending';
  }
  // Completed - show if task was completed or just iteration
  if (result.taskCompleted) return result.promiseComplete ? 'Task completed' : 'Success';
  return 'Completed';
}

/**
 * Format subagent summary for display in iteration row.
 * Shows count and failure indicator if any subagents failed.
 * Examples: "3 subagents", "5 subagents ✗1"
 */
function formatSubagentSummary(stats: SubagentTraceStats | undefined): string {
  if (!stats || stats.totalSubagents === 0) return '';

  const count = stats.totalSubagents;
  const label = count === 1 ? 'subagent' : 'subagents';

  if (stats.failureCount > 0) {
    return `${count} ${label} ✗${stats.failureCount}`;
  }

  return `${count} ${label}`;
}

/**
 * Format duration in milliseconds to human-readable format
 */
function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  return formatElapsedTime(seconds);
}

/**
 * Truncate text to fit within max width
 */
function truncateText(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, maxWidth);
  return text.slice(0, maxWidth - 1) + '…';
}

/**
 * Props for the IterationHistoryView component
 */
export interface IterationHistoryViewProps {
  /** List of iteration results to display */
  iterations: IterationResult[];
  /** Total number of iterations (for display like "1 of 10") */
  totalIterations: number;
  /** Currently selected iteration index */
  selectedIndex: number;
  /** Current running iteration number (0 if none running) */
  runningIteration: number;
  /** Callback when Enter is pressed to drill into iteration details */
  onIterationDrillDown?: (iteration: IterationResult) => void;
  /** Width of the component (for truncation calculations) */
  width?: number;
  /** Subagent trace stats per iteration (keyed by iteration number) for summary display */
  subagentStats?: Map<number, SubagentTraceStats>;
}

/**
 * Single iteration row component
 */
function IterationRow({
  result,
  totalIterations,
  isSelected,
  isRunning,
  maxWidth,
  subagentStats,
}: {
  result: IterationResult;
  totalIterations: number;
  isSelected: boolean;
  isRunning: boolean;
  maxWidth: number;
  subagentStats?: SubagentTraceStats;
}): ReactNode {
  // Determine effective display status (override to 'running' if this is the current iteration)
  const effectiveStatus: DisplayIterationStatus = isRunning ? 'running' : result.status;
  const statusIndicator = iterationStatusIndicators[effectiveStatus];
  const statusColor = iterationStatusColors[effectiveStatus];

  // Format: "✓ Iteration 1 of 10  task-id  3 subagents  2m 30s  Success"
  const iterationLabel = `Iteration ${result.iteration} of ${totalIterations}`;
  const taskId = result.task.id;
  const duration = isRunning ? '...' : formatDuration(result.durationMs);
  const outcome = getOutcomeText(result, isRunning);
  const subagentSummary = formatSubagentSummary(subagentStats);
  const hasSubagentFailure = subagentStats && subagentStats.failureCount > 0;

  // Calculate widths for each section
  // Format: [indicator(1)] [iteration label] [task-id] [subagent summary] [duration] [outcome]
  // We'll use fixed widths for some columns and let task-id be flexible
  const durationWidth = 8;
  const outcomeWidth = 14;
  const subagentWidth = subagentSummary ? Math.max(12, subagentSummary.length + 2) : 0;
  const iterationLabelWidth = iterationLabel.length;
  const fixedWidth = 1 + 1 + iterationLabelWidth + 2 + subagentWidth + durationWidth + 2 + outcomeWidth;
  const taskIdWidth = Math.max(8, maxWidth - fixedWidth);
  const truncatedTaskId = truncateText(taskId, taskIdWidth);

  return (
    <box
      style={{
        width: '100%',
        flexDirection: 'row',
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: isSelected ? colors.bg.highlight : 'transparent',
      }}
    >
      <text>
        <span fg={statusColor}>{statusIndicator}</span>
        <span fg={isSelected ? colors.fg.primary : colors.fg.secondary}> {iterationLabel}</span>
        <span fg={colors.fg.muted}>  {truncatedTaskId.padEnd(taskIdWidth)}</span>
        {subagentSummary && (
          <span fg={hasSubagentFailure ? colors.status.error : colors.fg.dim}>
            {'  '}{subagentSummary}
          </span>
        )}
        <span fg={colors.fg.dim}>  {duration.padStart(durationWidth)}</span>
        <span fg={statusColor}>  {truncateText(outcome, outcomeWidth)}</span>
      </text>
    </box>
  );
}

/**
 * IterationHistoryView component showing all iterations with their status
 */
export function IterationHistoryView({
  iterations,
  totalIterations,
  selectedIndex,
  runningIteration,
  width = 80,
  subagentStats,
}: IterationHistoryViewProps): ReactNode {
  // Calculate max width for row content (width minus padding and border)
  const maxRowWidth = Math.max(40, width - 4);

  // Build display list: completed iterations + pending placeholders
  const displayItems: Array<{ type: 'result'; result: IterationResult } | { type: 'pending'; iteration: number }> = [];

  // Add completed/running iterations
  for (const result of iterations) {
    displayItems.push({ type: 'result', result });
  }

  // Add pending placeholders for remaining iterations
  const completedCount = iterations.length;
  for (let i = completedCount + 1; i <= totalIterations; i++) {
    displayItems.push({ type: 'pending', iteration: i });
  }

  return (
    <box
      title="Iterations"
      style={{
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 40,
        maxWidth: 80,
        flexDirection: 'column',
        backgroundColor: colors.bg.primary,
        border: true,
        borderColor: colors.border.normal,
      }}
    >
      <scrollbox
        style={{
          flexGrow: 1,
          width: '100%',
        }}
      >
        {displayItems.length === 0 ? (
          <box style={{ padding: 1 }}>
            <text fg={colors.fg.muted}>No iterations yet</text>
          </box>
        ) : (
          displayItems.map((item, index) => {
            if (item.type === 'result') {
              return (
                <IterationRow
                  key={`iteration-${item.result.iteration}`}
                  result={item.result}
                  totalIterations={totalIterations}
                  isSelected={index === selectedIndex}
                  isRunning={item.result.iteration === runningIteration}
                  maxWidth={maxRowWidth}
                  subagentStats={subagentStats?.get(item.result.iteration)}
                />
              );
            } else {
              // Pending placeholder
              const statusIndicator = iterationStatusIndicators.pending;
              const iterationLabel = `Iteration ${item.iteration} of ${totalIterations}`;

              return (
                <box
                  key={`pending-${item.iteration}`}
                  style={{
                    width: '100%',
                    flexDirection: 'row',
                    paddingLeft: 1,
                    paddingRight: 1,
                    backgroundColor: index === selectedIndex ? colors.bg.highlight : 'transparent',
                  }}
                >
                  <text>
                    <span fg={colors.fg.muted}>{statusIndicator}</span>
                    <span fg={colors.fg.dim}> {iterationLabel}</span>
                    <span fg={colors.fg.dim}>  (pending)</span>
                  </text>
                </box>
              );
            }
          })
        )}
      </scrollbox>
    </box>
  );
}
