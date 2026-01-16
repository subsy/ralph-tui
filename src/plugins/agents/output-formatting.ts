/**
 * ABOUTME: Shared output formatting utilities for agent plugins.
 * Provides ANSI colors and consistent tool call formatting across all agents.
 *
 * Architecture:
 * - Agents parse their specific output format into AgentDisplayEvent[]
 * - This module decides WHAT to display (via processAgentEvents)
 * - This module decides HOW to display it (via format* functions)
 */

/**
 * ANSI color codes for terminal output formatting.
 * These render in the TUI's output panel.
 */
export const COLORS = {
  blue: '\x1b[94m',      // Bright blue for tool names
  purple: '\x1b[95m',    // Bright magenta for file paths
  cyan: '\x1b[96m',      // Bright cyan for patterns/URLs
  green: '\x1b[92m',     // Bright green for success
  yellow: '\x1b[93m',    // Bright yellow for warnings/queries
  pink: '\x1b[91m',      // Bright red for errors
  muted: '\x1b[90m',     // Gray for secondary info
  reset: '\x1b[0m',      // Reset to default
} as const;

/**
 * Format a tool name with consistent styling (blue like accent.primary).
 * @param toolName The name of the tool (e.g., "glob", "read", "bash")
 * @returns Formatted string with theme colors
 */
export function formatToolName(toolName: string): string {
  return `${COLORS.blue}[${toolName}]${COLORS.reset}`;
}

/**
 * Format a file path with consistent styling (purple like accent.secondary).
 * @param path The file path
 * @returns Formatted string with theme colors
 */
export function formatPath(path: string): string {
  return `${COLORS.purple}${path}${COLORS.reset}`;
}

/**
 * Format a bash command with $ prefix.
 * Extracts the actual command from environment setup noise.
 * @param command The command string (may include env vars)
 * @returns Formatted string with just the meaningful command
 */
export function formatCommand(command: string): string {
  // Normalize newlines to spaces
  let cmd = command.replace(/\n/g, ' ').trim();

  // Extract actual command from env var setup
  // Pattern: ENV_VAR=value ... ; actual_command
  if (cmd.includes(';')) {
    const parts = cmd.split(';');
    cmd = parts[parts.length - 1].trim();
  }

  // Also handle inline env vars before command (VAR=val VAR2=val2 command)
  // If the command starts with lots of VAR= patterns, try to find the actual command
  const envVarPattern = /^(\s*\w+=[^\s]*\s+)+/;
  if (envVarPattern.test(cmd)) {
    cmd = cmd.replace(envVarPattern, '').trim();
  }

  // Truncate very long commands
  if (cmd.length > 100) {
    cmd = cmd.slice(0, 100) + '...';
  }

  return `$ ${cmd}`;
}

/**
 * Format an error message (pink like status.error).
 * @param message The error message
 * @returns Formatted string with theme colors
 */
export function formatError(message: string): string {
  return `${COLORS.pink}[Error: ${message}]${COLORS.reset}`;
}

/**
 * Format a search pattern or query (cyan like accent.tertiary).
 * @param pattern The pattern or query string
 * @returns Formatted string with theme colors
 */
export function formatPattern(pattern: string): string {
  return `pattern: ${COLORS.cyan}${pattern}${COLORS.reset}`;
}

/**
 * Format a URL (cyan like accent.tertiary).
 * @param url The URL string
 * @returns Formatted string with theme colors
 */
export function formatUrl(url: string): string {
  return `${COLORS.cyan}${url}${COLORS.reset}`;
}

/**
 * Common tool input field names and their formatters.
 * Used to automatically extract and format tool call details.
 */
export interface ToolInputFormatters {
  /** Bash command */
  command?: string;
  /** File path */
  file_path?: string;
  path?: string;
  /** Search pattern */
  pattern?: string;
  /** URL */
  url?: string;
  /** Query string */
  query?: string;
  /** Description */
  description?: string;
  /** Content for write/edit operations */
  content?: string;
  /** Old string for edit operations */
  old_string?: string;
  /** New string for edit operations */
  new_string?: string;
}

/**
 * Format tool call details from input fields.
 * Automatically detects and formats common tool input patterns.
 * @param toolName The tool name
 * @param input The tool input object (can have various fields)
 * @returns Formatted string for display
 */
export function formatToolCall(toolName: string, input?: ToolInputFormatters): string {
  const parts: string[] = [formatToolName(toolName)];

  if (!input) {
    return parts.join(' ') + '\n';
  }

  // Add relevant details based on tool type
  if (input.description) {
    parts.push(input.description);
  }
  if (input.command) {
    parts.push(formatCommand(input.command));
  }
  if (input.file_path || input.path) {
    parts.push(formatPath(input.file_path || input.path || ''));
  }
  if (input.pattern) {
    parts.push(formatPattern(input.pattern));
  }
  if (input.query) {
    parts.push(`query: ${COLORS.yellow}${input.query}${COLORS.reset}`);
  }
  if (input.url) {
    parts.push(formatUrl(input.url));
  }
  if (input.content) {
    // For write/edit operations, show preview of content
    const preview = input.content.length > 200
      ? `${input.content.slice(0, 200)}... (${input.content.length} chars)`
      : input.content;
    parts.push(`"${preview}"`);
  }
  if (input.old_string && input.new_string) {
    parts.push(`edit: "${input.old_string.slice(0, 50)}..." → "${input.new_string.slice(0, 50)}..."`);
  }

  return parts.join(' ') + '\n';
}

/**
 * Common event types that agents can emit.
 * Agents parse their specific output format into these standardized events.
 */
export type AgentDisplayEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; name: string; input?: Record<string, unknown> }
  | { type: 'tool_result'; content?: string }
  | { type: 'error'; message: string }
  | { type: 'system'; subtype?: string; content?: string };

/**
 * Process agent events and format for display.
 * This is the SINGLE place that decides what to show - all agents use this.
 *
 * Display rules (consistent across all agents):
 * - text: Always displayed
 * - tool_use: Always displayed (formatted with tool name and key inputs)
 * - tool_result: Skipped (contains raw output like file contents)
 * - error: Always displayed
 * - system: Skipped (init, hooks, metadata)
 *
 * @param events Array of parsed agent events
 * @returns Formatted string for display
 */
export function processAgentEvents(events: AgentDisplayEvent[]): string {
  const parts: string[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'text':
        if (event.content) {
          parts.push(event.content);
        }
        break;

      case 'tool_use':
        // Tool calls always start on their own line
        parts.push('\n' + formatToolCall(event.name, event.input as ToolInputFormatters));
        break;

      case 'error':
        parts.push('\n' + formatError(event.message) + '\n');
        break;

      // Intentionally skip these for clean output:
      case 'tool_result':
      case 'system':
        break;
    }
  }

  return parts.join('');
}
