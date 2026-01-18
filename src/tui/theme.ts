/**
 * ABOUTME: Theme constants and types for the Ralph TUI application.
 * Provides consistent styling across all TUI components with a modern dark theme.
 */

/**
 * Color palette for the Ralph TUI
 */
export const colors = {
  // Background colors
  bg: {
    primary: '#1a1b26',
    secondary: '#24283b',
    tertiary: '#2f3449',
    highlight: '#3d4259',
  },

  // Foreground (text) colors
  fg: {
    primary: '#c0caf5',
    secondary: '#a9b1d6',
    muted: '#565f89',
    dim: '#414868',
  },

  // Status colors
  status: {
    success: '#9ece6a',
    warning: '#e0af68',
    error: '#f7768e',
    info: '#7aa2f7',
  },

  // Task status colors
  task: {
    done: '#9ece6a',
    active: '#7aa2f7',
    actionable: '#9ece6a', // Green - ready to work on
    pending: '#565f89',
    blocked: '#f7768e',
    error: '#f7768e', // Same as blocked - red for errors
    closed: '#414868', // Greyed out for completed/closed tasks
  },

  // Accent colors
  accent: {
    primary: '#7aa2f7',
    secondary: '#bb9af7',
    tertiary: '#7dcfff',
  },

  // Border colors
  border: {
    normal: '#3d4259',
    active: '#7aa2f7',
    muted: '#2f3449',
  },
} as const;

/**
 * Status indicator symbols
 * Task status: ✓ (done), ▶ (active/actionable), ○ (pending), ⊘ (blocked), ✓ (closed - greyed)
 * Ralph status: ▶ (running), ◎ (pausing), ⏸ (paused), ■ (stopped), ✓ (complete), ○ (idle/ready)
 */
export const statusIndicators = {
  done: '✓',
  active: '▶',
  actionable: '▶', // Ready to work on - green arrow
  pending: '○',
  blocked: '⊘',
  error: '✗', // Error/failed task
  closed: '✓', // Same indicator as done, but will be greyed out
  running: '▶',
  selecting: '◐', // Selecting next task - half-filled circle (animated feel)
  executing: '⏵', // Executing agent - play with bar
  pausing: '◎',
  paused: '⏸',
  stopped: '■',
  complete: '✓',
  idle: '○',
  ready: '◉', // Ready to start - waiting for user action
} as const;

/**
 * Keyboard shortcut display mappings for footer (condensed)
 */
export const keyboardShortcuts = [
  { key: 'q', description: 'Quit' },
  { key: 's', description: 'Start' },
  { key: 'p', description: 'Pause/Resume' },
  { key: '+', description: '+10 iters' },
  { key: '-', description: '-10 iters' },
  { key: 'r', description: 'Refresh' },
  { key: 'l', description: 'Load Epic' },
  { key: ',', description: 'Settings' },
  { key: 'd', description: 'Dashboard' },
  { key: 'o', description: 'Cycle Views' },
  { key: 'O', description: 'Prompt' },
  { key: 't', description: 'Trace' },
  { key: '↑↓', description: 'Navigate' },
  { key: '?', description: 'Help' },
] as const;

/**
 * Full keyboard shortcuts for help overlay
 */
export const fullKeyboardShortcuts = [
  { key: '?', description: 'Show/hide this help', category: 'General' },
  { key: 'q', description: 'Quit Ralph', category: 'General' },
  { key: 'Esc', description: 'Go back / Cancel', category: 'General' },
  { key: ',', description: 'Open settings', category: 'General' },
  {
    key: 's',
    description: 'Start execution (when ready)',
    category: 'Execution',
  },
  { key: 'p', description: 'Pause / Resume execution', category: 'Execution' },
  { key: '+', description: 'Add 10 iterations', category: 'Execution' },
  { key: '-', description: 'Remove 10 iterations', category: 'Execution' },
  {
    key: 'r',
    description: 'Refresh task list from tracker',
    category: 'Execution',
  },
  { key: 'l', description: 'Load / switch epic', category: 'Execution' },
  { key: 'd', description: 'Toggle progress dashboard', category: 'Views' },
  { key: 'h', description: 'Toggle show/hide closed tasks', category: 'Views' },
  { key: 'v', description: 'Toggle iterations / tasks view', category: 'Views' },
  { key: 'o', description: 'Cycle views (details/output/prompt)', category: 'Views' },
  { key: 'O', description: 'Jump to prompt preview', category: 'Views' },
  { key: 't', description: 'Cycle subagent detail level', category: 'Views' },
  { key: 'T', description: 'Toggle subagent tree panel', category: 'Views' },
  { key: '↑ / k', description: 'Move selection up', category: 'Navigation' },
  { key: '↓ / j', description: 'Move selection down', category: 'Navigation' },
  {
    key: 'Enter',
    description: 'View selected item details',
    category: 'Navigation',
  },
  {
    key: 'Ctrl+C',
    description: 'Interrupt (with confirmation)',
    category: 'System',
  },
  {
    key: 'Ctrl+C ×2',
    description: 'Force quit immediately',
    category: 'System',
  },
] as const;

/**
 * Layout dimensions
 */
export const layout = {
  header: {
    // Compact single-line header (no border)
    height: 1,
  },
  footer: {
    height: 3,
  },
  progressDashboard: {
    // Height when dashboard is shown: 2 (border) + 2 (padding) + 2 (content rows)
    height: 6,
  },
  leftPanel: {
    minWidth: 30,
    maxWidth: 50,
    defaultWidthPercent: 35,
  },
  rightPanel: {
    minWidth: 40,
  },
  padding: {
    small: 1,
    medium: 2,
  },
} as const;

/**
 * Ralph status types
 * - 'ready': Waiting for user to start execution (interactive mode)
 * - 'running': Actively executing iterations (generic running state)
 * - 'selecting': Selecting next task to work on
 * - 'executing': Executing agent on current task
 * - 'pausing': Pause requested, waiting for current iteration to complete
 * - 'paused': Paused, waiting to resume
 * - 'stopped': Not running (generic)
 * - 'complete': All tasks finished successfully
 * - 'idle': Stopped, no more tasks available
 * - 'error': Stopped due to error
 */
export type RalphStatus =
  | 'ready'
  | 'running'
  | 'selecting'
  | 'executing'
  | 'pausing'
  | 'paused'
  | 'stopped'
  | 'complete'
  | 'idle'
  | 'error';

/**
 * Task status types matching the acceptance criteria
 * - 'done': Task completed in current session (green checkmark)
 * - 'active': Task currently being worked on (blue arrow)
 * - 'actionable': Task ready to work on with no blocking dependencies (green arrow)
 * - 'pending': Task waiting to be worked on (grey circle) - legacy, prefer actionable
 * - 'blocked': Task blocked by dependencies (red symbol)
 * - 'error': Task execution failed (red X)
 * - 'closed': Previously completed task (greyed out checkmark for historical tasks)
 */
export type TaskStatus =
  | 'done'
  | 'active'
  | 'actionable'
  | 'pending'
  | 'blocked'
  | 'error'
  | 'closed';

/**
 * Get the color for a given task status
 */
export function getTaskStatusColor(status: TaskStatus): string {
  return colors.task[status];
}

/**
 * Get the indicator symbol for a given task status
 */
export function getTaskStatusIndicator(status: TaskStatus): string {
  return statusIndicators[status];
}

/**
 * Format elapsed time in human-readable format
 */
export function formatElapsedTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}
