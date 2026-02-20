/**
 * ABOUTME: LeftPanel component for the Ralph TUI.
 * Displays the task list with status indicators (done/active/pending/blocked).
 */

import type { ReactNode } from 'react';
import { memo } from 'react';
import { colors, getTaskStatusColor, getTaskStatusIndicator } from '../theme.js';
import type { LeftPanelProps, TaskItem } from '../types.js';
import { formatTokenCount } from '../utils/token-format.js';

/**
 * Truncate text to fit within a maximum width
 * Adds ellipsis if text is truncated
 */
function truncateText(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, maxWidth);
  return text.slice(0, maxWidth - 1) + '…';
}

/**
 * Compact usage indicator for task list rows.
 * Format: "c62% t15k" (context remaining + total tokens).
 */
function formatTaskUsageIndicator(task: TaskItem): string {
  const usage = task.usage;
  if (!usage) {
    return '';
  }

  const totalTokens =
    usage.totalTokens > 0
      ? usage.totalTokens
      : usage.inputTokens + usage.outputTokens;
  const contextPercent = usage.remainingContextPercent;
  const contextDisplay =
    contextPercent !== undefined ? `${Math.round(contextPercent)}%` : '--';

  return `c${contextDisplay} t${formatTokenCount(totalTokens)}`;
}

/**
 * Single task item row
 * Shows: [indent][status indicator] [task ID] [task title (truncated)]
 * Closed tasks are displayed with greyed-out styling to distinguish historical work
 * Child tasks (those with a parentId) are indented to show hierarchy
 */
function TaskRow({
  task,
  isSelected,
  maxWidth,
  indentLevel = 0,
}: {
  task: TaskItem;
  isSelected: boolean;
  /** Maximum width for the entire row content (for truncation) */
  maxWidth: number;
  /** Indentation level (0 = epic/root, 1 = child of epic) */
  indentLevel?: number;
}): ReactNode {
  const statusColor = getTaskStatusColor(task.status);
  const statusIndicator = getTaskStatusIndicator(task.status);
  const isClosed = task.status === 'closed';

  // Indentation: 2 spaces per level
  const indent = '  '.repeat(indentLevel);

  // Format: "[indent]✓ task-id title"
  // Calculate available width:
  // maxWidth - indent - indicator(1) - space(1) - id - space(1)
  const idDisplay = task.id;
  const indentWidth = indentLevel * 2;
  const usageIndicator = formatTaskUsageIndicator(task);
  const hasUsageIndicator = usageIndicator.length > 0;
  const usageIndicatorWidth = hasUsageIndicator ? usageIndicator.length + 1 : 0;
  const availableForTitle = Math.max(0, maxWidth - indentWidth - 3 - idDisplay.length);
  const minimalTitlePlusIndicator = 5 + usageIndicator.length + 1;
  const shouldShowUsageIndicator =
    hasUsageIndicator && availableForTitle > minimalTitlePlusIndicator;
  const titleWidth = shouldShowUsageIndicator
    ? Math.max(5, availableForTitle - usageIndicatorWidth)
    : Math.max(5, availableForTitle);
  const truncatedTitle = truncateText(task.title, titleWidth);

  // Greyed-out colors for closed tasks
  const idColor = isClosed ? colors.fg.dim : colors.fg.muted;
  const titleColor = isClosed
    ? colors.fg.dim
    : isSelected
      ? colors.fg.primary
      : colors.fg.secondary;

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
        <span fg={colors.fg.dim}>{indent}</span>
        <span fg={statusColor}>{statusIndicator}</span>
        <span fg={idColor}> {idDisplay}</span>
        <span fg={titleColor}> {truncatedTitle}</span>
        {shouldShowUsageIndicator && <span fg={colors.fg.dim}> {usageIndicator}</span>}
      </text>
    </box>
  );
}

/**
 * Build a map of parent IDs to determine indentation levels.
 * Tasks with a parentId that exists in the task list are indented.
 */
function buildIndentMap(tasks: TaskItem[]): Map<string, number> {
  // Create a set of all task IDs for quick lookup
  const taskIds = new Set(tasks.map((t) => t.id));
  const indentMap = new Map<string, number>();

  for (const task of tasks) {
    // If task has a parent that exists in our list, it's indented
    if (task.parentId && taskIds.has(task.parentId)) {
      indentMap.set(task.id, 1);
    } else {
      indentMap.set(task.id, 0);
    }
  }

  return indentMap;
}

/**
 * Connection status for remote instances
 */
type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'reconnecting';

/**
 * LeftPanel component showing the scrollable task list
 * Displays tasks with hierarchical indentation based on parent/child relationships
 * Wrapped in React.memo to prevent re-renders when only sibling state changes (e.g., detailsViewMode)
 */
export const LeftPanel = memo(function LeftPanel({
  tasks,
  selectedIndex,
  width = 45,
  isFocused = true,
  isViewingRemote = false,
  remoteConnectionStatus,
  remoteAlias,
}: LeftPanelProps & {
  width?: number;
  isFocused?: boolean;
  /** Whether currently viewing a remote instance */
  isViewingRemote?: boolean;
  /** Connection status when viewing remote */
  remoteConnectionStatus?: ConnectionStatus;
  /** Alias of the remote being viewed */
  remoteAlias?: string;
}): ReactNode {
  // Calculate max width for task row content (panel width minus padding and border)
  const maxRowWidth = Math.max(20, width - 4);

  // Build indentation map for hierarchical display
  const indentMap = buildIndentMap(tasks);

  return (
    <box
      title="Tasks"
      style={{
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 30,
        maxWidth: 50,
        flexDirection: 'column',
        backgroundColor: colors.bg.primary,
        border: true,
        borderColor: isFocused ? colors.accent.primary : colors.border.normal,
      }}
    >
      <scrollbox
        style={{
          flexGrow: 1,
          width: '100%',
        }}
      >
        {tasks.length === 0 ? (
          <box style={{ padding: 1, flexDirection: 'column' }}>
            {isViewingRemote && remoteConnectionStatus !== 'connected' ? (
              <>
                <text fg={colors.fg.muted}>
                  {remoteConnectionStatus === 'connecting' && 'Connecting...'}
                  {remoteConnectionStatus === 'reconnecting' && 'Reconnecting...'}
                  {remoteConnectionStatus === 'disconnected' && 'Not connected'}
                </text>
                {remoteConnectionStatus === 'disconnected' && remoteAlias && (
                  <text fg={colors.fg.dim}>
                    {'\n'}Remote "{remoteAlias}" is offline
                  </text>
                )}
              </>
            ) : (
              <text fg={colors.fg.muted}>No tasks loaded</text>
            )}
          </box>
        ) : (
          tasks.map((task, index) => (
            <TaskRow
              key={task.id}
              task={task}
              isSelected={index === selectedIndex}
              maxWidth={maxRowWidth}
              indentLevel={indentMap.get(task.id) ?? 0}
            />
          ))
        )}
      </scrollbox>
    </box>
  );
});
