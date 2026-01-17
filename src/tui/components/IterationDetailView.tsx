/**
 * ABOUTME: IterationDetailView component for the Ralph TUI.
 * Displays detailed information about a single iteration including
 * status, timing, events timeline, subagent tree, and scrollable agent output with syntax highlighting.
 */

import type { ReactNode } from 'react';
import { useState } from 'react';
import { colors, formatElapsedTime } from '../theme.js';
import type { IterationResult, IterationStatus, EngineSubagentStatus } from '../../engine/types.js';
import type { SubagentHierarchyNode, SubagentTraceStats } from '../../logs/types.js';
import type { SandboxConfig, SandboxMode } from '../../config/types.js';

/**
 * Event in the iteration timeline
 */
interface TimelineEvent {
  /** Event timestamp */
  timestamp: string;
  /** Event type for display */
  type: 'started' | 'agent_running' | 'task_completed' | 'completed' | 'failed' | 'skipped' | 'interrupted';
  /** Human-readable description */
  description: string;
}

/**
 * Props for the IterationDetailView component
 */
export interface IterationDetailViewProps {
  /** The iteration result to display */
  iteration: IterationResult;
  /** Total iterations for context (e.g., "Iteration 3 of 10") */
  totalIterations: number;
  /** Output directory for the link to persisted file */
  outputDir?: string;
  /** Current working directory */
  cwd?: string;
  /** Callback when Esc is pressed to return to list view */
  onBack?: () => void;
  /** Subagent hierarchy tree for this iteration (loaded lazily) */
  subagentTree?: SubagentHierarchyNode[];
  /** Subagent statistics for this iteration */
  subagentStats?: SubagentTraceStats;
  /** Loading state for subagent trace data */
  subagentTraceLoading?: boolean;
  /** Sandbox configuration (if sandboxing is enabled) */
  sandboxConfig?: SandboxConfig;
  /** Resolved sandbox mode (when mode is 'auto', this shows what it resolved to) */
  resolvedSandboxMode?: Exclude<SandboxMode, 'auto'>;
}

/**
 * Status indicator symbols for iterations
 */
const statusIndicators: Record<IterationStatus, string> = {
  completed: '✓',
  running: '▶',
  failed: '✗',
  interrupted: '⊘',
  skipped: '⊖',
};

/**
 * Status colors for iterations
 */
const statusColors: Record<IterationStatus, string> = {
  completed: colors.status.success,
  running: colors.accent.primary,
  failed: colors.status.error,
  interrupted: colors.status.warning,
  skipped: colors.fg.dim,
};

/**
 * Status labels for display
 */
const statusLabels: Record<IterationStatus, string> = {
  completed: 'Completed',
  running: 'Running',
  failed: 'Failed',
  interrupted: 'Interrupted',
  skipped: 'Skipped',
};

/**
 * Format an ISO timestamp for display
 */
function formatTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Build timeline events from iteration result
 */
function buildTimeline(result: IterationResult): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // Start event
  events.push({
    timestamp: result.startedAt,
    type: 'started',
    description: `Started working on ${result.task.id}`,
  });

  // Agent running event (synthetic - represents agent execution phase)
  if (result.agentResult) {
    events.push({
      timestamp: result.startedAt,
      type: 'agent_running',
      description: 'Agent executing prompt',
    });
  }

  // Task completed event (if applicable)
  if (result.taskCompleted) {
    events.push({
      timestamp: result.endedAt,
      type: 'task_completed',
      description: result.promiseComplete
        ? 'Task marked complete (<promise>COMPLETE</promise> detected)'
        : 'Task marked complete',
    });
  }

  // End event based on status
  if (result.status === 'completed') {
    events.push({
      timestamp: result.endedAt,
      type: 'completed',
      description: 'Iteration completed successfully',
    });
  } else if (result.status === 'failed') {
    events.push({
      timestamp: result.endedAt,
      type: 'failed',
      description: result.error ?? 'Iteration failed',
    });
  } else if (result.status === 'interrupted') {
    events.push({
      timestamp: result.endedAt,
      type: 'interrupted',
      description: 'Iteration interrupted by user',
    });
  } else if (result.status === 'skipped') {
    events.push({
      timestamp: result.endedAt,
      type: 'skipped',
      description: 'Iteration skipped',
    });
  }

  return events;
}

/**
 * Get the color for a timeline event type
 */
function getEventColor(type: TimelineEvent['type']): string {
  switch (type) {
    case 'started':
      return colors.accent.primary;
    case 'agent_running':
      return colors.accent.tertiary;
    case 'task_completed':
      return colors.status.success;
    case 'completed':
      return colors.status.success;
    case 'failed':
      return colors.status.error;
    case 'interrupted':
      return colors.status.warning;
    case 'skipped':
      return colors.fg.muted;
    default:
      return colors.fg.secondary;
  }
}

/**
 * Get the symbol for a timeline event type
 */
function getEventSymbol(type: TimelineEvent['type']): string {
  switch (type) {
    case 'started':
      return '▶';
    case 'agent_running':
      return '⚙';
    case 'task_completed':
      return '✓';
    case 'completed':
      return '✓';
    case 'failed':
      return '✗';
    case 'interrupted':
      return '⊘';
    case 'skipped':
      return '⊖';
    default:
      return '•';
  }
}

/**
 * Section header component for consistent styling
 */
function SectionHeader({ title }: { title: string }): ReactNode {
  return (
    <box style={{ marginBottom: 1 }}>
      <text fg={colors.accent.primary}>{title}</text>
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
    <box style={{ flexDirection: 'row', marginBottom: 0 }}>
      <text fg={colors.fg.muted}>{label}: </text>
      {typeof value === 'string' ? (
        <text fg={valueColor ?? colors.fg.secondary}>{value}</text>
      ) : (
        value
      )}
    </box>
  );
}

/**
 * Check if a line is the start of a code block
 */
function isCodeBlockStart(line: string): { language: string } | null {
  const match = line.match(/^```(\w*)$/);
  if (match) {
    return { language: match[1] || 'text' };
  }
  return null;
}

/**
 * Check if a line is the end of a code block
 */
function isCodeBlockEnd(line: string): boolean {
  return line === '```';
}

/**
 * Render agent output with syntax highlighting for code blocks
 * This provides visual differentiation for code vs prose content
 */
function renderOutputWithHighlighting(output: string): ReactNode[] {
  const lines = output.split('\n');
  const elements: ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLanguage = '';
  let codeBlockLines: string[] = [];
  let blockIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inCodeBlock) {
      const codeStart = isCodeBlockStart(line);
      if (codeStart) {
        inCodeBlock = true;
        codeBlockLanguage = codeStart.language;
        codeBlockLines = [];
        continue;
      }

      // Regular text line
      elements.push(
        <text key={`line-${i}`} fg={colors.fg.secondary}>
          {line}
          {'\n'}
        </text>
      );
    } else {
      // Inside code block
      if (isCodeBlockEnd(line)) {
        // Render the accumulated code block
        const codeContent = codeBlockLines.join('\n');
        elements.push(
          <box
            key={`code-${blockIndex}`}
            style={{
              backgroundColor: colors.bg.tertiary,
              border: true,
              borderColor: colors.border.muted,
              marginTop: 1,
              marginBottom: 1,
              padding: 1,
            }}
          >
            {codeBlockLanguage && (
              <text fg={colors.fg.dim}>{`[${codeBlockLanguage}]`}{'\n'}</text>
            )}
            <text fg={colors.accent.tertiary}>{codeContent}</text>
          </box>
        );
        blockIndex++;
        inCodeBlock = false;
        codeBlockLanguage = '';
        codeBlockLines = [];
      } else {
        codeBlockLines.push(line);
      }
    }
  }

  // Handle unclosed code block at end of output
  if (inCodeBlock && codeBlockLines.length > 0) {
    const codeContent = codeBlockLines.join('\n');
    elements.push(
      <box
        key={`code-${blockIndex}`}
        style={{
          backgroundColor: colors.bg.tertiary,
          border: true,
          borderColor: colors.border.muted,
          marginTop: 1,
          marginBottom: 1,
          padding: 1,
        }}
      >
        {codeBlockLanguage && (
          <text fg={colors.fg.dim}>{`[${codeBlockLanguage}]`}{'\n'}</text>
        )}
        <text fg={colors.accent.tertiary}>{codeContent}</text>
      </box>
    );
  }

  return elements;
}

/**
 * Generate the output file path for an iteration
 */
function getOutputFilePath(
  iteration: number,
  taskId: string,
  outputDir: string
): string {
  const filename = `iteration-${String(iteration).padStart(3, '0')}-${taskId}.md`;
  // Show relative path for cleaner display
  return `${outputDir}/${filename}`;
}

/**
 * Get status icon for subagent based on its completion state.
 */
function getSubagentStatusIcon(status: EngineSubagentStatus): string {
  switch (status) {
    case 'running':
      return '◐';
    case 'completed':
      return '✓';
    case 'error':
      return '✗';
    default:
      return '○';
  }
}

/**
 * Get status color for subagent based on its completion state.
 */
function getSubagentStatusColor(status: EngineSubagentStatus): string {
  switch (status) {
    case 'running':
      return colors.status.info;
    case 'completed':
      return colors.status.success;
    case 'error':
      return colors.status.error;
    default:
      return colors.fg.muted;
  }
}

/**
 * Format duration in human-readable format for subagents.
 */
function formatSubagentDuration(durationMs?: number): string {
  if (durationMs === undefined) return '';
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = Math.floor(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Props for expandable subagent row.
 */
interface SubagentTreeRowProps {
  node: SubagentHierarchyNode;
  depth: number;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
}

/**
 * Single expandable subagent row in the tree.
 */
function SubagentTreeRowExpandable({
  node,
  depth,
  expandedIds,
  onToggle,
}: SubagentTreeRowProps): ReactNode {
  const { state } = node;
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(state.id);
  const statusIcon = getSubagentStatusIcon(state.status);
  const statusColor = getSubagentStatusColor(state.status);

  // Indentation based on depth
  const indent = '  '.repeat(depth);

  // Expand/collapse indicator
  const expandIcon = hasChildren ? (isExpanded ? '▼' : '▶') : ' ';

  // Format agent type and description
  const agentType = `[${state.agentType}]`;
  const duration = state.durationMs !== undefined ? ` [${formatSubagentDuration(state.durationMs)}]` : '';

  return (
    <>
      <box
        style={{
          flexDirection: 'row',
          paddingLeft: 1,
          paddingRight: 1,
          marginBottom: 0,
        }}
      >
        <text>
          <span fg={colors.fg.dim}>{indent}</span>
          <span fg={hasChildren ? colors.fg.muted : colors.fg.dim}>{expandIcon}</span>
          <span fg={statusColor}> {statusIcon}</span>
          <span fg={colors.accent.tertiary}> {agentType}</span>
          <span fg={colors.fg.secondary}> {state.description}</span>
          {duration && <span fg={colors.fg.dim}>{duration}</span>}
        </text>
      </box>
      {/* Render children if expanded */}
      {isExpanded &&
        node.children.map((child) => (
          <SubagentTreeRowExpandable
            key={child.state.id}
            node={child}
            depth={depth + 1}
            expandedIds={expandedIds}
            onToggle={onToggle}
          />
        ))}
    </>
  );
}

/**
 * Expandable subagent tree section component.
 */
function SubagentTreeSection({
  tree,
  stats,
  loading,
}: {
  tree?: SubagentHierarchyNode[];
  stats?: SubagentTraceStats;
  loading?: boolean;
}): ReactNode {
  // Track which subagent IDs are expanded (starts all expanded)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    // Pre-expand all nodes initially for visibility
    function collectIds(nodes: SubagentHierarchyNode[]) {
      for (const node of nodes) {
        ids.add(node.state.id);
        collectIds(node.children);
      }
    }
    if (tree) collectIds(tree);
    return ids;
  });

  const handleToggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Build summary line
  const summaryParts: string[] = [];
  if (stats) {
    summaryParts.push(`${stats.totalSubagents} subagent${stats.totalSubagents === 1 ? '' : 's'}`);
    if (stats.failureCount > 0) {
      summaryParts.push(`${stats.failureCount} failed`);
    }
    if (stats.maxDepth > 1) {
      summaryParts.push(`max depth ${stats.maxDepth}`);
    }
  }
  const summaryText = summaryParts.join(' · ');

  // Determine title with failure indicator
  const hasFailures = stats && stats.failureCount > 0;
  const title = hasFailures ? 'Subagent Activity ✗' : 'Subagent Activity';

  return (
    <box style={{ marginBottom: 2 }}>
      <SectionHeader title={title} />
      <box
        style={{
          padding: 1,
          backgroundColor: colors.bg.secondary,
          border: true,
          borderColor: hasFailures ? colors.status.error : colors.border.muted,
          flexDirection: 'column',
        }}
      >
        {loading ? (
          <text fg={colors.fg.dim}>Loading subagent trace...</text>
        ) : !tree || tree.length === 0 ? (
          <text fg={colors.fg.muted}>No subagents spawned</text>
        ) : (
          <>
            {/* Summary line */}
            {summaryText && (
              <box style={{ marginBottom: 1 }}>
                <text fg={hasFailures ? colors.status.error : colors.fg.muted}>
                  {summaryText}
                </text>
              </box>
            )}
            {/* Tree view */}
            {tree.map((node) => (
              <SubagentTreeRowExpandable
                key={node.state.id}
                node={node}
                depth={0}
                expandedIds={expandedIds}
                onToggle={handleToggle}
              />
            ))}
          </>
        )}
      </box>
    </box>
  );
}

/**
 * IterationDetailView component showing comprehensive iteration details.
 * Note: onBack is provided for API completeness but navigation is handled
 * by keyboard (Esc key) in the parent component.
 */
export function IterationDetailView({
  iteration,
  totalIterations,
  outputDir = '.ralph-output',
  cwd: _cwd = '.',
  onBack: _onBack,
  subagentTree,
  subagentStats,
  subagentTraceLoading,
  sandboxConfig,
  resolvedSandboxMode,
}: IterationDetailViewProps): ReactNode {
  const statusColor = statusColors[iteration.status];
  const statusIndicator = statusIndicators[iteration.status];
  const timeline = buildTimeline(iteration);
  const durationSeconds = Math.floor(iteration.durationMs / 1000);

  // Get agent output
  const agentOutput = iteration.agentResult?.stdout ?? '';

  // Generate output file path
  const outputFilePath = getOutputFilePath(
    iteration.iteration,
    iteration.task.id,
    outputDir
  );

  return (
    <box
      title={`Iteration Details [Esc to go back]`}
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
        {/* Iteration header */}
        <box style={{ marginBottom: 1 }}>
          <text>
            <span fg={statusColor}>{statusIndicator}</span>
            <span fg={colors.fg.primary}>
              {' '}Iteration {iteration.iteration} of {totalIterations}
            </span>
          </text>
        </box>

        {/* Task info */}
        <box style={{ marginBottom: 2 }}>
          <text fg={colors.fg.muted}>Task: </text>
          <text fg={colors.accent.primary}>{iteration.task.id}</text>
          <text fg={colors.fg.secondary}> - {iteration.task.title}</text>
        </box>

        {/* Metadata section */}
        <box style={{ marginBottom: 2 }}>
          <SectionHeader title="Details" />
          <box
            style={{
              padding: 1,
              backgroundColor: colors.bg.secondary,
              border: true,
              borderColor: colors.border.muted,
            }}
          >
            <MetadataRow
              label="Status"
              value={statusLabels[iteration.status]}
              valueColor={statusColor}
            />
            <MetadataRow
              label="Start Time"
              value={formatTimestamp(iteration.startedAt)}
              valueColor={colors.fg.secondary}
            />
            <MetadataRow
              label="End Time"
              value={formatTimestamp(iteration.endedAt)}
              valueColor={colors.fg.secondary}
            />
            <MetadataRow
              label="Duration"
              value={formatElapsedTime(durationSeconds)}
              valueColor={colors.accent.primary}
            />
            {iteration.taskCompleted && (
              <MetadataRow
                label="Task Completed"
                value="Yes"
                valueColor={colors.status.success}
              />
            )}
            {iteration.promiseComplete && (
              <MetadataRow
                label="Promise Detected"
                value="Yes"
                valueColor={colors.status.success}
              />
            )}
            {iteration.error && (
              <MetadataRow
                label="Error"
                value={iteration.error}
                valueColor={colors.status.error}
              />
            )}
          </box>
        </box>

        {/* Sandbox configuration section - shows if sandboxing is enabled */}
        {sandboxConfig?.enabled && sandboxConfig.mode !== 'off' && (
          <box style={{ marginBottom: 2 }}>
            <SectionHeader title="Sandbox Configuration" />
            <box
              style={{
                padding: 1,
                backgroundColor: colors.bg.secondary,
                border: true,
                borderColor: colors.status.info,
              }}
            >
              <MetadataRow
                label="Mode"
                value={
                  (sandboxConfig.mode ?? 'auto') === 'auto' && resolvedSandboxMode
                    ? `auto (${resolvedSandboxMode})`
                    : sandboxConfig.mode ?? 'auto'
                }
                valueColor={colors.status.info}
              />
              <MetadataRow
                label="Network Access"
                value={sandboxConfig.network === false ? 'Disabled' : 'Enabled'}
                valueColor={sandboxConfig.network === false ? colors.status.warning : colors.status.success}
              />
              {sandboxConfig.allowPaths && sandboxConfig.allowPaths.length > 0 && (
                <MetadataRow
                  label="Writable Paths"
                  value={sandboxConfig.allowPaths.join(', ')}
                  valueColor={colors.fg.secondary}
                />
              )}
              {sandboxConfig.readOnlyPaths && sandboxConfig.readOnlyPaths.length > 0 && (
                <MetadataRow
                  label="Read-Only Paths"
                  value={sandboxConfig.readOnlyPaths.join(', ')}
                  valueColor={colors.fg.secondary}
                />
              )}
            </box>
          </box>
        )}

        {/* Timeline section */}
        <box style={{ marginBottom: 2 }}>
          <SectionHeader title="Events Timeline" />
          <box
            style={{
              padding: 1,
              backgroundColor: colors.bg.secondary,
              border: true,
              borderColor: colors.border.muted,
              flexDirection: 'column',
            }}
          >
            {timeline.map((event, index) => (
              <box key={index} style={{ flexDirection: 'row', marginBottom: index < timeline.length - 1 ? 1 : 0 }}>
                <text>
                  <span fg={colors.fg.dim}>{formatTimestamp(event.timestamp)}</span>
                  <span fg={getEventColor(event.type)}> {getEventSymbol(event.type)} </span>
                  <span fg={colors.fg.secondary}>{event.description}</span>
                </text>
              </box>
            ))}
          </box>
        </box>

        {/* Subagent activity section - shows if any subagents were spawned or loading */}
        {(subagentTraceLoading || (subagentTree && subagentTree.length > 0) || subagentStats) && (
          <SubagentTreeSection
            tree={subagentTree}
            stats={subagentStats}
            loading={subagentTraceLoading}
          />
        )}

        {/* Output file link */}
        <box style={{ marginBottom: 2 }}>
          <SectionHeader title="Persisted Output" />
          <box
            style={{
              padding: 1,
              backgroundColor: colors.bg.tertiary,
              border: true,
              borderColor: colors.border.muted,
            }}
          >
            <text fg={colors.accent.tertiary}>{outputFilePath}</text>
          </box>
        </box>

        {/* Agent output section */}
        {agentOutput && (
          <box style={{ marginBottom: 2 }}>
            <SectionHeader title="Agent Output" />
            <box
              style={{
                padding: 1,
                backgroundColor: colors.bg.tertiary,
                border: true,
                borderColor: colors.border.muted,
                flexDirection: 'column',
              }}
            >
              {renderOutputWithHighlighting(agentOutput)}
            </box>
          </box>
        )}

        {/* Hint about returning */}
        <box style={{ marginTop: 1 }}>
          <text fg={colors.fg.dim}>Press Esc to return to iteration list, or 't' for task list</text>
        </box>
      </scrollbox>
    </box>
  );
}
