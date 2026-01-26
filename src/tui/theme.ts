/**
 * ABOUTME: Theme constants and types for the Ralph TUI application.
 * Provides consistent styling across all TUI components with a modern dark theme.
 * Includes functionality to load custom themes from JSON files.
 */

import { readFile, access, constants } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';

/**
 * Theme color structure matching the colors constant.
 * All color values must be valid 6-digit hex codes (e.g., "#1a1b26").
 */
export interface ThemeColors {
  bg: {
    primary: string;
    secondary: string;
    tertiary: string;
    highlight: string;
  };
  fg: {
    primary: string;
    secondary: string;
    muted: string;
    dim: string;
  };
  status: {
    success: string;
    warning: string;
    error: string;
    info: string;
  };
  task: {
    done: string;
    active: string;
    actionable: string;
    pending: string;
    blocked: string;
    error: string;
    closed: string;
  };
  accent: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  border: {
    normal: string;
    active: string;
    muted: string;
  };
}

/**
 * Default Tokyo Night color palette for the Ralph TUI.
 * This constant preserves the original values and serves as the base for theming.
 */
export const defaultColors: ThemeColors = {
  bg: {
    primary: '#1a1b26',
    secondary: '#24283b',
    tertiary: '#2f3449',
    highlight: '#3d4259',
  },
  fg: {
    primary: '#c0caf5',
    secondary: '#a9b1d6',
    muted: '#565f89',
    dim: '#414868',
  },
  status: {
    success: '#9ece6a',
    warning: '#e0af68',
    error: '#f7768e',
    info: '#7aa2f7',
  },
  task: {
    done: '#9ece6a',
    active: '#9ece6a',
    actionable: '#9ece6a',
    pending: '#565f89',
    blocked: '#f7768e',
    error: '#f7768e',
    closed: '#414868',
  },
  accent: {
    primary: '#7aa2f7',
    secondary: '#bb9af7',
    tertiary: '#7dcfff',
  },
  border: {
    normal: '#3d4259',
    active: '#7aa2f7',
    muted: '#2f3449',
  },
};

/**
 * Internal mutable state for the active theme colors.
 * Initialized with default Tokyo Night values.
 * Modified by initializeTheme().
 */
let activeColors: ThemeColors = { ...defaultColors };

/**
 * Color palette for the Ralph TUI.
 * References the active theme colors which can be customized via initializeTheme().
 * This export maintains type compatibility with all existing component usage.
 */
export const colors: ThemeColors = new Proxy({} as ThemeColors, {
  get(_target, prop: string) {
    return activeColors[prop as keyof ThemeColors];
  },
});

/**
 * Status indicator symbols
 * Task status: ✓ (done), ▶ (active/running), ○ (actionable/pending), ⊘ (blocked), ✗ (error), ✓ (closed - greyed)
 * Ralph status: ▶ (running), ◎ (pausing), ⏸ (paused), ■ (stopped), ✓ (complete), ○ (idle/ready)
 */
export const statusIndicators = {
  done: '✓',
  active: '▶', // Currently running - green play triangle
  actionable: '○', // Ready to work on - green circle
  pending: '○',
  blocked: '⊘', // Blocked by dependencies - red no-entry
  error: '✗', // Error/failed task - red x
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
  { key: '1-9', description: 'Switch Tab' },
  { key: '[]', description: 'Prev/Next Tab' },
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
  { key: 's', description: 'Start execution (when ready)', category: 'Execution' },
  { key: 'p', description: 'Pause / Resume execution', category: 'Execution' },
  { key: '+', description: 'Add 10 iterations', category: 'Execution' },
  { key: '-', description: 'Remove 10 iterations', category: 'Execution' },
  { key: 'r', description: 'Refresh task list from tracker', category: 'Execution' },
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
  { key: 'Enter', description: 'View selected item details', category: 'Navigation' },
  { key: '1-9', description: 'Switch to tab by number', category: 'Instances' },
  { key: '[', description: 'Previous tab', category: 'Instances' },
  { key: ']', description: 'Next tab', category: 'Instances' },
  { key: 'Ctrl+Tab', description: 'Next tab (alternate)', category: 'Instances' },
  { key: 'Ctrl+Shift+Tab', description: 'Previous tab (alternate)', category: 'Instances' },
  { key: 'Ctrl+C', description: 'Interrupt (with confirmation)', category: 'System' },
  { key: 'Ctrl+C ×2', description: 'Force quit immediately', category: 'System' },
] as const;

/**
 * Layout dimensions
 */
export const layout = {
  tabBar: {
    // Tab bar for instance navigation
    height: 1,
  },
  header: {
    // Compact single-line header (no border)
    height: 1,
  },
  footer: {
    height: 3,
  },
  progressDashboard: {
    // Height when dashboard is shown: 2 (border) + 2 (padding) + 4 (content rows for grid layout)
    height: 8,
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
export type RalphStatus = 'ready' | 'running' | 'selecting' | 'executing' | 'pausing' | 'paused' | 'stopped' | 'complete' | 'idle' | 'error';

/**
 * Task status types matching the acceptance criteria
 * - 'done': Task completed in current session (green checkmark ✓)
 * - 'active': Task currently being worked on (green play triangle ▶)
 * - 'actionable': Task ready to work on with no blocking dependencies (green circle ○)
 * - 'pending': Task waiting to be worked on (grey circle ○) - legacy, prefer actionable
 * - 'blocked': Task blocked by dependencies (red no-entry ⊘)
 * - 'error': Task execution failed (red X ✗)
 * - 'closed': Previously completed task (greyed out checkmark ✓ for historical tasks)
 */
export type TaskStatus = 'done' | 'active' | 'actionable' | 'pending' | 'blocked' | 'error' | 'closed';

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

/**
 * Partial theme color structure allowing any subset of theme colors.
 * Used for custom themes that only override specific colors.
 */
export type PartialThemeColors = {
  bg?: Partial<ThemeColors['bg']>;
  fg?: Partial<ThemeColors['fg']>;
  status?: Partial<ThemeColors['status']>;
  task?: Partial<ThemeColors['task']>;
  accent?: Partial<ThemeColors['accent']>;
  border?: Partial<ThemeColors['border']>;
};

/**
 * Default Tokyo Night theme colors.
 * Alias for defaultColors maintained for backwards compatibility.
 */
export const defaultThemeColors: ThemeColors = defaultColors;

/**
 * Deep merges a custom theme with defaults.
 * Custom theme values override defaults at any nesting level.
 * Missing categories or keys fall back to default Tokyo Night values.
 * @param customTheme Partial theme colors to merge
 * @param defaults Base theme colors (defaults to Tokyo Night)
 * @returns Complete ThemeColors with all keys defined
 */
export function mergeTheme(
  customTheme: PartialThemeColors,
  defaults: ThemeColors = defaultColors
): ThemeColors {
  return {
    bg: { ...defaults.bg, ...customTheme.bg },
    fg: { ...defaults.fg, ...customTheme.fg },
    status: { ...defaults.status, ...customTheme.status },
    task: { ...defaults.task, ...customTheme.task },
    accent: { ...defaults.accent, ...customTheme.accent },
    border: { ...defaults.border, ...customTheme.border },
  };
}

// Type alias for backwards compatibility
export type Colors = ThemeColors;
export type PartialColors = PartialThemeColors;

/**
 * Regular expression for validating 6-digit hex color codes.
 * Matches format: #RRGGBB where R, G, B are hexadecimal digits.
 */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/**
 * Validates that a string is a valid 6-digit hex color code.
 * @param value The value to validate
 * @returns true if valid hex color, false otherwise
 */
export function isValidHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

/**
 * Recursively validates all color values in a theme object.
 * @param obj The object to validate
 * @param path Current path for error messages
 * @returns Array of validation errors (empty if valid)
 */
function validateColors(obj: unknown, path: string = ''): string[] {
  const errors: string[] = [];

  if (typeof obj !== 'object' || obj === null) {
    return errors;
  }

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;

    if (typeof value === 'string') {
      if (!isValidHexColor(value)) {
        errors.push(`Invalid hex color at '${currentPath}': '${value}' (expected format: #RRGGBB)`);
      }
    } else if (typeof value === 'object' && value !== null) {
      errors.push(...validateColors(value, currentPath));
    }
  }

  return errors;
}

/**
 * Load and validate a theme file from the given path.
 * @param filePath Path to the JSON theme file (absolute or relative to cwd)
 * @returns Parsed and validated theme colors object
 * @throws Error if file doesn't exist, can't be read, has invalid JSON, or has invalid colors
 */
export async function loadThemeFile(filePath: string): Promise<ThemeColors> {
  const resolvedPath = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);

  try {
    await access(resolvedPath, constants.R_OK);
  } catch {
    throw new Error(`Theme file not found or not readable: ${resolvedPath}`);
  }

  let content: string;
  try {
    content = await readFile(resolvedPath, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read theme file '${resolvedPath}': ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in theme file '${resolvedPath}': ${message}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Theme file '${resolvedPath}' must contain a JSON object`);
  }

  const colorErrors = validateColors(parsed);
  if (colorErrors.length > 0) {
    throw new Error(
      `Invalid colors in theme file '${resolvedPath}':\n  ${colorErrors.join('\n  ')}`
    );
  }

  return parsed as ThemeColors;
}

/**
 * Initialize the theme colors for the application.
 * If a theme path is provided, loads and merges the custom theme with defaults.
 * If no path is provided, uses the default Tokyo Night theme.
 *
 * This function validates the theme file before modifying state - if the file
 * is invalid, an error is thrown and the current theme remains unchanged.
 *
 * @param themePath Optional path to a JSON theme file
 * @throws Error if the theme file is invalid (file not found, invalid JSON, invalid colors)
 */
export async function initializeTheme(themePath?: string): Promise<void> {
  if (!themePath) {
    activeColors = { ...defaultColors };
    return;
  }

  const customTheme = await loadThemeFile(themePath);
  const mergedTheme = mergeTheme(customTheme as PartialThemeColors);
  activeColors = mergedTheme;
}

/**
 * Reset the theme to default Tokyo Night colors.
 * Useful for testing or when the user wants to revert to defaults.
 */
export function resetTheme(): void {
  activeColors = { ...defaultColors };
}
