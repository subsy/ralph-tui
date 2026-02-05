/**
 * ABOUTME: TaskDetailView component for the Ralph TUI.
 * Displays full task details including description, acceptance criteria,
 * dependencies, and metadata. Supports scrolling for long content.
 */

import type { ReactNode } from 'react';
import { colors, getTaskStatusColor, getTaskStatusIndicator } from '../theme.js';
import { stripAnsiCodes } from '../../plugins/agents/output-formatting.js';
import type { TaskDetailViewProps, TaskPriority } from '../types.js';

/**
 * Priority label mapping for display
 */
const priorityLabels: Record<TaskPriority, string> = {
  0: 'P0 - Critical',
  1: 'P1 - High',
  2: 'P2 - Medium',
  3: 'P3 - Low',
  4: 'P4 - Backlog',
};

/**
 * Get color for priority display
 */
function getPriorityColor(priority: TaskPriority): string {
  switch (priority) {
    case 0:
      return colors.status.error;
    case 1:
      return colors.status.warning;
    case 2:
      return colors.fg.primary;
    case 3:
      return colors.fg.secondary;
    case 4:
      return colors.fg.muted;
  }
}

/**
 * Parse acceptance criteria from description, dedicated field, or metadata array.
 * Looks for markdown checklist items (- [ ] or - [x])
 * JSON tracker stores criteria in metadata.acceptanceCriteria as string array.
 */
function parseAcceptanceCriteria(
  description?: string,
  acceptanceCriteria?: string,
  metadataCriteria?: unknown
): Array<{ text: string; checked: boolean }> {
  // If metadata contains criteria array (from JSON tracker), use that
  if (Array.isArray(metadataCriteria) && metadataCriteria.length > 0) {
    return metadataCriteria
      .filter((c): c is string => typeof c === 'string')
      .map((text) => ({ text, checked: false }));
  }

  const content = acceptanceCriteria || description || '';
  const lines = content.split('\n');
  const criteria: Array<{ text: string; checked: boolean }> = [];

  // Look for acceptance criteria section
  let inCriteriaSection = false;

  for (const line of lines) {
    // Check for section header
    if (line.toLowerCase().includes('acceptance criteria')) {
      inCriteriaSection = true;
      continue;
    }

    // Parse checklist items (anywhere in content if no section, or only in section)
    const checkboxMatch = line.match(/^\s*-\s*\[([ xX])\]\s*(.+)$/);
    if (checkboxMatch) {
      criteria.push({
        checked: checkboxMatch[1].toLowerCase() === 'x',
        text: checkboxMatch[2].trim(),
      });
    }

    // Also accept bullet points in the criteria section
    if (inCriteriaSection) {
      const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
      if (bulletMatch && !checkboxMatch) {
        criteria.push({
          checked: false,
          text: bulletMatch[1].trim(),
        });
      }
    }
  }

  return criteria;
}

/**
 * Extract description without acceptance criteria section
 */
function extractDescription(description?: string): string {
  if (!description) return '';

  const lines = description.split('\n');
  const result: string[] = [];
  let inCriteriaSection = false;

  for (const line of lines) {
    if (line.toLowerCase().includes('acceptance criteria')) {
      inCriteriaSection = true;
      continue;
    }

    // Stop including lines once we hit the acceptance criteria section
    // unless we encounter another section header
    if (inCriteriaSection && line.match(/^#+\s/)) {
      inCriteriaSection = false;
    }

    if (!inCriteriaSection) {
      result.push(line);
    }
  }

  return result.join('\n').trim();
}

/**
 * Section header component for consistent styling
 */
function SectionHeader({ title }: { title: string }): ReactNode {
  return (
    <box style={{ marginBottom: 1 }}>
      <text fg={colors.accent.primary}>
        {title}
      </text>
    </box>
  );
}

/**
 * Metadata row component for label/value pairs
 */
function MetadataRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string | ReactNode;
  valueColor?: string;
}): ReactNode {
  return (
    <box style={{ flexDirection: 'row', marginBottom: 0, width: '100%', backgroundColor: colors.bg.secondary }}>
      <text fg={colors.fg.muted}>{label}:</text>
      {typeof value === 'string' ? (
        <text fg={valueColor || colors.fg.secondary}>{` ${value}`}</text>
      ) : (
        value
      )}
    </box>
  );
}

/**
 * TaskDetailView component showing comprehensive task details.
 * Note: onBack is provided for API completeness but navigation is handled
 * by keyboard (Esc key) in the parent component.
 */
export function TaskDetailView({ task, onBack: _onBack }: TaskDetailViewProps): ReactNode {
  const statusColor = getTaskStatusColor(task.status);
  const statusIndicator = getTaskStatusIndicator(task.status);
  const sanitizeMetadataValue = (value?: string): string | undefined => {
    if (!value) return undefined;
    const cleaned = stripAnsiCodes(value)
      .replace(/\p{C}/gu, '')
      .trim();
    return cleaned.length > 0 ? cleaned : undefined;
  };
  const formatTimestamp = (value?: string): string | undefined => {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  };
  const displayType = sanitizeMetadataValue(task.type);
  const displayAssignee = sanitizeMetadataValue(task.assignee);
  const displayLabels = task.labels
    ? task.labels
      .map((label) => sanitizeMetadataValue(label))
      .filter((label): label is string => Boolean(label))
    : [];
  const displayCreatedAt = formatTimestamp(task.createdAt);
  const displayUpdatedAt = formatTimestamp(task.updatedAt);
  // Check metadata for acceptance criteria (JSON tracker stores it there)
  const metadataCriteria = task.metadata?.acceptanceCriteria;
  const criteria = parseAcceptanceCriteria(task.description, undefined, metadataCriteria);
  const cleanDescription = extractDescription(task.description);

  return (
    <box
      title={`Task Details [Esc to go back]`}
      style={{
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        backgroundColor: colors.bg.primary,
        border: true,
        borderColor: colors.border.active,
      }}
    >
      <scrollbox style={{ flexGrow: 1, padding: 1 }}>
        {/* Task title and ID */}
        <box style={{ marginBottom: 1 }}>
          <text>
            <span fg={statusColor}>{statusIndicator}</span>
            <span fg={colors.fg.primary}>
              {' '}
              {task.title}
            </span>
          </text>
        </box>

        <box style={{ marginBottom: 2 }}>
          <text fg={colors.fg.muted}>ID: {task.id}</text>
        </box>

        {/* Metadata section */}
        <box style={{ marginBottom: 2 }}>
          <SectionHeader title="Metadata" />
          <box
            style={{
              padding: 1,
              backgroundColor: colors.bg.secondary,
              border: true,
              borderColor: colors.border.muted,
            }}
          >
            <MetadataRow label="Status" value={task.status} valueColor={statusColor} />

            {task.priority !== undefined && (
              <MetadataRow
                label="Priority"
                value={priorityLabels[task.priority]}
                valueColor={getPriorityColor(task.priority)}
              />
            )}

            {displayType && <MetadataRow label="Type" value={displayType} />}

            {displayAssignee && <MetadataRow label="Assignee" value={displayAssignee} />}

            {displayLabels.length > 0 && (
              <MetadataRow
                label="Labels"
                value={
                  <text>
                    {' '}
                    {displayLabels.map((label, i) => (
                      <span key={`${label}-${i}`}>
                        <span fg={colors.accent.secondary}>{label}</span>
                        {i < displayLabels.length - 1 ? ', ' : ''}
                      </span>
                    ))}
                  </text>
                }
              />
            )}

            {task.iteration !== undefined && (
              <MetadataRow
                label="Iteration"
                value={task.iteration.toString()}
                valueColor={colors.accent.primary}
              />
            )}

            {displayCreatedAt && <MetadataRow label="Created" value={displayCreatedAt} valueColor={colors.fg.dim} />}
            {displayUpdatedAt && <MetadataRow label="Updated" value={displayUpdatedAt} valueColor={colors.fg.dim} />}
          </box>
        </box>

        {/* Description section */}
        {cleanDescription && (
          <box style={{ marginBottom: 2 }}>
            <SectionHeader title="Description" />
            <box
              style={{
                padding: 1,
                backgroundColor: colors.bg.tertiary,
                border: true,
                borderColor: colors.border.muted,
              }}
            >
              <text fg={colors.fg.secondary}>{cleanDescription}</text>
            </box>
          </box>
        )}

        {/* Acceptance criteria section */}
        {criteria.length > 0 && (
          <box style={{ marginBottom: 2 }}>
            <SectionHeader title="Acceptance Criteria" />
            <box
              style={{
                padding: 1,
                backgroundColor: colors.bg.secondary,
                border: true,
                borderColor: colors.border.muted,
                flexDirection: 'column',
              }}
            >
              {criteria.map((item, index) => (
                <box key={index} style={{ flexDirection: 'row', marginBottom: 0 }}>
                  <text>
                    <span fg={item.checked ? colors.status.success : colors.fg.muted}>
                      {item.checked ? '[x]' : '[ ]'}
                    </span>
                    <span fg={item.checked ? colors.fg.muted : colors.fg.secondary}>
                      {' '}
                      {item.text}
                    </span>
                  </text>
                </box>
              ))}
            </box>
          </box>
        )}

        {/* Dependencies section */}
        {((task.dependsOn && task.dependsOn.length > 0) ||
          (task.blocks && task.blocks.length > 0) ||
          (task.blockedByTasks && task.blockedByTasks.length > 0)) && (
          <box style={{ marginBottom: 2 }}>
            <SectionHeader title="Dependencies" />
            <box
              style={{
                padding: 1,
                backgroundColor: colors.bg.secondary,
                border: true,
                borderColor: colors.border.muted,
                flexDirection: 'column',
              }}
            >
              {/* Show detailed blocker info if available (with title and status) */}
              {task.blockedByTasks && task.blockedByTasks.length > 0 && (
                <box style={{ marginBottom: 1 }}>
                  <text fg={colors.status.error}>⊘ Blocked by (unresolved):</text>
                  {task.blockedByTasks.map((blocker) => (
                    <text key={blocker.id} fg={colors.fg.secondary}>
                      {'  '}- {blocker.id}: {blocker.title}
                      <span fg={colors.fg.muted}> [{blocker.status}]</span>
                    </text>
                  ))}
                </box>
              )}

              {/* Fallback to dependsOn IDs if blockedByTasks not available */}
              {(!task.blockedByTasks || task.blockedByTasks.length === 0) &&
                task.dependsOn && task.dependsOn.length > 0 && (
                <box style={{ marginBottom: 1 }}>
                  <text fg={colors.status.warning}>Depends on:</text>
                  {task.dependsOn.map((dep) => (
                    <text key={dep} fg={colors.fg.secondary}>
                      {'  '}- {dep}
                    </text>
                  ))}
                </box>
              )}

              {task.blocks && task.blocks.length > 0 && (
                <box>
                  <text fg={colors.accent.tertiary}>Blocks:</text>
                  {task.blocks.map((dep) => (
                    <text key={dep} fg={colors.fg.secondary}>
                      {'  '}- {dep}
                    </text>
                  ))}
                </box>
              )}
            </box>
          </box>
        )}

        {/* Completion notes section */}
        {task.closeReason && (
          <box style={{ marginBottom: 2 }}>
            <SectionHeader title="Completion Notes" />
            <box
              style={{
                padding: 1,
                backgroundColor: colors.bg.tertiary,
                border: true,
                borderColor: colors.status.success,
              }}
            >
              <text fg={colors.fg.secondary}>{task.closeReason}</text>
            </box>
          </box>
        )}

      </scrollbox>
    </box>
  );
}
