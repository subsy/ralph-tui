/**
 * ABOUTME: Epic loader overlay component for switching epics mid-session.
 * Provides an in-TUI modal for selecting a different epic without restarting.
 * Supports both beads-style epic selection (list) and json-style (file path prompt).
 */

import type { ReactNode } from 'react';
import { useState, useEffect, useCallback } from 'react';
import { useKeyboard } from '@opentui/react';
import { colors, statusIndicators } from '../theme.js';
import type { TrackerTask } from '../../plugins/trackers/types.js';
import { FileBrowser } from './FileBrowser.js';

/**
 * Mode for the epic loader overlay
 */
export type EpicLoaderMode = 'list' | 'file-prompt';

/**
 * Base props shared by all EpicLoaderOverlay modes
 */
interface EpicLoaderOverlayBaseProps {
  /** Whether the overlay is visible */
  visible: boolean;

  /** Tracker name for display */
  trackerName: string;

  /** Callback when user cancels (Escape) */
  onCancel: () => void;

  /** Error message if loading failed */
  error?: string;

  /** Current epic ID (for highlighting) */
  currentEpicId?: string;
}

/**
 * Props for list mode (beads-style epic selection)
 */
interface EpicLoaderOverlayListProps extends EpicLoaderOverlayBaseProps {
  mode: 'list';

  /** Available epics */
  epics: TrackerTask[];

  /** Whether epics are loading */
  loading: boolean;

  /** Callback when an epic is selected */
  onSelect: (epic: TrackerTask) => void;

  onFilePath?: never;
}

/**
 * Props for file-prompt mode (json-style file selection)
 */
interface EpicLoaderOverlayFilePromptProps extends EpicLoaderOverlayBaseProps {
  mode: 'file-prompt';

  /** Callback when file path is submitted */
  onFilePath: (path: string) => void;

  epics?: never;
  loading?: never;
  onSelect?: never;
}

/**
 * Props for the EpicLoaderOverlay component - discriminated union by mode
 */
export type EpicLoaderOverlayProps = EpicLoaderOverlayListProps | EpicLoaderOverlayFilePromptProps;

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
  const meta = epic.metadata as Record<string, unknown> | undefined;
  if (meta) {
    const storyCount = meta.storyCount as number | undefined;
    const completedCount = meta.completedCount as number | undefined;
    if (storyCount !== undefined && completedCount !== undefined) {
      if (completedCount >= storyCount) {
        return colors.status.success;
      }
      if (completedCount > 0) {
        return colors.status.warning;
      }
    }
  }

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
 * Modal overlay for loading/switching epics during a TUI session.
 * Supports two modes:
 * - 'list': Display a list of available epics for selection (beads/beads-bv)
 * - 'file-prompt': Prompt user to enter a file path (json tracker)
 */
export function EpicLoaderOverlay({
  visible,
  mode,
  epics,
  loading,
  error,
  trackerName,
  currentEpicId,
  onSelect,
  onCancel,
  onFilePath,
}: EpicLoaderOverlayProps): ReactNode {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset state when overlay becomes visible (list mode only)
  useEffect(() => {
    if (visible && mode === 'list' && epics) {
      // Find the currently selected epic in the list
      const currentIndex = epics.findIndex((e) => e.id === currentEpicId);
      setSelectedIndex(currentIndex >= 0 ? currentIndex : 0);
    }
  }, [visible, mode, epics, currentEpicId]);

  // Handle keyboard input (only for list mode - file-prompt uses FileBrowser)
  const handleKeyboard = useCallback(
    (key: { name: string; sequence?: string }) => {
      if (!visible || mode !== 'list') return;

      switch (key.name) {
        case 'escape':
          onCancel();
          break;

        case 'up':
        case 'k':
          setSelectedIndex((prev) => Math.max(0, prev - 1));
          break;

        case 'down':
        case 'j':
          setSelectedIndex((prev) => Math.min(epics.length - 1, prev + 1));
          break;

        case 'return':
        case 'enter':
          if (epics.length > 0 && epics[selectedIndex]) {
            onSelect(epics[selectedIndex]);
          }
          break;
      }
    },
    [visible, mode, epics, selectedIndex, onSelect, onCancel]
  );

  useKeyboard(handleKeyboard);

  if (!visible) {
    return null;
  }

  // Use FileBrowser for file-prompt mode
  if (mode === 'file-prompt') {
    return (
      <FileBrowser
        visible={visible}
        fileExtension=".json"
        filenamePrefix="prd"
        trackerLabel={trackerName}
        errorMessage={error}
        onSelect={onFilePath}
        onCancel={onCancel}
      />
    );
  }

  // Full-screen overlay with centered modal
  return (
    <box
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#00000080', // 50% opacity black (OpenTUI doesn't support rgba syntax)
      }}
    >
      <box
        style={{
          width: 70,
          height: 20,
          backgroundColor: colors.bg.secondary,
          border: true,
          borderColor: colors.accent.primary,
          flexDirection: 'column',
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
            backgroundColor: colors.bg.tertiary,
            paddingLeft: 1,
            paddingRight: 1,
          }}
        >
          <text fg={colors.accent.primary}>Load Epic</text>
          <text fg={colors.fg.muted}>[{trackerName}]</text>
        </box>

        {/* Content */}
        {loading ? (
          <box
            style={{
              flexGrow: 1,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <text fg={colors.fg.secondary}>Loading epics...</text>
          </box>
        ) : error ? (
          <box
            style={{
              flexGrow: 1,
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <text fg={colors.status.error}>Error: {error}</text>
            <box style={{ height: 1 }} />
            <text fg={colors.fg.muted}>Press Escape to close</text>
          </box>
        ) : epics.length === 0 ? (
          <box
            style={{
              flexGrow: 1,
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <text fg={colors.fg.secondary}>No epics found</text>
            <box style={{ height: 1 }} />
            <text fg={colors.fg.muted}>Press Escape to close</text>
          </box>
        ) : (
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
                const isCurrent = epic.id === currentEpicId;
                const statusColor = getEpicStatusColor(epic);
                const meta = epic.metadata as Record<string, unknown> | undefined;
                const storyCount = (meta?.storyCount as number | undefined) ?? 0;
                const completedCount = (meta?.completedCount as number | undefined) ?? 0;
                const childCount = (meta?.childCount as number | undefined) ?? storyCount;

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
                      backgroundColor: isSelected ? colors.bg.highlight : 'transparent',
                    }}
                  >
                    {/* Selection indicator */}
                    <text fg={isSelected ? colors.accent.primary : 'transparent'}>
                      {isSelected ? '▸ ' : '  '}
                    </text>

                    {/* Current epic marker */}
                    <text fg={isCurrent ? colors.status.success : 'transparent'}>
                      {isCurrent ? '● ' : '  '}
                    </text>

                    {/* Status indicator */}
                    <text fg={statusColor}>
                      {epic.status === 'in_progress'
                        ? statusIndicators.active
                        : statusIndicators.pending}{' '}
                    </text>

                    {/* Epic ID */}
                    <text fg={colors.fg.muted}>{truncateText(epic.id, 20)} </text>

                    {/* Epic title */}
                    <text fg={isSelected ? colors.fg.primary : colors.fg.secondary}>
                      {truncateText(epic.title, 30)}
                    </text>

                    {/* Progress */}
                    <text fg={colors.fg.muted}>{progressText}</text>
                  </box>
                );
              })}
            </scrollbox>
          </box>
        )}

        {/* Footer */}
        <box
          style={{
            width: '100%',
            height: 2,
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: colors.bg.tertiary,
            gap: 3,
          }}
        >
          <text fg={colors.fg.muted}>
            <span fg={colors.accent.primary}>Enter</span> Select
          </text>
          <text fg={colors.fg.muted}>
            <span fg={colors.accent.primary}>↑↓/jk</span> Navigate
          </text>
          <text fg={colors.fg.muted}>
            <span fg={colors.accent.primary}>Esc</span> Cancel
          </text>
        </box>
      </box>
    </box>
  );
}
