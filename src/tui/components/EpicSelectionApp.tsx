/**
 * ABOUTME: Epic selection application component for the Ralph TUI.
 * Provides keyboard navigation and epic selection functionality.
 * Used when ralph-tui is launched without an --epic flag.
 */

import type { ReactNode } from 'react';
import { useState, useCallback, useEffect } from 'react';
import { useKeyboard } from '@opentui/react';
import { EpicSelectionView } from './EpicSelectionView.js';
import type { TrackerPlugin, TrackerTask } from '../../plugins/trackers/types.js';

/**
 * Props for the EpicSelectionApp component
 */
export interface EpicSelectionAppProps {
  /** Tracker plugin instance */
  tracker: TrackerPlugin;
  /** Callback when user selects an epic and wants to start a run */
  onEpicSelected: (epics: TrackerTask[]) => void;
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
  const [selectedEpicIds, setSelectedEpicIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  // Extract configured labels from tracker if available (for empty state guidance)
  const configuredLabels = (() => {
    const trackerWithLabels = tracker as { getConfiguredLabels?: () => string[] };
    if (typeof trackerWithLabels.getConfiguredLabels === 'function') {
      return trackerWithLabels.getConfiguredLabels();
    }
    return [];
  })();

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
    (key: { name: string; sequence?: string }) => {
      const keyName = key.sequence === ' ' ? 'space' : key.name;

      switch (keyName) {
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

        case 'space':
          if (epics.length > 0 && epics[selectedIndex]) {
            const epic = epics[selectedIndex];
            setSelectedEpicIds((prev) => {
              const next = new Set(prev);
              if (next.has(epic.id)) {
                next.delete(epic.id);
              } else {
                next.add(epic.id);
              }
              return next;
            });
          }
          break;

        case 'a':
          setSelectedEpicIds((prev) =>
            prev.size === epics.length
              ? new Set()
              : new Set(epics.map((epic) => epic.id))
          );
          break;

        case 'return':
        case 'enter':
        case 'r':
          if (epics.length > 0 && epics[selectedIndex]) {
            const selected = epics.filter((epic) => selectedEpicIds.has(epic.id));
            onEpicSelected(selected.length > 0 ? selected : [epics[selectedIndex]]);
          }
          break;
      }
    },
    [epics, selectedIndex, selectedEpicIds, onEpicSelected, onQuit]
  );

  useKeyboard(handleKeyboard);

  return (
    <EpicSelectionView
      epics={epics}
      selectedIndex={selectedIndex}
      selectedEpicIds={selectedEpicIds}
      trackerName={tracker.meta.name}
      loading={loading}
      error={error}
      configuredLabels={configuredLabels}
    />
  );
}
