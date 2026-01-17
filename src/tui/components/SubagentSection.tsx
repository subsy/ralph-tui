/**
 * ABOUTME: SubagentSection component for rendering collapsible subagent output sections.
 * Displays subagent activity inline in the output panel with collapsible sections,
 * allowing users to expand/collapse to see subagent details.
 */

import type { ReactNode } from 'react';
import { colors } from '../theme.js';
import type {
  EngineSubagentState,
  SubagentTreeNode,
} from '../../engine/types.js';
import type { SubagentDetailLevel } from '../../config/types.js';

/**
 * Status color for subagent based on its completion state
 */
function getSubagentStatusColor(status: EngineSubagentState['status']): string {
  switch (status) {
    case 'completed':
      return colors.status.success;
    case 'error':
      return colors.status.error;
    case 'running':
      return colors.status.info;
    default:
      return colors.fg.muted;
  }
}

/**
 * Status indicator symbol for subagent
 */
function getSubagentStatusIndicator(
  status: EngineSubagentState['status'],
): string {
  switch (status) {
    case 'completed':
      return '✓';
    case 'error':
      return '✗';
    case 'running':
      return '▶';
    default:
      return '○';
  }
}

/**
 * Format duration in human-readable format
 */
function formatDuration(durationMs?: number): string {
  if (durationMs === undefined) return '';
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = Math.floor(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

/**
 * Props for the SubagentSectionHeader component
 */
interface SubagentSectionHeaderProps {
  /** The subagent state to display */
  subagent: EngineSubagentState;
  /** Whether this section is collapsed */
  isCollapsed: boolean;
  /** Whether this section is currently focused/selected */
  isFocused: boolean;
  /** Callback when section is toggled */
  onToggle?: () => void;
}

/**
 * Renders the header line for a subagent section.
 * Format: [▼/▶] [status] [Subagent: type] description [duration]
 */
function SubagentSectionHeader({
  subagent,
  isCollapsed,
  isFocused,
}: SubagentSectionHeaderProps): ReactNode {
  const statusColor = getSubagentStatusColor(subagent.status);
  const statusIndicator = getSubagentStatusIndicator(subagent.status);
  const collapseIndicator = isCollapsed ? '▶' : '▼';
  const durationStr =
    subagent.durationMs !== undefined
      ? ` [${formatDuration(subagent.durationMs)}]`
      : '';

  // Indent based on depth (each level adds 2 spaces)
  const indent = '  '.repeat(Math.max(0, subagent.depth - 1));

  return (
    <box
      style={{
        width: '100%',
        backgroundColor: isFocused ? colors.bg.highlight : 'transparent',
      }}
    >
      <text>
        <span fg={colors.fg.dim}>{indent}</span>
        <span fg={colors.accent.secondary}>{collapseIndicator} </span>
        <span fg={statusColor}>{statusIndicator} </span>
        <span fg={colors.accent.tertiary}>[Subagent: {subagent.type}]</span>
        <span fg={colors.fg.secondary}> {subagent.description}</span>
        <span fg={colors.fg.muted}>{durationStr}</span>
      </text>
    </box>
  );
}

/**
 * Props for the CollapsedSummary component
 */
interface CollapsedSummaryProps {
  /** The subagent state */
  subagent: EngineSubagentState;
  /** Number of child subagents */
  childCount: number;
}

/**
 * Renders a one-line summary when the section is collapsed.
 */
function CollapsedSummary({
  subagent,
  childCount,
}: CollapsedSummaryProps): ReactNode {
  const indent = '  '.repeat(Math.max(0, subagent.depth));
  const statusColor = getSubagentStatusColor(subagent.status);
  const statusText =
    subagent.status === 'running' ? 'running...' : subagent.status;
  const childText = childCount > 0 ? ` (${childCount} nested)` : '';

  return (
    <box style={{ paddingLeft: 1 }}>
      <text>
        <span fg={colors.fg.dim}>{indent}</span>
        <span fg={statusColor}>{statusText}</span>
        <span fg={colors.fg.muted}>{childText}</span>
      </text>
    </box>
  );
}

/**
 * Props for a single SubagentSection
 */
export interface SubagentSectionProps {
  /** The subagent tree node to render */
  node: SubagentTreeNode;
  /** Set of collapsed subagent IDs */
  collapsedSet: Set<string>;
  /** ID of the currently focused subagent section (for keyboard navigation) */
  focusedId?: string;
  /** Detail level for rendering */
  detailLevel: SubagentDetailLevel;
  /** Callback when a section needs to toggle */
  onToggle?: (id: string) => void;
}

/**
 * Renders a single subagent section with its children recursively.
 */
export function SubagentSection({
  node,
  collapsedSet,
  focusedId,
  detailLevel,
  onToggle,
}: SubagentSectionProps): ReactNode {
  const { state: subagent, children } = node;
  const isCollapsed = collapsedSet.has(subagent.id);
  const isFocused = focusedId === subagent.id;

  // For 'minimal' level, just show start/complete events as single lines
  if (detailLevel === 'minimal') {
    return (
      <SubagentSectionHeader
        subagent={subagent}
        isCollapsed={true}
        isFocused={isFocused}
        onToggle={() => onToggle?.(subagent.id)}
      />
    );
  }

  // For 'moderate' and 'full' levels, show collapsible sections
  return (
    <box style={{ flexDirection: 'column', width: '100%' }}>
      <SubagentSectionHeader
        subagent={subagent}
        isCollapsed={isCollapsed}
        isFocused={isFocused}
        onToggle={() => onToggle?.(subagent.id)}
      />

      {isCollapsed ? (
        <CollapsedSummary subagent={subagent} childCount={children.length} />
      ) : (
        <>
          {/* Show children when expanded */}
          {children.map((child) => (
            <SubagentSection
              key={child.state.id}
              node={child}
              collapsedSet={collapsedSet}
              focusedId={focusedId}
              detailLevel={detailLevel}
              onToggle={onToggle}
            />
          ))}
        </>
      )}
    </box>
  );
}

/**
 * Props for the SubagentSections container
 */
export interface SubagentSectionsProps {
  /** Array of root-level subagent tree nodes */
  tree: SubagentTreeNode[];
  /** Set of collapsed subagent IDs */
  collapsedSet: Set<string>;
  /** ID of the currently focused subagent section */
  focusedId?: string;
  /** Detail level for rendering */
  detailLevel: SubagentDetailLevel;
  /** Callback when a section is toggled */
  onToggle?: (id: string) => void;
}

/**
 * Renders all subagent sections from a tree.
 * This is the main entry point for rendering subagent output.
 */
export function SubagentSections({
  tree,
  collapsedSet,
  focusedId,
  detailLevel,
  onToggle,
}: SubagentSectionsProps): ReactNode {
  if (tree.length === 0) {
    return null;
  }

  return (
    <box style={{ flexDirection: 'column', width: '100%' }}>
      {tree.map((node) => (
        <SubagentSection
          key={node.state.id}
          node={node}
          collapsedSet={collapsedSet}
          focusedId={focusedId}
          detailLevel={detailLevel}
          onToggle={onToggle}
        />
      ))}
    </box>
  );
}

/**
 * End marker component for a completed/errored subagent.
 * Shows: [indent][status] Subagent complete [duration]
 */
export function SubagentEndMarker({
  subagent,
}: {
  subagent: EngineSubagentState;
}): ReactNode {
  if (subagent.status === 'running') {
    return null;
  }

  const statusColor = getSubagentStatusColor(subagent.status);
  const statusText = subagent.status === 'completed' ? 'complete' : 'failed';
  const durationStr = formatDuration(subagent.durationMs);
  const indent = '  '.repeat(Math.max(0, subagent.depth - 1));

  return (
    <box style={{ width: '100%' }}>
      <text>
        <span fg={colors.fg.dim}>{indent}</span>
        <span fg={colors.accent.secondary}>└─</span>
        <span fg={statusColor}> {statusText}</span>
        {durationStr && <span fg={colors.fg.muted}> ({durationStr})</span>}
      </text>
    </box>
  );
}
