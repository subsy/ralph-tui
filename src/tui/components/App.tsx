/**
 * ABOUTME: Main App component for the Ralph TUI.
 * Composes Header, LeftPanel, RightPanel, and Footer into a responsive layout.
 */

import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import type { ReactNode } from 'react';
import { useState, useCallback, useEffect } from 'react';
import { colors, layout } from '../theme.js';
import type { AppState, TaskItem } from '../types.js';
import { Header } from './Header.js';
import { Footer } from './Footer.js';
import { LeftPanel } from './LeftPanel.js';
import { RightPanel } from './RightPanel.js';

/**
 * Props for the App component
 */
export interface AppProps {
  /** Initial application state */
  initialState?: Partial<AppState>;
  /** Callback when quit is requested */
  onQuit?: () => void;
}

/**
 * Create default application state with empty tasks.
 * Real tasks come from the tracker when using 'ralph-tui run'.
 */
function createDefaultState(tasks: TaskItem[] = []): AppState {
  const completedTasksCount = tasks.filter((t) => t.status === 'done').length;

  return {
    header: {
      status: 'ready',
      elapsedTime: 0,
      completedTasks: completedTasksCount,
      totalTasks: tasks.length,
    },
    leftPanel: {
      tasks,
      selectedIndex: 0,
    },
    rightPanel: {
      selectedTask: tasks[0] ?? null,
      currentIteration: 1,
      iterationOutput: 'Starting iteration...',
    },
  };
}

/**
 * Main App component with responsive layout
 * Note: Task details are shown inline in the RightPanel, no separate drill-down view
 */
export function App({ initialState, onQuit }: AppProps): ReactNode {
  const { width, height } = useTerminalDimensions();
  const [state, setState] = useState<AppState>(() => ({
    ...createDefaultState(),
    ...initialState,
  }));
  const [elapsedTime, setElapsedTime] = useState(state.header.elapsedTime);

  // Update elapsed time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedTime((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Handle keyboard navigation
  const handleKeyboard = useCallback(
    (key: { name: string }) => {
      const { tasks, selectedIndex } = state.leftPanel;

      switch (key.name) {
        case 'q':
        case 'escape':
          // Quit the application
          onQuit?.();
          process.exit(0);
          break;

        case 'up':
        case 'k':
          if (selectedIndex > 0) {
            const newIndex = selectedIndex - 1;
            setState((prev) => ({
              ...prev,
              leftPanel: { ...prev.leftPanel, selectedIndex: newIndex },
              rightPanel: {
                ...prev.rightPanel,
                selectedTask: tasks[newIndex] ?? null,
              },
            }));
          }
          break;

        case 'down':
        case 'j':
          if (selectedIndex < tasks.length - 1) {
            const newIndex = selectedIndex + 1;
            setState((prev) => ({
              ...prev,
              leftPanel: { ...prev.leftPanel, selectedIndex: newIndex },
              rightPanel: {
                ...prev.rightPanel,
                selectedTask: tasks[newIndex] ?? null,
              },
            }));
          }
          break;

        case 'p':
          // Toggle pause/resume
          setState((prev) => ({
            ...prev,
            header: {
              ...prev.header,
              status: prev.header.status === 'running' ? 'paused' : 'running',
            },
          }));
          break;
      }
    },
    [state.leftPanel, onQuit],
  );

  useKeyboard(handleKeyboard);

  // Calculate content area height (total height minus header and footer)
  const contentHeight = Math.max(
    1,
    height - layout.header.height - layout.footer.height,
  );

  // Determine if we should use a compact layout for narrow terminals
  const isCompact = width < 80;

  return (
    <box
      style={{
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        backgroundColor: colors.bg.primary,
      }}
    >
      {/* Header - compact design */}
      <Header
        status={state.header.status}
        elapsedTime={elapsedTime}
        completedTasks={state.header.completedTasks}
        totalTasks={state.header.totalTasks}
      />

      {/* Main content area */}
      <box
        style={{
          flexGrow: 1,
          flexDirection: isCompact ? 'column' : 'row',
          height: contentHeight,
        }}
      >
        <LeftPanel
          tasks={state.leftPanel.tasks}
          selectedIndex={state.leftPanel.selectedIndex}
        />
        <RightPanel
          selectedTask={state.rightPanel.selectedTask}
          currentIteration={state.rightPanel.currentIteration}
          iterationOutput={state.rightPanel.iterationOutput}
        />
      </box>

      {/* Footer */}
      <Footer />
    </box>
  );
}
