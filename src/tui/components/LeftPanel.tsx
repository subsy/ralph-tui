/**
 * ABOUTME: LeftPanel component for the Ralph TUI.
 * Displays the task list with status indicators (done/active/pending/blocked).
 */

import type { ReactNode } from 'react';
import { memo } from 'react';
import {
  colors,
  getTaskStatusColor,
  getTaskStatusIndicator,
} from '../theme.js';
import type { LeftPanelProps, TaskItem } from '../types.js';

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
  // Calculate available width: maxWidth - indent - indicator(1) - space(1) - id - space(1)
  const idDisplay = task.id;
  const indentWidth = indentLevel * 2;
  const titleWidth = maxWidth - indentWidth - 3 - idDisplay.length;
  const truncatedTitle = truncateText(task.title, Math.max(5, titleWidth));

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
 * LeftPanel component showing the scrollable task list
 * Displays tasks with hierarchical indentation based on parent/child relationships
 * Wrapped in React.memo to prevent re-renders when only sibling state changes (e.g., detailsViewMode)
 */
export const LeftPanel = memo(function LeftPanel({
  tasks,
  selectedIndex,
  width = 45,
}: LeftPanelProps & { width?: number }): ReactNode {
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
        borderColor: colors.border.normal,
      }}
    >
      <scrollbox
        style={{
          flexGrow: 1,
          width: '100%',
        }}
      >
        {tasks.length === 0 ? (
          <box style={{ padding: 1 }}>
            <text fg={colors.fg.muted}>No tasks loaded</text>
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
