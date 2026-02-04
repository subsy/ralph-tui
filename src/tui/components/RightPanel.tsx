/**
 * ABOUTME: RightPanel component for the Ralph TUI.
 * Displays the current iteration details or selected task details.
 * Supports toggling between details view and output view with 'o' key.
 * Includes collapsible subagent sections when subagent tracing is enabled.
 */

import type { ReactNode } from 'react';
import { useMemo, useState, useEffect } from 'react';
import { useTerminalDimensions } from '@opentui/react';
import { colors, getTaskStatusColor, getTaskStatusIndicator } from '../theme.js';
import type { RightPanelProps, DetailsViewMode, IterationTimingInfo, TaskPriority } from '../types.js';
import { stripAnsiCodes, type FormattedSegment } from '../../plugins/agents/output-formatting.js';
import { formatElapsedTime } from '../theme.js';
import { parseAgentOutput } from '../output-parser.js';

/**
 * Divider to separate reviewer output in logs (matches engine constant).
 */
const REVIEW_OUTPUT_DIVIDER = '\n\n===== REVIEW OUTPUT =====\n';

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
 * Format an ISO 8601 timestamp to a human-readable time string.
 * Returns time in HH:MM:SS format.
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Display when no task is selected.
 * Shows connection status for remote instances, or setup instructions for local.
 */
function NoSelection({
  isViewingRemote = false,
  remoteConnectionStatus,
  remoteAlias,
}: {
  isViewingRemote?: boolean;
  remoteConnectionStatus?: 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
  remoteAlias?: string;
}): ReactNode {
  // Show connection-specific help for remote instances
  if (isViewingRemote && remoteConnectionStatus !== 'connected') {
    return (
      <box
        style={{
          flexGrow: 1,
          flexDirection: 'column',
          padding: 2,
        }}
      >
        <box style={{ marginBottom: 1 }}>
          <text fg={colors.status.warning}>
            {remoteConnectionStatus === 'connecting' && '◐ Connecting...'}
            {remoteConnectionStatus === 'reconnecting' && '⟳ Reconnecting...'}
            {remoteConnectionStatus === 'disconnected' && '○ Not Connected'}
          </text>
        </box>

        {remoteConnectionStatus === 'disconnected' && (
          <>
            <box style={{ marginBottom: 2 }}>
              <text fg={colors.fg.secondary}>
                Remote "{remoteAlias}" is not connected.
              </text>
            </box>
            <box style={{ flexDirection: 'column', gap: 1 }}>
              <text fg={colors.fg.muted}>Possible causes:</text>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>•</span> Remote server is not running
              </text>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>•</span> Network connectivity issues
              </text>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>•</span> Incorrect host/port configuration
              </text>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>•</span> Authentication token mismatch
              </text>
            </box>
            <box style={{ marginTop: 2, flexDirection: 'column', gap: 1 }}>
              <text fg={colors.fg.muted}>Try:</text>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>•</span> Press{' '}
                <span fg={colors.fg.secondary}>[</span> or{' '}
                <span fg={colors.fg.secondary}>]</span> to switch tabs
              </text>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>•</span> Press{' '}
                <span fg={colors.fg.secondary}>e</span> to edit remote config
              </text>
              <text fg={colors.fg.muted}>
                <span fg={colors.accent.primary}>•</span> Press{' '}
                <span fg={colors.fg.secondary}>x</span> to delete this remote
              </text>
            </box>
          </>
        )}

        {(remoteConnectionStatus === 'connecting' || remoteConnectionStatus === 'reconnecting') && (
          <box style={{ marginTop: 1 }}>
            <text fg={colors.fg.muted}>
              Attempting to connect to {remoteAlias}...
            </text>
          </box>
        )}
      </box>
    );
  }

  // Default: show setup instructions for local instance
  return (
    <box
      style={{
        flexGrow: 1,
        flexDirection: 'column',
        padding: 2,
      }}
    >
      <box style={{ marginBottom: 1 }}>
        <text fg={colors.fg.primary}>Getting Started</text>
      </box>
      <box style={{ marginBottom: 2 }}>
        <text fg={colors.fg.secondary}>
          No tasks available. To start working with Ralph:
        </text>
      </box>
      <box style={{ flexDirection: 'column', gap: 1 }}>
        <text fg={colors.fg.muted}>
          <span fg={colors.accent.primary}>1.</span> Run{' '}
          <span fg={colors.fg.secondary}>ralph-tui setup</span> to configure your project
        </text>
        <text fg={colors.fg.muted}>
          <span fg={colors.accent.primary}>2.</span> Run{' '}
          <span fg={colors.fg.secondary}>ralph-tui run</span> to start execution
        </text>
        <text fg={colors.fg.muted}>
          <span fg={colors.accent.primary}>3.</span> Or run{' '}
          <span fg={colors.fg.secondary}>ralph-tui --help</span> for more options
        </text>
      </box>
      <box style={{ marginTop: 2 }}>
        <text fg={colors.fg.dim}>Press 'q' or Esc to quit</text>
      </box>
    </box>
  );
}

/**
 * Full task details view - shows comprehensive task information including
 * metadata, description, acceptance criteria, dependencies, and timestamps.
 * This replaces the previous minimal TaskMetadataView.
 */
function TaskMetadataView({
  task,
  isFocused = false,
}: {
  task: NonNullable<RightPanelProps['selectedTask']>;
  isFocused?: boolean;
}): ReactNode {
  const { width } = useTerminalDimensions();
  const statusColor = getTaskStatusColor(task.status);
  const statusIndicator = getTaskStatusIndicator(task.status);
  const sanitizeMetadataValue = (value?: string): string | undefined => {
    if (!value) return undefined;
    const cleaned = stripAnsiCodes(value)
      .replace(/\p{C}/gu, '')
      .replace(/\x1b./g, '')
      .replace(/[\x00-\x1F\x7F]/g, '')
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
  const metadataRowStyle = {
    flexDirection: 'row',
    marginBottom: 0,
    width: '100%',
    backgroundColor: colors.bg.secondary,
  } as const;
  // Check metadata for acceptance criteria (JSON tracker stores it there)
  const metadataCriteria = task.metadata?.acceptanceCriteria;
  const criteria = parseAcceptanceCriteria(task.description, undefined, metadataCriteria);
  const cleanDescription = extractDescription(task.description);

  // Responsive layout: side-by-side on wide screens (>= 160 cols), stacked on narrow
  const useWideLayout = width >= 160;

  return (
    <box style={{ flexDirection: 'column', padding: 1, flexGrow: 1 }}>
      {/* Task title and status */}
      <box style={{ marginBottom: 1 }}>
        <text>
          <span fg={statusColor}>{statusIndicator}</span>
          <span fg={colors.fg.primary}> {task.title}</span>
        </text>
      </box>

      {/* Task ID */}
      <box style={{ marginBottom: 1 }}>
        <text fg={colors.fg.muted}>ID: {task.id}</text>
      </box>

      {/* Metadata section - compact row of key info */}
      <box
        style={{
          marginBottom: 1,
          padding: 1,
          backgroundColor: colors.bg.secondary,
          border: true,
          borderColor: colors.border.muted,
          flexDirection: 'column',
        }}
      >
          {/* Status row */}
          <box style={metadataRowStyle}>
            <text fg={colors.fg.muted}>Status:</text>
            <text fg={statusColor}>{` ${task.status}`}</text>
          </box>

          {/* Priority row */}
          {task.priority !== undefined && (
            <box style={metadataRowStyle}>
              <text fg={colors.fg.muted}>Priority:</text>
              <text fg={getPriorityColor(task.priority)}>{` ${priorityLabels[task.priority]}`}</text>
            </box>
          )}

          {/* Type row */}
          {displayType && (
            <box style={metadataRowStyle}>
              <text fg={colors.fg.muted}>Type:</text>
              <text fg={colors.fg.secondary}>{` ${displayType}`}</text>
            </box>
          )}

          {/* Assignee row */}
          {displayAssignee && (
            <box style={metadataRowStyle}>
              <text fg={colors.fg.muted}>Assignee:</text>
              <text fg={colors.fg.secondary}>{` ${displayAssignee}`}</text>
            </box>
          )}

          {/* Labels row */}
          {displayLabels.length > 0 && (
            <box style={metadataRowStyle}>
              <text fg={colors.fg.muted}>Labels:</text>
              <text>
                {' '}
                {displayLabels.map((label, i) => (
                  <span key={label}>
                    <span fg={colors.accent.secondary}>{label}</span>
                    {i < displayLabels.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </text>
            </box>
          )}

          {/* Iteration row */}
          {task.iteration !== undefined && (
            <box style={metadataRowStyle}>
              <text fg={colors.fg.muted}>Iteration:</text>
              <text fg={colors.accent.primary}>{` ${task.iteration}`}</text>
            </box>
          )}

          {/* Timestamp rows */}
          {displayCreatedAt && (
            <box style={metadataRowStyle}>
              <text fg={colors.fg.muted}>Created:</text>
              <text fg={colors.fg.dim}>{` ${displayCreatedAt}`}</text>
            </box>
          )}
          {displayUpdatedAt && (
            <box style={metadataRowStyle}>
              <text fg={colors.fg.muted}>Updated:</text>
              <text fg={colors.fg.dim}>{` ${displayUpdatedAt}`}</text>
            </box>
          )}
        </box>

      {/* Responsive layout for Description and Acceptance Criteria */}
      {(cleanDescription || criteria.length > 0) && (
        <box style={{ flexGrow: 1, flexDirection: useWideLayout ? 'row' : 'column', gap: 1, marginBottom: 1 }}>
          {/* Description section - scrollable and focusable */}
          {cleanDescription && (
            <box style={{ flexGrow: 1, flexBasis: 0, flexDirection: 'column' }}>
              <box style={{ marginBottom: 0 }}>
                <text fg={colors.accent.primary}>Description</text>
              </box>
              <box
                style={{
                  flexGrow: 1,
                  border: true,
                  borderColor: isFocused ? colors.accent.primary : colors.border.muted,
                  backgroundColor: colors.bg.tertiary,
                }}
              >
                <scrollbox style={{ flexGrow: 1, padding: 1 }} focused={isFocused}>
                  <text fg={colors.fg.secondary}>{cleanDescription}</text>
                </scrollbox>
              </box>
            </box>
          )}

          {/* Acceptance criteria section */}
          {criteria.length > 0 && (
            <box style={{ flexGrow: 1, flexBasis: 0, flexDirection: 'column' }}>
              <box style={{ marginBottom: 0 }}>
                <text fg={colors.accent.primary}>Acceptance Criteria</text>
              </box>
              <box
                style={{
                  flexGrow: 1,
                  padding: 1,
                  backgroundColor: colors.bg.secondary,
                  border: true,
                  borderColor: colors.border.muted,
                  flexDirection: 'column',
                }}
              >
                <scrollbox style={{ flexGrow: 1 }}>
                  <box style={{ flexDirection: 'column' }}>
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
                </scrollbox>
              </box>
            </box>
          )}
        </box>
      )}

        {/* Dependencies section */}
        {((task.dependsOn && task.dependsOn.length > 0) ||
          (task.blocks && task.blocks.length > 0) ||
          (task.blockedByTasks && task.blockedByTasks.length > 0)) && (
          <box style={{ marginBottom: 1 }}>
            <box style={{ marginBottom: 0 }}>
              <text fg={colors.accent.primary}>Dependencies</text>
            </box>
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
          <box style={{ marginBottom: 1 }}>
            <box style={{ marginBottom: 0 }}>
              <text fg={colors.accent.primary}>Completion Notes</text>
            </box>
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

    </box>
  );
}

/**
 * Timing summary component for the output view
 * Shows started time immediately, duration that updates every second while running,
 * and ended time when complete. Also displays model info when available.
 */
function TimingSummary({ timing }: { timing?: IterationTimingInfo }): ReactNode {
  // Track elapsed time for running iterations
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  useEffect(() => {
    if (!timing?.isRunning || !timing?.startedAt) {
      return;
    }

    // Calculate initial elapsed time
    const startTime = new Date(timing.startedAt).getTime();
    const updateElapsed = () => {
      setElapsedMs(Date.now() - startTime);
    };

    // Update immediately
    updateElapsed();

    // Update every second
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [timing?.isRunning, timing?.startedAt]);

  if (!timing || (!timing.startedAt && !timing.isRunning)) {
    return null;
  }

  // Calculate duration for display
  let durationDisplay: string;
  if (timing.isRunning && timing.startedAt) {
    // Show live elapsed time
    const durationSeconds = Math.floor(elapsedMs / 1000);
    durationDisplay = formatElapsedTime(durationSeconds);
  } else if (timing.durationMs !== undefined) {
    const durationSeconds = Math.floor(timing.durationMs / 1000);
    durationDisplay = formatElapsedTime(durationSeconds);
  } else {
    durationDisplay = '—';
  }

  // Parse model info for display
  const modelDisplay = timing.model
    ? (() => {
        const [provider, model] = timing.model!.includes('/') ? timing.model!.split('/') : ['', timing.model!];
        return { provider, model, full: timing.model!, display: provider ? `${provider}/${model}` : model };
      })()
    : null;

  return (
    <box
      style={{
        marginBottom: 1,
        padding: 1,
        border: true,
        borderColor: colors.border.muted,
        backgroundColor: colors.bg.tertiary,
      }}
    >
      {/* Model info row - show when model is available */}
      {modelDisplay && (
        <box style={{ flexDirection: 'row', marginBottom: 1 }}>
          <text fg={colors.fg.muted}>Model: </text>
          <text fg={colors.accent.primary}>{modelDisplay.display}</text>
        </box>
      )}
      {/* Timing info row */}
      <box style={{ flexDirection: 'row', gap: 3 }}>
        <text fg={colors.fg.muted}>
          Started:{' '}
          <span fg={colors.fg.secondary}>
            {timing.startedAt ? formatTimestamp(timing.startedAt) : '—'}
          </span>
        </text>
        <text fg={colors.fg.muted}>
          Ended:{' '}
          <span fg={colors.fg.secondary}>
            {timing.endedAt ? formatTimestamp(timing.endedAt) : '—'}
          </span>
        </text>
        <text fg={colors.fg.muted}>
          Duration:{' '}
          <span fg={timing.isRunning ? colors.status.info : colors.accent.primary}>
            {durationDisplay}
          </span>
        </text>
      </box>
    </box>
  );
}

/**
 * Prompt preview view - shows the full rendered prompt that will be sent to the agent.
 * Displays the template source indicator and scrollable prompt content.
 *
 * Note: This shows a "point-in-time" preview - dynamic content like progress.md
 * may change before the actual prompt is sent during execution.
 */
/**
 * Simplifies template source labels for display
 * - "tracker:beads-bv" -> "tracker:beads-bv"
 * - "global:/path" -> "global"
 * - "project:/path" -> "project"
 * - "builtin" -> "builtin"
 * - "/full/path" -> "cli"
 */
function simplifyTemplateSource(source: string | undefined): string {
  if (!source) return 'unknown';

  // Handle prefixed sources
  if (source.startsWith('tracker:')) return source;
  if (source.startsWith('global:')) return 'global';
  if (source.startsWith('project:')) return 'project';
  if (source === 'builtin') return 'builtin';

  // Absolute path without prefix = CLI argument
  if (source.startsWith('/')) return 'cli';

  return source;
}

/**
 * Renders highlighted prompt text with syntax highlighting
 */
function renderPromptText(promptText: string): ReactNode {
  return (
    <box style={{ flexDirection: 'column' }}>
      {promptText.split('\n').map((line, i) => {
        // Highlight markdown headers
        if (line.match(/^#+\s/)) {
          return (
            <text key={i} fg={colors.accent.primary}>
              {line}
            </text>
          );
        }
        // Highlight bullet points
        if (line.match(/^\s*[-*]\s/)) {
          return (
            <text key={i} fg={colors.fg.secondary}>
              {line}
            </text>
          );
        }
        // Highlight code fences
        if (line.match(/^```/)) {
          return (
            <text key={i} fg={colors.accent.tertiary}>
              {line}
            </text>
          );
        }
        // Regular text
        return (
          <text key={i} fg={colors.fg.secondary}>
            {line}
          </text>
        );
      })}
    </box>
  );
}

function PromptPreviewView({
  task,
  promptPreview,
  templateSource,
  reviewPromptPreview,
  reviewTemplateSource,
  outputFocus,
}: {
  task: NonNullable<RightPanelProps['selectedTask']>;
  promptPreview?: string;
  templateSource?: string;
  reviewPromptPreview?: string;
  reviewTemplateSource?: string;
  outputFocus?: 'worker' | 'reviewer' | 'content';
}): ReactNode {
  const { width } = useTerminalDimensions();
  const statusColor = getTaskStatusColor(task.status);
  const statusIndicator = getTaskStatusIndicator(task.status);
  const hasReviewPrompt = Boolean(reviewPromptPreview);

  // When review is enabled, focus is either 'worker' or 'reviewer'
  // When review is disabled, focus is 'content' (which applies to worker only)
  const workerFocused = outputFocus === 'worker' || (!hasReviewPrompt && outputFocus === 'content');
  const reviewerFocused = outputFocus === 'reviewer';

  // Responsive layout: side-by-side on wide screens (>= 160 cols), stacked on narrow
  const useWideLayout = width >= 160;

  return (
    <box style={{ flexDirection: 'column', padding: 1, flexGrow: 1 }}>
      {/* Compact task header with template source */}
      <box style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1 }}>
        <box>
          <text>
            <span fg={statusColor}>{statusIndicator}</span>
            <span fg={colors.fg.primary}> {task.title}</span>
            <span fg={colors.fg.muted}> ({task.id})</span>
          </text>
        </box>
        <box style={{ flexDirection: 'row', gap: 1 }}>
          {templateSource && (
            <text fg={colors.accent.secondary}>worker:{simplifyTemplateSource(templateSource)}</text>
          )}
          {hasReviewPrompt && reviewTemplateSource && (
            <text fg={colors.accent.tertiary}> reviewer:{simplifyTemplateSource(reviewTemplateSource)}</text>
          )}
        </box>
      </box>

      {/* Dynamic content notice */}
      <box
        style={{
          marginBottom: 1,
          padding: 1,
          border: true,
          borderColor: colors.status.warning,
          backgroundColor: colors.bg.tertiary,
        }}
      >
        <text fg={colors.status.warning}>
          ⚠ Preview only - dynamic content may change before execution
        </text>
      </box>

      {/* Split or single prompt preview */}
      {hasReviewPrompt ? (
        // Responsive split view: side-by-side on wide screens, stacked on narrow
        <box style={{ flexGrow: 1, flexDirection: useWideLayout ? 'row' : 'column', gap: 1 }}>
          {/* Worker prompt */}
          <box
            style={{
              flexGrow: 1,
              flexBasis: 0,
              border: true,
              borderColor: workerFocused ? colors.accent.primary : colors.border.muted,
              backgroundColor: colors.bg.secondary,
            }}
          >
            <box style={{ padding: 1, backgroundColor: colors.bg.tertiary }}>
              <text fg={colors.fg.primary}>WORKER PROMPT</text>
            </box>
            <scrollbox style={{ flexGrow: 1, padding: 1 }} focused={workerFocused}>
              {promptPreview ? (
                renderPromptText(promptPreview)
              ) : (
                <text fg={colors.fg.muted}>No worker prompt</text>
              )}
            </scrollbox>
          </box>

          {/* Reviewer prompt */}
          <box
            style={{
              flexGrow: 1,
              flexBasis: 0,
              border: true,
              borderColor: reviewerFocused ? colors.accent.primary : colors.border.muted,
              backgroundColor: colors.bg.secondary,
            }}
          >
            <box style={{ padding: 1, backgroundColor: colors.bg.tertiary }}>
              <text fg={colors.accent.primary}>REVIEWER PROMPT</text>
            </box>
            <scrollbox style={{ flexGrow: 1, padding: 1 }} focused={reviewerFocused}>
              {reviewPromptPreview ? (
                renderPromptText(reviewPromptPreview)
              ) : (
                <text fg={colors.fg.muted}>Loading review prompt...</text>
              )}
            </scrollbox>
          </box>
        </box>
      ) : (
        // Single view: Worker prompt only
        <box
          title="Worker Prompt"
          style={{
            flexGrow: 1,
            border: true,
            borderColor: workerFocused ? colors.accent.primary : colors.border.muted,
            backgroundColor: colors.bg.secondary,
          }}
        >
          <scrollbox style={{ flexGrow: 1, padding: 1 }} focused={workerFocused}>
            {promptPreview ? (
              renderPromptText(promptPreview)
            ) : (
              <text fg={colors.fg.muted}>
                Cycle views with 'o' or press Shift+O for prompt preview
              </text>
            )}
          </scrollbox>
        </box>
      )}
    </box>
  );
}

/**
 * Task output view - shows full-height scrollable iteration output
 * with optional collapsible subagent sections
 */
function TaskOutputView({
  task,
  currentIteration,
  iterationOutput,
  iterationSegments,
  iterationTiming,
  agentName,
  currentModel,
  reviewerAgent,
  outputFocus,
}: {
  task: NonNullable<RightPanelProps['selectedTask']>;
  currentIteration: number;
  iterationOutput?: string;
  iterationSegments?: FormattedSegment[];
  iterationTiming?: IterationTimingInfo;
  agentName?: string;
  currentModel?: string;
  reviewerAgent?: string;
  outputFocus?: 'worker' | 'reviewer';
}): ReactNode {
  const { width } = useTerminalDimensions();
  const statusColor = getTaskStatusColor(task.status);
  const statusIndicator = getTaskStatusIndicator(task.status);

  // Responsive layout: side-by-side on wide screens (>= 160 cols), stacked on narrow
  const useWideLayout = width >= 160;

  // Check if we're live streaming
  const isLiveStreaming = iterationTiming?.isRunning === true;

  // Check if output actually has reviewer section
  const hasReviewOutput = iterationOutput?.includes(REVIEW_OUTPUT_DIVIDER) ?? false;

  // Treat divider presence as implicit signal to keep split layout
  // This preserves historical reviewer output even if review is currently disabled
  const isReviewEnabled = (reviewerAgent !== undefined && reviewerAgent !== '') || hasReviewOutput;

  // For live streaming, prefer segments for TUI-native colors
  // For historical/completed output, parse the string to extract readable content
  // ALWAYS strip ANSI codes - they cause black background artifacts in OpenTUI
  const { workerOutput, reviewerOutput } = useMemo(() => {
    if (!iterationOutput) return { workerOutput: undefined, reviewerOutput: undefined };

    // Split worker and reviewer on first divider only to avoid content loss
    const dividerIndex = hasReviewOutput
      ? iterationOutput.indexOf(REVIEW_OUTPUT_DIVIDER)
      : -1;
    const worker = dividerIndex >= 0
      ? iterationOutput.slice(0, dividerIndex)
      : iterationOutput;
    const reviewer = dividerIndex >= 0
      ? iterationOutput.slice(dividerIndex + REVIEW_OUTPUT_DIVIDER.length)
      : undefined;

    // For live output during execution, strip ANSI but keep raw content
    if (isLiveStreaming) {
      return {
        workerOutput: stripAnsiCodes(worker),
        reviewerOutput: reviewer ? stripAnsiCodes(reviewer) : undefined,
      };
    }

    // For completed output (historical or from current session), parse to extract readable content
    // parseAgentOutput already strips ANSI codes
    return {
      workerOutput: parseAgentOutput(worker, agentName),
      reviewerOutput: reviewer ? parseAgentOutput(reviewer, reviewerAgent) : undefined,
    };
  }, [iterationOutput, isLiveStreaming, agentName, reviewerAgent, hasReviewOutput]);

  // Note: Full segment-based coloring (FormattedText) disabled due to OpenTUI
  // span rendering issues causing black backgrounds and character loss.
  // Using simple line-based coloring for tool calls instead.
  void iterationSegments;

  // Parse model info for display
  const modelDisplay = currentModel
    ? (() => {
        const [provider, model] = currentModel.includes('/') ? currentModel.split('/') : ['', currentModel];
        return { provider, model, full: currentModel, display: provider ? `${provider}/${model}` : model };
      })()
    : null;

  // Helper to render output lines with tool name highlighting
  const renderOutputLines = (output: string | undefined) => {
    if (!output || output.length === 0) return null;

    return (
      <box style={{ flexDirection: 'column' }}>
        {output.split('\n').map((line, i) => {
          // Check if line starts with [toolname] pattern
          const toolMatch = line.match(/^(\[[\w-]+\])(.*)/);
          if (toolMatch) {
            const [, toolName, rest] = toolMatch;
            return (
              <box key={i} style={{ flexDirection: 'row' }}>
                <text fg={colors.status.success}>{toolName}</text>
                <text fg={colors.fg.secondary}>{rest}</text>
              </box>
            );
          }
          return (
            <text key={i} fg={colors.fg.secondary}>
              {line}
            </text>
          );
        })}
      </box>
    );
  };

  return (
    <box style={{ flexDirection: 'column', padding: 1, flexGrow: 1 }}>
      {/* Compact task header - only show task title and status */}
      <box style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1 }}>
        <box>
          <text>
            <span fg={statusColor}>{statusIndicator}</span>
            <span fg={colors.fg.primary}> {task.title}</span>
            <span fg={colors.fg.muted}> ({task.id})</span>
          </text>
        </box>
        {/* Show model info on the right */}
        {modelDisplay && (
          <text fg={colors.accent.primary}>{modelDisplay.display}</text>
        )}
      </box>

      {/* Timing summary - shows start/end/duration */}
      <TimingSummary timing={iterationTiming} />

      {/* Split output sections when review is enabled - responsive layout */}
      {isReviewEnabled ? (
        <box style={{ flexDirection: useWideLayout ? 'row' : 'column', flexGrow: 1, gap: 1 }}>
          {/* Worker output section */}
          <box
            style={{
              flexGrow: 1,
              flexBasis: 0,
              flexDirection: 'column',
              border: true,
              borderColor: outputFocus === 'worker' ? colors.accent.primary : colors.border.muted,
              backgroundColor: colors.bg.secondary,
            }}
          >
            <box style={{ paddingLeft: 1, paddingRight: 1, paddingBottom: 0 }}>
              <text>
                <span fg={colors.fg.secondary}>Worker: </span>
                <span fg={colors.fg.primary}>{agentName || 'agent'}</span>
                {currentIteration > 0 && (
                  <span fg={colors.fg.muted}> (Iteration {currentIteration})</span>
                )}
              </text>
            </box>
            <scrollbox
              style={{ flexGrow: 1, padding: 1 }}
              stickyScroll={isLiveStreaming}
              stickyStart="bottom"
              focused={outputFocus === 'worker'}
            >
              {workerOutput !== undefined && workerOutput.length > 0 ? (
                renderOutputLines(workerOutput)
              ) : (
                <text fg={colors.fg.muted}>No worker output yet...</text>
              )}
            </scrollbox>
          </box>

          {/* Reviewer output section */}
          <box
            style={{
              flexGrow: 1,
              flexBasis: 0,
              flexDirection: 'column',
              border: true,
              borderColor: outputFocus === 'reviewer' ? colors.accent.primary : colors.border.muted,
              backgroundColor: colors.bg.secondary,
            }}
          >
            <box style={{ paddingLeft: 1, paddingRight: 1, paddingBottom: 0 }}>
              <text>
                <span fg={colors.fg.secondary}>Reviewer: </span>
                <span fg={colors.fg.primary}>{reviewerAgent || 'reviewer'}</span>
              </text>
            </box>
            <scrollbox
              style={{ flexGrow: 1, padding: 1 }}
              stickyScroll={isLiveStreaming}
              stickyStart="bottom"
              focused={outputFocus === 'reviewer'}
            >
              {reviewerOutput !== undefined && reviewerOutput.length > 0 ? (
                renderOutputLines(reviewerOutput)
              ) : (
                <text fg={colors.fg.muted}>
                  {isLiveStreaming ? 'Waiting for reviewer...' : 'No reviewer output captured'}
                </text>
              )}
            </scrollbox>
          </box>
        </box>
      ) : (
        /* Single output section when no review */
        <box
          title={
            currentIteration === -1
              ? 'Output'
              : currentIteration > 0
                ? `Iteration ${currentIteration}`
                : 'Output'
          }
          style={{
            flexGrow: 1,
            border: true,
            borderColor: colors.border.normal,
            backgroundColor: colors.bg.secondary,
          }}
        >
          <scrollbox style={{ flexGrow: 1, padding: 1 }} stickyScroll={isLiveStreaming} stickyStart="bottom">
            {workerOutput !== undefined && workerOutput.length > 0 ? (
              renderOutputLines(workerOutput)
            ) : workerOutput === '' ? (
              <text fg={colors.fg.muted}>No output captured</text>
            ) : currentIteration === 0 ? (
              <text fg={colors.fg.muted}>Task not yet executed</text>
            ) : (
              <text fg={colors.fg.muted}>Waiting for output...</text>
            )}
          </scrollbox>
        </box>
      )}
    </box>
  );
}

/**
 * Task details view - switches between metadata, output, and prompt views
 */
function TaskDetails({
  task,
  currentIteration,
  iterationOutput,
  iterationSegments,
  viewMode = 'details',
  iterationTiming,
  agentName,
  currentModel,
  reviewerAgent,
  promptPreview,
  templateSource,
  reviewPromptPreview,
  reviewTemplateSource,
  outputFocus,
}: {
  task: NonNullable<RightPanelProps['selectedTask']>;
  currentIteration: number;
  iterationOutput?: string;
  iterationSegments?: FormattedSegment[];
  viewMode?: DetailsViewMode;
  iterationTiming?: IterationTimingInfo;
  agentName?: string;
  currentModel?: string;
  reviewerAgent?: string;
  promptPreview?: string;
  templateSource?: string;
  reviewPromptPreview?: string;
  reviewTemplateSource?: string;
  outputFocus?: 'worker' | 'reviewer' | 'content';
}): ReactNode {
  if (viewMode === 'output') {
    return (
      <TaskOutputView
        task={task}
        currentIteration={currentIteration}
        iterationOutput={iterationOutput}
        iterationSegments={iterationSegments}
        iterationTiming={iterationTiming}
        agentName={agentName}
        currentModel={currentModel}
        reviewerAgent={reviewerAgent}
        outputFocus={outputFocus === 'worker' || outputFocus === 'reviewer' ? outputFocus : undefined}
      />
    );
  }

  if (viewMode === 'prompt') {
    return (
      <PromptPreviewView
        task={task}
        promptPreview={promptPreview}
        templateSource={templateSource}
        reviewPromptPreview={reviewPromptPreview}
        reviewTemplateSource={reviewTemplateSource}
        outputFocus={outputFocus}
      />
    );
  }

  return <TaskMetadataView task={task} isFocused={outputFocus === 'content'} />;
}

/**
 * RightPanel component showing task details, iteration output, or prompt preview
 */
export function RightPanel({
  selectedTask,
  currentIteration,
  iterationOutput,
  iterationSegments,
  viewMode = 'details',
  iterationTiming,
  agentName,
  currentModel,
  reviewerAgent,
  promptPreview,
  templateSource,
  reviewPromptPreview,
  reviewTemplateSource,
  isViewingRemote = false,
  remoteConnectionStatus,
  remoteAlias,
  outputFocus,
}: RightPanelProps): ReactNode {
  // Build title with view mode indicator
  const modeIndicators: Record<typeof viewMode, string> = {
    details: '[Details]',
    output: '[Output]',
    prompt: '[Prompt]',
  };
  const modeIndicator = modeIndicators[viewMode];
  const title = `Details ${modeIndicator}`;

  return (
    <box
      title={title}
      style={{
        flexGrow: 2,
        flexShrink: 1,
        minWidth: 40,
        flexDirection: 'column',
        backgroundColor: colors.bg.primary,
        border: true,
        borderColor: colors.border.normal,
      }}
    >
      {selectedTask ? (
        <TaskDetails
          task={selectedTask}
          currentIteration={currentIteration}
          iterationOutput={iterationOutput}
          iterationSegments={iterationSegments}
          viewMode={viewMode}
          iterationTiming={iterationTiming}
          agentName={agentName}
          currentModel={currentModel}
          reviewerAgent={reviewerAgent}
          promptPreview={promptPreview}
          templateSource={templateSource}
          reviewPromptPreview={reviewPromptPreview}
          reviewTemplateSource={reviewTemplateSource}
          outputFocus={outputFocus}
        />
      ) : (
        <NoSelection
          isViewingRemote={isViewingRemote}
          remoteConnectionStatus={remoteConnectionStatus}
          remoteAlias={remoteAlias}
        />
      )}
    </box>
  );
}
