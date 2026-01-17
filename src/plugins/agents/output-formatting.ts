/**
 * ABOUTME: Shared output formatting utilities for agent plugins.
 * Provides structured output formatting for TUI-native rendering.
 *
 * Architecture:
 * - Agents parse their specific output format into AgentDisplayEvent[]
 * - This module decides WHAT to display (via processAgentEvents)
 * - This module decides HOW to display it (via format* functions)
 * - Output is FormattedSegment[] for TUI-native color rendering
 */

/**
 * Semantic color names for formatted output.
 * Maps to TUI theme colors for consistent styling.
 */
export type SegmentColor = 'blue' | 'purple' | 'cyan' | 'green' | 'yellow' | 'pink' | 'muted' | 'default';

/**
 * A single segment of formatted text with optional color.
 */
export interface FormattedSegment {
  text: string;
  color?: SegmentColor;
}

/**
 * ANSI color codes for terminal output formatting (legacy/testing).
 * Prefer FormattedSegment for TUI rendering.
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
 * Format tool call details from input fields (legacy string version).
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
    const displayOld = input.old_string.length > 50
      ? input.old_string.slice(0, 50) + '...'
      : input.old_string;
    const displayNew = input.new_string.length > 50
      ? input.new_string.slice(0, 50) + '...'
      : input.new_string;
    parts.push(`edit: "${displayOld}" → "${displayNew}"`);
  }

  return parts.join(' ') + '\n';
}

// ============================================================================
// TUI-NATIVE SEGMENT-BASED FORMATTING
// ============================================================================

/**
 * Clean a command string (remove env vars, normalize whitespace, truncate).
 */
function cleanCommand(command: string): string {
  let cmd = command.replace(/\n/g, ' ').trim();

  if (cmd.includes(';')) {
    const parts = cmd.split(';');
    cmd = parts[parts.length - 1].trim();
  }

  const envVarPattern = /^(\s*\w+=[^\s]*\s+)+/;
  if (envVarPattern.test(cmd)) {
    cmd = cmd.replace(envVarPattern, '').trim();
  }

  if (cmd.length > 100) {
    cmd = cmd.slice(0, 100) + '...';
  }

  return cmd;
}

/**
 * Format a tool call as an array of colored segments for TUI-native rendering.
 * @param toolName The tool name
 * @param input The tool input object
 * @returns Array of FormattedSegment for rendering
 */
export function formatToolCallSegments(toolName: string, input?: ToolInputFormatters): FormattedSegment[] {
  const segments: FormattedSegment[] = [];

  // Tool name in brackets
  segments.push({ text: `[${toolName}]`, color: 'blue' });

  if (!input) {
    segments.push({ text: '\n' });
    return segments;
  }

  // Description (no color - default text)
  if (input.description) {
    segments.push({ text: ` ${input.description}` });
  }

  // Command with $ prefix (muted color for the $)
  if (input.command) {
    const cmd = cleanCommand(input.command);
    segments.push({ text: ' $ ', color: 'muted' });
    segments.push({ text: cmd });
  }

  // File path in purple
  if (input.file_path || input.path) {
    const path = input.file_path || input.path || '';
    segments.push({ text: ' ' });
    segments.push({ text: path, color: 'purple' });
  }

  // Pattern with label
  if (input.pattern) {
    segments.push({ text: ' pattern: ', color: 'muted' });
    segments.push({ text: input.pattern, color: 'cyan' });
  }

  // Query with label
  if (input.query) {
    segments.push({ text: ' query: ', color: 'muted' });
    segments.push({ text: input.query, color: 'yellow' });
  }

  // URL in cyan
  if (input.url) {
    segments.push({ text: ' ' });
    segments.push({ text: input.url, color: 'cyan' });
  }

  // Content preview
  if (input.content) {
    const preview = input.content.length > 200
      ? `${input.content.slice(0, 200)}... (${input.content.length} chars)`
      : input.content;
    segments.push({ text: ` "${preview}"`, color: 'muted' });
  }

  // Edit diff
  if (input.old_string && input.new_string) {
    const displayOld = input.old_string.length > 50
      ? input.old_string.slice(0, 50) + '...'
      : input.old_string;
    const displayNew = input.new_string.length > 50
      ? input.new_string.slice(0, 50) + '...'
      : input.new_string;
    segments.push({ text: ' edit: "', color: 'muted' });
    segments.push({ text: displayOld, color: 'pink' });
    segments.push({ text: '" → "', color: 'muted' });
    segments.push({ text: displayNew, color: 'green' });
    segments.push({ text: '"', color: 'muted' });
  }

  segments.push({ text: '\n' });
  return segments;
}

/**
 * Format an error message as segments.
 */
export function formatErrorSegments(message: string): FormattedSegment[] {
  return [
    { text: '\n' },
    { text: `[Error: ${message}]`, color: 'pink' },
    { text: '\n' },
  ];
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
 * Process agent events and format for display (legacy string version).
 * @param events Array of parsed agent events
 * @returns Formatted string for display
 */
export function processAgentEvents(events: AgentDisplayEvent[]): string {
  const parts: string[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'text':
        if (event.content) {
          // Ensure text ends with newline so streaming parser treats it as a complete line
          // Otherwise text gets buffered and concatenated with the next chunk (e.g., tool call)
          const text = event.content.endsWith('\n') ? event.content : event.content + '\n';
          parts.push(text);
        }
        break;

      case 'tool_use':
        // Add newline before tool call if there's preceding content (like text)
        // This ensures "Let me check...[Glob]" becomes "Let me check...\n[Glob]"
        // formatToolCall adds its own trailing newline
        if (parts.length > 0 && !parts[parts.length - 1]!.endsWith('\n')) {
          parts.push('\n');
        }
        parts.push(formatToolCall(event.name, event.input as ToolInputFormatters));
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

/**
 * Process agent events and return TUI-native segments for rendering.
 * This is the preferred method for TUI display.
 *
 * Display rules (consistent across all agents):
 * - text: Always displayed (default color)
 * - tool_use: Always displayed (formatted with colors)
 * - tool_result: Skipped (contains raw output like file contents)
 * - error: Always displayed (pink)
 * - system: Skipped (init, hooks, metadata)
 *
 * @param events Array of parsed agent events
 * @returns Array of FormattedSegment for TUI rendering
 */
export function processAgentEventsToSegments(events: AgentDisplayEvent[]): FormattedSegment[] {
  const segments: FormattedSegment[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'text':
        if (event.content) {
          // Ensure text ends with newline so streaming parser treats it as a complete line
          const text = event.content.endsWith('\n') ? event.content : event.content + '\n';
          segments.push({ text });
        }
        break;

      case 'tool_use':
        // Add newline before tool call if there's preceding content (like text)
        if (segments.length > 0 && !segments[segments.length - 1]!.text.endsWith('\n')) {
          segments.push({ text: '\n' });
        }
        segments.push(...formatToolCallSegments(event.name, event.input as ToolInputFormatters));
        break;

      case 'error':
        segments.push(...formatErrorSegments(event.message));
        break;

      // Intentionally skip these for clean output:
      case 'tool_result':
      case 'system':
        break;
    }
  }

  return segments;
}

/**
 * Convert FormattedSegment array to plain string (for testing/logging).
 * Strips all color information.
 */
export function segmentsToPlainText(segments: FormattedSegment[]): string {
  return segments.map(s => s.text).join('');
}

/**
 * Strip ANSI escape sequences from a string.
 * Used to clean output for TUI rendering where ANSI codes would cause artifacts.
 *
 * Only matches sequences that start with ESC (\x1b) to avoid accidentally
 * stripping regular text that might contain bracket patterns.
 *
 * Matches:
 * - CSI sequences: ESC[...letter (colors, cursor, etc.)
 * - OSC sequences: ESC]...BEL (window title, etc.)
 * - Charset switching: ESC(A, ESC)B, etc.
 *
 * Uses RegExp constructor to avoid embedded control characters in source.
 */
const ANSI_REGEX = new RegExp(
  // CSI sequences: ESC[...letter | OSC sequences: ESC]...BEL | Charset: ESC(/)AB012
  '\\x1b\\[[0-9;?]*[a-zA-Z]|\\x1b\\][^\\x07]*\\x07|\\x1b[()][AB012]',
  'g'
);

export function stripAnsiCodes(str: string): string {
  return str.replace(ANSI_REGEX, '');
}
