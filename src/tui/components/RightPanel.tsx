/**
 * ABOUTME: RightPanel component for the Ralph TUI.
 * Displays the current iteration details or selected task details.
 * Supports toggling between details view and output view with 'o' key.
 * Includes collapsible subagent sections when subagent tracing is enabled.
 */

import type { ReactNode } from 'react';
import { useMemo, useState, useEffect } from 'react';
import { colors, getTaskStatusColor, getTaskStatusIndicator } from '../theme.js';
import type { RightPanelProps, DetailsViewMode, IterationTimingInfo, SubagentTreeNode, TaskPriority } from '../types.js';
import type { SubagentDetailLevel } from '../../config/types.js';
import { stripAnsiCodes, type FormattedSegment } from '../../plugins/agents/output-formatting.js';
import { formatElapsedTime } from '../theme.js';
import { SubagentSections } from './SubagentSection.js';
import { parseAgentOutput } from '../output-parser.js';

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
 * Shows helpful setup instructions for new users.
 */
function NoSelection(): ReactNode {
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
}: {
  task: NonNullable<RightPanelProps['selectedTask']>;
}): ReactNode {
  const statusColor = getTaskStatusColor(task.status);
  const statusIndicator = getTaskStatusIndicator(task.status);
  // Check metadata for acceptance criteria (JSON tracker stores it there)
  const metadataCriteria = task.metadata?.acceptanceCriteria;
  const criteria = parseAcceptanceCriteria(task.description, undefined, metadataCriteria);
  const cleanDescription = extractDescription(task.description);

  return (
    <box style={{ flexDirection: 'column', padding: 1, flexGrow: 1 }}>
      <scrollbox style={{ flexGrow: 1 }}>
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
          <box style={{ flexDirection: 'row', marginBottom: 0 }}>
            <text fg={colors.fg.muted}>Status: </text>
            <text fg={statusColor}>{task.status}</text>
          </box>

          {/* Priority row */}
          {task.priority !== undefined && (
            <box style={{ flexDirection: 'row', marginBottom: 0 }}>
              <text fg={colors.fg.muted}>Priority: </text>
              <text fg={getPriorityColor(task.priority)}>{priorityLabels[task.priority]}</text>
            </box>
          )}

          {/* Type row */}
          {task.type && (
            <box style={{ flexDirection: 'row', marginBottom: 0 }}>
              <text fg={colors.fg.muted}>Type: </text>
              <text fg={colors.fg.secondary}>{task.type}</text>
            </box>
          )}

          {/* Assignee row */}
          {task.assignee && (
            <box style={{ flexDirection: 'row', marginBottom: 0 }}>
              <text fg={colors.fg.muted}>Assignee: </text>
              <text fg={colors.fg.secondary}>{task.assignee}</text>
            </box>
          )}

          {/* Labels row */}
          {task.labels && task.labels.length > 0 && (
            <box style={{ flexDirection: 'row', marginBottom: 0 }}>
              <text fg={colors.fg.muted}>Labels: </text>
              <text>
                {task.labels.map((label, i) => (
                  <span key={label}>
                    <span fg={colors.accent.secondary}>{label}</span>
                    {i < task.labels!.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </text>
            </box>
          )}

          {/* Iteration row */}
          {task.iteration !== undefined && (
            <box style={{ flexDirection: 'row', marginBottom: 0 }}>
              <text fg={colors.fg.muted}>Iteration: </text>
              <text fg={colors.accent.primary}>{task.iteration}</text>
            </box>
          )}
        </box>

        {/* Description section */}
        {cleanDescription && (
          <box style={{ marginBottom: 1 }}>
            <box style={{ marginBottom: 0 }}>
              <text fg={colors.accent.primary}>Description</text>
            </box>
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
          <box style={{ marginBottom: 1 }}>
            <box style={{ marginBottom: 0 }}>
              <text fg={colors.accent.primary}>Acceptance Criteria</text>
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

        {/* Timestamps */}
        {(task.createdAt || task.updatedAt) && (
          <box style={{ marginTop: 1 }}>
            {task.createdAt && (
              <text fg={colors.fg.dim}>
                Created: {new Date(task.createdAt).toLocaleString()}
              </text>
            )}
            {task.updatedAt && (
              <text fg={colors.fg.dim}>
                {' '}| Updated: {new Date(task.updatedAt).toLocaleString()}
              </text>
            )}
          </box>
        )}
      </scrollbox>
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
  subagentDetailLevel = 'off',
  subagentTree = [],
  collapsedSubagents = new Set(),
  focusedSubagentId,
  onSubagentToggle,
}: {
  task: NonNullable<RightPanelProps['selectedTask']>;
  currentIteration: number;
  iterationOutput?: string;
  iterationSegments?: FormattedSegment[];
  iterationTiming?: IterationTimingInfo;
  agentName?: string;
  currentModel?: string;
  subagentDetailLevel?: SubagentDetailLevel;
  subagentTree?: SubagentTreeNode[];
  collapsedSubagents?: Set<string>;
  focusedSubagentId?: string;
  onSubagentToggle?: (id: string) => void;
}): ReactNode {
  const statusColor = getTaskStatusColor(task.status);
  const statusIndicator = getTaskStatusIndicator(task.status);
  const hasSubagents = subagentTree.length > 0 && subagentDetailLevel !== 'off';

  // Check if we're live streaming
  const isLiveStreaming = iterationTiming?.isRunning === true;

  // For live streaming, prefer segments for TUI-native colors
  // For historical/completed output, parse the string to extract readable content
  // ALWAYS strip ANSI codes - they cause black background artifacts in OpenTUI
  const displayOutput = useMemo(() => {
    if (!iterationOutput) return undefined;
    // For live output during execution, strip ANSI but keep raw content
    if (isLiveStreaming) {
      return stripAnsiCodes(iterationOutput);
    }
    // For completed output (historical or from current session), parse to extract readable content
    // parseAgentOutput already strips ANSI codes
    return parseAgentOutput(iterationOutput, agentName);
  }, [iterationOutput, isLiveStreaming, agentName]);

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

  return (
    <box style={{ flexDirection: 'column', padding: 1, flexGrow: 1 }}>
      {/* Compact task header with agent/model info */}
      <box style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 1 }}>
        <box>
          <text>
            <span fg={statusColor}>{statusIndicator}</span>
            <span fg={colors.fg.primary}> {task.title}</span>
            <span fg={colors.fg.muted}> ({task.id})</span>
          </text>
        </box>
        {(agentName || modelDisplay) && (
          <box style={{ flexDirection: 'row', gap: 1 }}>
            {agentName && <text fg={colors.accent.secondary}>{agentName}</text>}
            {agentName && modelDisplay && <text fg={colors.fg.muted}>|</text>}
            {modelDisplay && (
              <text fg={colors.accent.primary}>{modelDisplay.display}</text>
            )}
          </box>
        )}
      </box>

      {/* Timing summary - shows start/end/duration */}
      <TimingSummary timing={iterationTiming} />

      {/* Subagent sections (when tracing is enabled and subagents exist) */}
      {hasSubagents && (
        <box
          title={`Subagents (${subagentTree.length})`}
          style={{
            marginBottom: 1,
            border: true,
            borderColor: colors.accent.secondary,
            backgroundColor: colors.bg.tertiary,
          }}
        >
          <scrollbox style={{ maxHeight: 10, padding: 1 }}>
            <SubagentSections
              tree={subagentTree}
              collapsedSet={collapsedSubagents}
              focusedId={focusedSubagentId}
              detailLevel={subagentDetailLevel}
              onToggle={onSubagentToggle}
            />
          </scrollbox>
        </box>
      )}

      {/* Full-height iteration output */}
      <box
        title={
          currentIteration === -1
            ? 'Historical Output'
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
        <scrollbox style={{ flexGrow: 1, padding: 1 }}>
          {/* Line-based coloring with tool names in green */}
          {displayOutput !== undefined && displayOutput.length > 0 ? (
            <box style={{ flexDirection: 'column' }}>
              {displayOutput.split('\n').map((line, i) => {
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
          ) : displayOutput === '' ? (
            <text fg={colors.fg.muted}>No output captured</text>
          ) : currentIteration === 0 ? (
            <text fg={colors.fg.muted}>Task not yet executed</text>
          ) : (
            <text fg={colors.fg.muted}>Waiting for output...</text>
          )}
        </scrollbox>
      </box>
    </box>
  );
}

/**
 * Task details view - switches between metadata and output views
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
  subagentDetailLevel,
  subagentTree,
  collapsedSubagents,
  focusedSubagentId,
  onSubagentToggle,
}: {
  task: NonNullable<RightPanelProps['selectedTask']>;
  currentIteration: number;
  iterationOutput?: string;
  iterationSegments?: FormattedSegment[];
  viewMode?: DetailsViewMode;
  iterationTiming?: IterationTimingInfo;
  agentName?: string;
  currentModel?: string;
  subagentDetailLevel?: SubagentDetailLevel;
  subagentTree?: SubagentTreeNode[];
  collapsedSubagents?: Set<string>;
  focusedSubagentId?: string;
  onSubagentToggle?: (id: string) => void;
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
        subagentDetailLevel={subagentDetailLevel}
        subagentTree={subagentTree}
        collapsedSubagents={collapsedSubagents}
        focusedSubagentId={focusedSubagentId}
        onSubagentToggle={onSubagentToggle}
      />
    );
  }

  return <TaskMetadataView task={task} />;
}

/**
 * RightPanel component showing task details or iteration output
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
  subagentDetailLevel = 'off',
  subagentTree,
  collapsedSubagents,
  focusedSubagentId,
  onSubagentToggle,
}: RightPanelProps): ReactNode {
  // Build title with view mode indicator and subagent level
  const modeIndicator = viewMode === 'details' ? '[Details]' : '[Output]';
  const subagentIndicator = subagentDetailLevel !== 'off' ? ` [Trace: ${subagentDetailLevel}]` : '';
  const title = `Details ${modeIndicator}${subagentIndicator}`;

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
          subagentDetailLevel={subagentDetailLevel}
          subagentTree={subagentTree}
          collapsedSubagents={collapsedSubagents}
          focusedSubagentId={focusedSubagentId}
          onSubagentToggle={onSubagentToggle}
        />
      ) : (
        <NoSelection />
      )}
    </box>
  );
}
