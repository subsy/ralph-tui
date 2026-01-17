/**
 * ABOUTME: Epic selection application component for the Ralph TUI.
 * Provides keyboard navigation and epic selection functionality.
 * Used when ralph-tui is launched without an --epic flag.
 */

import type { ReactNode } from 'react';
import { useState, useCallback, useEffect } from 'react';
import { useKeyboard } from '@opentui/react';
import { EpicSelectionView } from './EpicSelectionView.js';
import type {
  TrackerPlugin,
  TrackerTask,
} from '../../plugins/trackers/types.js';

/**
 * Props for the EpicSelectionApp component
 */
export interface EpicSelectionAppProps {
  /** Tracker plugin instance */
  tracker: TrackerPlugin;
  /** Callback when user selects an epic and wants to start a run */
  onEpicSelected: (epic: TrackerTask) => void;
  /** Callback when user quits without selecting */
  onQuit: () => void;
}

/**
 * EpicSelectionApp component
 * Main application component for epic selection mode
 */
export function EpicSelectionApp({
  tracker,
  onEpicSelected,
  onQuit,
}: EpicSelectionAppProps): ReactNode {
  const [epics, setEpics] = useState<TrackerTask[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  // Load epics on mount
  useEffect(() => {
    const loadEpics = async () => {
      try {
        setLoading(true);
        setError(undefined);
        const loadedEpics = await tracker.getEpics();
        setEpics(loadedEpics);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load epics');
      } finally {
        setLoading(false);
      }
    };

    void loadEpics();
  }, [tracker]);

  // Handle keyboard navigation
  const handleKeyboard = useCallback(
    (key: { name: string }) => {
      switch (key.name) {
        case 'q':
        case 'escape':
          onQuit();
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
        case 'r':
          // Start run on selected epic
          if (epics.length > 0 && epics[selectedIndex]) {
            onEpicSelected(epics[selectedIndex]);
          }
          break;
      }
    },
    [epics, selectedIndex, onEpicSelected, onQuit],
  );

  useKeyboard(handleKeyboard);

  return (
    <EpicSelectionView
      epics={epics}
      selectedIndex={selectedIndex}
      trackerName={tracker.meta.name}
      loading={loading}
      error={error}
    />
  );
}
