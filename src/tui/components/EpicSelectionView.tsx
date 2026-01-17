/**
 * ABOUTME: Epic selection view component for the Ralph TUI.
 * Displays a list of available epics for the user to select and start a Ralph run.
 * Used when ralph-tui is launched without an --epic flag.
 */

import type { ReactNode } from 'react';
import { colors, statusIndicators } from '../theme.js';
import type { TrackerTask } from '../../plugins/trackers/types.js';

/**
 * Props for the EpicSelectionView component
 */
export interface EpicSelectionViewProps {
  /** List of available epics */
  epics: TrackerTask[];
  /** Currently selected epic index */
  selectedIndex: number;
  /** Name of the tracker being used */
  trackerName: string;
  /** Whether we're loading epics */
  loading?: boolean;
  /** Error message if epic loading failed */
  error?: string;
}

/**
 * Truncate text to fit within a given width
 */
function truncateText(text: string, maxWidth: number): string {
  if (text.length <= maxWidth) {
    return text;
  }
  return text.slice(0, maxWidth - 1) + '…';
}

/**
 * Get a status color for an epic based on its completion status
 */
function getEpicStatusColor(epic: TrackerTask): string {
  // Check metadata for completion info if available
  const meta = epic.metadata as Record<string, unknown> | undefined;
  if (meta) {
    const storyCount = meta.storyCount as number | undefined;
    const completedCount = meta.completedCount as number | undefined;
    if (storyCount !== undefined && completedCount !== undefined) {
      if (completedCount >= storyCount) {
        return colors.status.success; // All done
      }
      if (completedCount > 0) {
        return colors.status.warning; // In progress
      }
    }
  }

  // Default based on status
  switch (epic.status) {
    case 'completed':
      return colors.status.success;
    case 'in_progress':
      return colors.status.info;
    default:
      return colors.fg.primary;
  }
}

/**
 * EpicSelectionView component
 * Displays a list of available epics with selection highlighting
 */
export function EpicSelectionView({
  epics,
  selectedIndex,
  trackerName,
  loading = false,
  error,
}: EpicSelectionViewProps): ReactNode {
  // Loading state
  if (loading) {
    return (
      <box
        style={{
          width: '100%',
          height: '100%',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.bg.primary,
        }}
      >
        <text fg={colors.fg.secondary}>Loading epics...</text>
      </box>
    );
  }

  // Error state
  if (error) {
    return (
      <box
        style={{
          width: '100%',
          height: '100%',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.bg.primary,
        }}
      >
        <text fg={colors.status.error}>Error: {error}</text>
        <text fg={colors.fg.muted}>Press 'q' to quit</text>
      </box>
    );
  }

  // No epics found
  if (epics.length === 0) {
    return (
      <box
        style={{
          width: '100%',
          height: '100%',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.bg.primary,
        }}
      >
        <text fg={colors.fg.secondary}>No epics found</text>
        <text fg={colors.fg.muted}>
          Create an epic in your tracker or use --epic flag
        </text>
      </box>
    );
  }

  return (
    <box
      style={{
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        backgroundColor: colors.bg.primary,
      }}
    >
      {/* Header */}
      <box
        style={{
          width: '100%',
          height: 3,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: colors.bg.secondary,
          paddingLeft: 1,
          paddingRight: 1,
          border: true,
          borderColor: colors.border.normal,
        }}
      >
        <box style={{ flexDirection: 'row', gap: 2 }}>
          <text fg={colors.accent.primary}>Select Epic</text>
          <text fg={colors.fg.muted}>({epics.length} available)</text>
        </box>
        <text fg={colors.fg.muted}>[{trackerName}]</text>
      </box>

      {/* Epic List */}
      <box
        style={{
          flexGrow: 1,
          flexDirection: 'column',
          paddingTop: 1,
          paddingLeft: 1,
          paddingRight: 1,
        }}
      >
        <scrollbox style={{ flexGrow: 1 }}>
          {epics.map((epic, index) => {
            const isSelected = index === selectedIndex;
            const statusColor = getEpicStatusColor(epic);
            const meta = epic.metadata as Record<string, unknown> | undefined;
            const storyCount = (meta?.storyCount as number | undefined) ?? 0;
            const completedCount =
              (meta?.completedCount as number | undefined) ?? 0;
            const childCount =
              (meta?.childCount as number | undefined) ?? storyCount;

            // Build progress text
            let progressText = '';
            if (childCount > 0) {
              progressText = ` (${completedCount}/${childCount})`;
            }

            return (
              <box
                key={epic.id}
                style={{
                  width: '100%',
                  height: 1,
                  flexDirection: 'row',
                  backgroundColor: isSelected
                    ? colors.bg.highlight
                    : 'transparent',
                }}
              >
                {/* Selection indicator */}
                <text fg={isSelected ? colors.accent.primary : 'transparent'}>
                  {isSelected ? '▸ ' : '  '}
                </text>

                {/* Status indicator */}
                <text fg={statusColor}>
                  {epic.status === 'in_progress'
                    ? statusIndicators.active
                    : statusIndicators.pending}{' '}
                </text>

                {/* Epic ID */}
                <text fg={colors.fg.muted}>{epic.id} </text>

                {/* Epic title */}
                <text fg={isSelected ? colors.fg.primary : colors.fg.secondary}>
                  {truncateText(epic.title, 50)}
                </text>

                {/* Progress */}
                <text fg={colors.fg.muted}>{progressText}</text>
              </box>
            );
          })}
        </scrollbox>
      </box>

      {/* Footer with instructions */}
      <box
        style={{
          width: '100%',
          height: 3,
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.bg.secondary,
          paddingLeft: 1,
          paddingRight: 1,
          border: true,
          borderColor: colors.border.normal,
          gap: 3,
        }}
      >
        <text fg={colors.fg.muted}>
          <span fg={colors.accent.primary}>Enter/r</span> Start Run
        </text>
        <text fg={colors.fg.muted}>
          <span fg={colors.accent.primary}>↑↓/jk</span> Navigate
        </text>
        <text fg={colors.fg.muted}>
          <span fg={colors.accent.primary}>q</span> Quit
        </text>
      </box>
    </box>
  );
}
