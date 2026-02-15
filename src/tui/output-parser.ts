/**
 * ABOUTME: Parses agent output to extract readable content.
 * Handles JSONL format from Claude Code and other agents to extract
 * the meaningful result text while filtering out usage stats and metadata.
 * Includes streaming parser for real-time output processing.
 */

import {
  DroidCostAccumulator,
  formatDroidCostSummary,
  formatDroidEventForDisplay,
  formatDroidEventToSegments,
  parseDroidJsonlLine,
  type DroidJsonlMessage,
} from '../plugins/agents/droid/outputParser.js';
import { stripAnsiCodes, type FormattedSegment } from '../plugins/agents/output-formatting.js';

/**
 * Known JSONL event types from agent output.
 * Claude Code emits events like 'result', 'assistant', 'tool_use', etc.
 */
type AgentEventType = 'result' | 'assistant' | 'tool_use' | 'tool_result' | 'error' | 'system' | string;

/**
 * Structure of a Claude Code result event.
 */
interface ClaudeCodeResultEvent {
  type: 'result';
  subtype?: string;
  result?: string;
  is_error?: boolean;
  duration_ms?: number;
  total_cost_usd?: number;
  [key: string]: unknown;
}

/**
 * Structure of an assistant event (partial message output).
 */
interface AssistantEvent {
  type: 'assistant';
  message?: {
    content?: Array<{ type: string; text?: string }> | string;
  };
  [key: string]: unknown;
}

/**
 * Generic JSONL event structure.
 */
interface AgentEvent {
  type: AgentEventType;
  [key: string]: unknown;
}

function isDroidAgent(agentPlugin?: string): boolean {
  return agentPlugin?.toLowerCase().includes('droid') ?? false;
}

function isOpenCodeAgent(agentPlugin?: string): boolean {
  return agentPlugin?.toLowerCase() === 'opencode';
}

function isGeminiAgent(agentPlugin?: string): boolean {
  return agentPlugin?.toLowerCase() === 'gemini';
}

function isCodexAgent(agentPlugin?: string): boolean {
  return agentPlugin?.toLowerCase() === 'codex';
}

function isKimiAgent(agentPlugin?: string): boolean {
  return agentPlugin?.toLowerCase() === 'kimi';
}

/**
 * Structure of a Kimi CLI stream-json event.
 * Kimi CLI uses --output-format stream-json which emits events like:
 * - {"role":"assistant","content":[{"type":"think","think":"..."},{"type":"text","text":"..."}]}
 * - {"role":"tool","content":[{"type":"function","function":{"name":"...","arguments":"..."}}]}
 * - Tool results, status updates, etc.
 */
interface KimiEvent {
  role?: string;
  content?: Array<{
    type: string;
    text?: string;
    think?: string;
    function?: {
      name: string;
      arguments?: string;
    };
    is_error?: boolean;
    output?: string;
    return_value?: {
      is_error?: boolean;
      output?: string;
      message?: string;
    };
  }>;
  type?: string;
  error?: unknown;
  message?: string;
}

/**
 * Parse a Kimi CLI stream-json line and return the parsed event if valid.
 */
function parseKimiJsonlLine(line: string): { success: boolean; event?: KimiEvent } {
  if (!line.trim() || !line.startsWith('{')) {
    return { success: false };
  }

  try {
    const parsed = JSON.parse(line) as KimiEvent;
    // Kimi events have a role field (assistant, tool) with a content array
    if (parsed.role && Array.isArray(parsed.content)) {
      return { success: true, event: parsed };
    }
    // Also handle error events
    if (parsed.type === 'error' || parsed.error) {
      return { success: true, event: parsed };
    }
    return { success: false };
  } catch {
    return { success: false };
  }
}

/**
 * Format a Kimi event for display.
 * Returns undefined for events that shouldn't be displayed (like think, status).
 */
function formatKimiEventForDisplay(event: KimiEvent): string | undefined {
  if (!event.content || !Array.isArray(event.content)) {
    // Handle error events
    if (event.type === 'error' || event.error) {
      const msg = typeof event.error === 'string' ? event.error :
        typeof event.error === 'object' && event.error !== null && 'message' in event.error
          ? String((event.error as { message?: unknown }).message)
          : event.message || 'Unknown error';
      return `Error: ${msg}`;
    }
    return undefined;
  }

  const parts: string[] = [];

  for (const item of event.content) {
    if (item.type === 'text' && item.text) {
      parts.push(item.text);
    } else if (item.type === 'function' && item.function) {
      // Tool call
      const toolName = item.function.name || 'unknown';
      let detail = '';
      if (item.function.arguments) {
        try {
          const args = JSON.parse(item.function.arguments) as Record<string, unknown>;
          const argStr = Object.entries(args)
            .slice(0, 2)
            .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 50) : '...'}`)
            .join(', ');
          detail = ` ${argStr}`;
        } catch {
          detail = ` ${item.function.arguments.slice(0, 50)}`;
        }
      }
      parts.push(`[Tool: ${toolName}]${detail}`);
    } else if (item.type === 'tool_result' || item.type === 'function_result') {
      // Only show errors from tool results
      const isError = item.is_error === true || item.return_value?.is_error === true;
      if (isError) {
        const errorMsg = item.output || item.return_value?.output || item.return_value?.message || 'tool execution failed';
        parts.push(`[Tool Error] ${String(errorMsg).slice(0, 200)}`);
      }
    }
    // Skip: think (internal reasoning), status updates
  }

  return parts.length > 0 ? parts.join('\n') : undefined;
}

/**
 * Structure of an OpenCode JSONL event.
 */
interface OpenCodeEvent {
  type: 'text' | 'tool_use' | 'tool_result' | 'step_start' | 'step_finish' | 'error';
  part?: {
    text?: string;
    tool?: string;
    name?: string;
    state?: {
      input?: Record<string, unknown>;
      isError?: boolean;
      is_error?: boolean;
      error?: string;
      content?: string;
    };
  };
  error?: {
    message?: string;
  };
}

/**
 * Structure of a Gemini CLI JSONL event.
 * Gemini CLI uses --output-format stream-json which emits events like:
 * - init: session initialization
 * - message: text from user (role=user) or assistant (role=assistant)
 * - tool_use: tool being called
 * - tool_result: tool execution result
 * - result: final stats (not content)
 * - error: error event
 */
interface GeminiEvent {
  type: 'init' | 'message' | 'tool_use' | 'tool_result' | 'result' | 'error';
  role?: 'user' | 'assistant';
  content?: string;
  name?: string;
  tool_name?: string;
  tool_id?: string;
  arguments?: unknown;
  args?: unknown;
  input?: unknown;
  parameters?: unknown;
  is_error?: boolean;
  error?: unknown;
  status?: string;
  stats?: {
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
}

/**
 * Parse a Gemini CLI JSONL line and return the parsed event if valid.
 */
function parseGeminiJsonlLine(line: string): { success: boolean; event?: GeminiEvent } {
  if (!line.trim() || !line.startsWith('{')) {
    return { success: false };
  }

  try {
    const parsed = JSON.parse(line) as GeminiEvent;
    // Check if it looks like a Gemini event (has type field with known values)
    if (parsed.type && ['init', 'message', 'tool_use', 'tool_result', 'result', 'error'].includes(parsed.type)) {
      return { success: true, event: parsed };
    }
    return { success: false };
  } catch {
    return { success: false };
  }
}

/**
 * Format a Gemini event for display.
 * Returns undefined for events that shouldn't be displayed (like init, user messages, stats).
 */
function formatGeminiEventForDisplay(event: GeminiEvent): string | undefined {
  switch (event.type) {
    case 'message':
      // Skip user messages (they echo the input prompt)
      if (event.role === 'user') {
        return undefined;
      }
      // Assistant message - the main content we want to display
      if (event.role === 'assistant' && event.content) {
        return event.content;
      }
      break;

    case 'tool_use': {
      // Tool being called
      const toolName = event.tool_name || event.name || 'unknown';
      const input = event.parameters || event.arguments || event.args || event.input;
      if (input && typeof input === 'object') {
        // Show tool name and key input details
        const inputStr = Object.entries(input as Record<string, unknown>)
          .slice(0, 2)
          .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 50) : '...'}`)
          .join(', ');
        return `[Tool: ${toolName}] ${inputStr}`;
      }
      return `[Tool: ${toolName}]`;
    }

    case 'tool_result': {
      // Tool completed - only show if error
      if (event.is_error === true || event.status === 'error') {
        const errorMsg = typeof event.error === 'string' ? event.error :
          typeof event.error === 'object' && event.error !== null && 'message' in event.error
            ? String((event.error as { message?: unknown }).message)
            : 'tool execution failed';
        return `[Tool Error] ${errorMsg}`;
      }
      // Don't display successful tool results (too verbose)
      return undefined;
    }

    case 'error': {
      // Error from Gemini
      const errorMsg = typeof event.error === 'string' ? event.error :
        typeof event.error === 'object' && event.error !== null && 'message' in event.error
          ? String((event.error as { message?: unknown }).message)
          : 'Unknown error';
      return `Error: ${errorMsg}`;
    }

    case 'init':
    case 'result':
      // Skip init (session start) and result (stats) events
      return undefined;
  }

  return undefined;
}

/**
 * Structure of a Codex CLI JSONL event.
 * Codex CLI uses --json which emits events like:
 * - thread.started: session started
 * - turn.started: turn started
 * - item.started/item.completed: item events (agent_message, command_execution, file_*)
 * - turn.completed: turn finished with usage stats
 */
interface CodexEvent {
  type: 'thread.started' | 'turn.started' | 'item.started' | 'item.completed' | 'turn.completed' | 'error';
  thread_id?: string;
  item?: {
    id?: string;
    type?: 'agent_message' | 'command_execution' | 'todo_list' | 'file_edit' | 'file_write' | 'file_read';
    text?: string;
    command?: string;
    exit_code?: number | null;
    aggregated_output?: string;
    status?: string;
    file_path?: string;
    path?: string;
    items?: Array<{ text: string; completed: boolean }>;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cached_input_tokens?: number;
  };
  error?: unknown;
}

/**
 * Parse a Codex CLI JSONL line and return the parsed event if valid.
 */
function parseCodexJsonlLine(line: string): { success: boolean; event?: CodexEvent } {
  if (!line.trim() || !line.startsWith('{')) {
    return { success: false };
  }

  try {
    const parsed = JSON.parse(line) as CodexEvent;
    // Check if it looks like a Codex event (has type field with known values)
    if (parsed.type && ['thread.started', 'turn.started', 'item.started', 'item.completed', 'turn.completed', 'error'].includes(parsed.type)) {
      return { success: true, event: parsed };
    }
    return { success: false };
  } catch {
    return { success: false };
  }
}

/**
 * Format a Codex event for display.
 * Returns undefined for events that shouldn't be displayed (like thread/turn lifecycle).
 */
function formatCodexEventForDisplay(event: CodexEvent): string | undefined {
  // Handle item events
  if (event.type === 'item.completed' || event.type === 'item.started') {
    const item = event.item;
    if (!item) return undefined;

    // Agent message - extract text
    if (item.type === 'agent_message' && item.text) {
      return item.text;
    }

    // Command execution
    if (item.type === 'command_execution') {
      if (event.type === 'item.started' && item.command) {
        return `[Shell] ${item.command}`;
      }
      if (event.type === 'item.completed') {
        const isError = item.exit_code !== 0 && item.exit_code !== null;
        if (isError && item.aggregated_output) {
          return `[Shell Error] ${item.aggregated_output.slice(0, 200)}`;
        }
      }
      return undefined;
    }

    // File operations
    if (item.type === 'file_edit' || item.type === 'file_write' || item.type === 'file_read') {
      if (event.type === 'item.started') {
        const filePath = item.file_path || item.path || 'unknown';
        return `[${item.type}] ${filePath}`;
      }
      return undefined;
    }
  }

  // Error events
  if (event.type === 'error' && event.error) {
    const errorMsg = typeof event.error === 'string' ? event.error :
      typeof event.error === 'object' && event.error !== null && 'message' in event.error
        ? String((event.error as { message?: unknown }).message)
        : 'Unknown error';
    return `Error: ${errorMsg}`;
  }

  // Skip: thread.started, turn.started, turn.completed (no displayable content)
  return undefined;
}

/**
 * Parse an OpenCode JSONL line and return the parsed event if valid.
 */
function parseOpenCodeJsonlLine(line: string): { success: boolean; event?: OpenCodeEvent } {
  if (!line.trim() || !line.startsWith('{')) {
    return { success: false };
  }

  try {
    const parsed = JSON.parse(line) as OpenCodeEvent;
    // Check if it looks like an opencode event
    if (parsed.type && ['text', 'tool_use', 'tool_result', 'step_start', 'step_finish', 'error'].includes(parsed.type)) {
      return { success: true, event: parsed };
    }
    return { success: false };
  } catch {
    return { success: false };
  }
}

/**
 * Format an OpenCode event for display.
 * Returns undefined for events that shouldn't be displayed (like step markers).
 */
function formatOpenCodeEventForDisplay(event: OpenCodeEvent): string | undefined {
  switch (event.type) {
    case 'text':
      // Main text output from the LLM
      if (event.part?.text) {
        return event.part.text;
      }
      break;

    case 'tool_use': {
      // Tool being called - show name
      const toolName = event.part?.tool || event.part?.name || 'unknown';
      const input = event.part?.state?.input;
      if (input) {
        // Show tool name and key input details
        const inputStr = Object.entries(input)
          .slice(0, 2)
          .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 50) : '...'}`)
          .join(', ');
        return `[Tool: ${toolName}] ${inputStr}`;
      }
      return `[Tool: ${toolName}]`;
    }

    case 'tool_result': {
      // Tool completed - only show if error
      const resultState = event.part?.state;
      const isError = resultState?.isError === true || resultState?.is_error === true;
      if (isError) {
        const errorMsg = resultState?.error || resultState?.content || 'tool execution failed';
        return `[Tool Error] ${errorMsg}`;
      }
      // Don't display successful tool results (too verbose)
      return undefined;
    }

    case 'error':
      // Error from opencode
      return `Error: ${event.error?.message || 'Unknown error'}`;

    case 'step_start':
    case 'step_finish':
      // Step markers - don't display
      return undefined;
  }

  return undefined;
}

/**
 * Parse a JSONL line and extract any readable content.
 * Returns the extracted text or undefined if the line doesn't contain readable content.
 */
function parseJsonlLine(line: string): string | undefined {
  if (!line.trim()) return undefined;

  try {
    const event = JSON.parse(line) as AgentEvent;

    // Claude Code 'result' event - contains the final output
    if (event.type === 'result') {
      const resultEvent = event as ClaudeCodeResultEvent;
      if (resultEvent.result) {
        return resultEvent.result;
      }
    }

    // Assistant event with message content
    if (event.type === 'assistant') {
      const assistantEvent = event as AssistantEvent;
      const content = assistantEvent.message?.content;
      if (typeof content === 'string') {
        return content;
      }
      if (Array.isArray(content)) {
        // Extract text from content blocks
        const textParts = content
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text);
        if (textParts.length > 0) {
          return textParts.join('');
        }
      }
    }

    // Error event
    if (event.type === 'error' && typeof event.message === 'string') {
      return `Error: ${event.message}`;
    }

    return undefined;
  } catch {
    // Not valid JSON - might be plain text output
    return undefined;
  }
}

/**
 * Parse agent output and extract readable content.
 * Handles:
 * - JSONL output from Claude Code (extracts 'result' field)
 * - Plain text output (passed through as-is)
 * - Mixed content (extracts readable parts)
 *
 * @param rawOutput - The raw stdout from the agent
 * @returns Parsed readable content
 */
export function parseAgentOutput(rawOutput: string, agentPlugin?: string): string {
  if (!rawOutput || !rawOutput.trim()) {
    return '';
  }

  const lines = rawOutput.split('\n');
  const parsedParts: string[] = [];
  const plainTextLines: string[] = [];
  const useDroidParser = isDroidAgent(agentPlugin);
  const useOpenCodeParser = isOpenCodeAgent(agentPlugin);
  const useGeminiParser = isGeminiAgent(agentPlugin);
  const useCodexParser = isCodexAgent(agentPlugin);
  const useKimiParser = isKimiAgent(agentPlugin);
  const droidCostAccumulator = useDroidParser ? new DroidCostAccumulator() : null;
  let hasJsonl = false;

  for (const line of lines) {
    if (useDroidParser) {
      const droidResult = parseDroidJsonlLine(line);
      if (droidResult.success) {
        hasJsonl = true;
        if (droidResult.message.cost && droidCostAccumulator) {
          droidCostAccumulator.add(droidResult.message.cost);
        }
        const droidDisplay = formatDroidEventForDisplay(droidResult.message);
        if (droidDisplay !== undefined) {
          parsedParts.push(droidDisplay);
          continue;
        }
      }
    }

    // OpenCode-specific parsing
    if (useOpenCodeParser) {
      const openCodeResult = parseOpenCodeJsonlLine(line);
      if (openCodeResult.success && openCodeResult.event) {
        hasJsonl = true;
        const openCodeDisplay = formatOpenCodeEventForDisplay(openCodeResult.event);
        if (openCodeDisplay !== undefined) {
          parsedParts.push(openCodeDisplay);
        }
        continue; // Skip generic parsing for opencode events
      }
    }

    // Codex CLI parsing
    if (useCodexParser) {
      const codexResult = parseCodexJsonlLine(line);
      if (codexResult.success && codexResult.event) {
        hasJsonl = true;
        const codexDisplay = formatCodexEventForDisplay(codexResult.event);
        if (codexDisplay !== undefined) {
          parsedParts.push(codexDisplay);
        }
        continue; // Skip generic parsing for codex events
      }
    }

    // Gemini CLI parsing
    if (useGeminiParser) {
      const geminiResult = parseGeminiJsonlLine(line);
      if (geminiResult.success && geminiResult.event) {
        hasJsonl = true;
        const geminiDisplay = formatGeminiEventForDisplay(geminiResult.event);
        if (geminiDisplay !== undefined) {
          parsedParts.push(geminiDisplay);
        }
        continue; // Skip generic parsing for gemini events
      }
    }

    // Kimi CLI parsing
    if (useKimiParser) {
      const kimiResult = parseKimiJsonlLine(line);
      if (kimiResult.success && kimiResult.event) {
        hasJsonl = true;
        const kimiDisplay = formatKimiEventForDisplay(kimiResult.event);
        if (kimiDisplay !== undefined) {
          parsedParts.push(kimiDisplay);
        }
        continue; // Skip generic parsing for kimi events
      }
    }

    // Try to parse as JSONL
    const parsed = parseJsonlLine(line);
    if (parsed !== undefined) {
      hasJsonl = true;
      parsedParts.push(parsed);
    } else if (line.trim() && !line.startsWith('{')) {
      // Non-JSON line that's not empty - might be plain text output
      plainTextLines.push(line);
    }
  }

  if (useDroidParser && droidCostAccumulator?.hasData()) {
    parsedParts.push(formatDroidCostSummary(droidCostAccumulator.getSummary()));
  }

  // If we found JSONL content, return ALL extracted parts joined together
  // This ensures tool calls and intermediate output are visible, not just the final result
  if (hasJsonl && parsedParts.length > 0) {
    // Strip ANSI codes from each part and join with newlines
    return parsedParts.map(p => stripAnsiCodes(p)).join('\n');
  }

  // If we have plain text lines and no JSONL, return the plain text
  if (plainTextLines.length > 0) {
    return stripAnsiCodes(plainTextLines.join('\n'));
  }

  // Fallback: return raw output truncated if it looks like unparseable JSON
  if (rawOutput.startsWith('{') && rawOutput.length > 500) {
    return '[Agent output could not be parsed - showing raw JSON]\n' +
      rawOutput.slice(0, 200) + '...\n[truncated]';
  }

  return stripAnsiCodes(rawOutput);
}

/**
 * Format output for display in the TUI.
 * Applies any final transformations for readability.
 */
export function formatOutputForDisplay(output: string, maxLines?: number): string {
  let formatted = output;

  // Limit lines if requested
  if (maxLines && maxLines > 0) {
    const lines = formatted.split('\n');
    if (lines.length > maxLines) {
      formatted = lines.slice(0, maxLines).join('\n') +
        `\n... (${lines.length - maxLines} more lines)`;
    }
  }

  return formatted;
}

/**
 * Maximum size for the parsed output buffer (in characters).
 * Older content is trimmed when this limit is exceeded.
 * 100KB should be plenty for display while preventing memory issues.
 */
const MAX_PARSED_OUTPUT_SIZE = 100_000;

export interface StreamingOutputParserOptions {
  agentPlugin?: string;
}

/**
 * Streaming output parser for real-time JSONL processing.
 * Extracts readable content from chunks as they arrive, keeping
 * only meaningful text to prevent memory bloat.
 *
 * Usage:
 *   const parser = new StreamingOutputParser();
 *   onChunk(data) { parser.push(data); }
 *   getOutput() { return parser.getOutput(); }
 */
export class StreamingOutputParser {
  private buffer = '';
  private parsedOutput = '';
  private parsedSegments: FormattedSegment[] = [];
  private lastResultText = '';
  private lastCostSummary = '';
  private isDroid: boolean;
  private isOpenCode: boolean;
  private isGemini: boolean;
  private isCodex: boolean;
  private isKimi: boolean;
  private droidCostAccumulator?: DroidCostAccumulator;

  constructor(options: StreamingOutputParserOptions = {}) {
    this.isDroid = isDroidAgent(options.agentPlugin);
    this.isOpenCode = isOpenCodeAgent(options.agentPlugin);
    this.isGemini = isGeminiAgent(options.agentPlugin);
    this.isCodex = isCodexAgent(options.agentPlugin);
    this.isKimi = isKimiAgent(options.agentPlugin);
    if (this.isDroid) {
      this.droidCostAccumulator = new DroidCostAccumulator();
    }
  }

  /**
   * Update the agent plugin type.
   * Call this when the agent changes to ensure proper parsing.
   */
  setAgentPlugin(agentPlugin: string): void {
    const wasDroid = this.isDroid;
    this.isDroid = isDroidAgent(agentPlugin);
    this.isOpenCode = isOpenCodeAgent(agentPlugin);
    this.isGemini = isGeminiAgent(agentPlugin);
    this.isCodex = isCodexAgent(agentPlugin);
    this.isKimi = isKimiAgent(agentPlugin);
    if (this.isDroid && !wasDroid) {
      this.droidCostAccumulator = new DroidCostAccumulator();
    }
  }

  /**
   * Push a chunk of raw output data.
   * Parses complete JSONL lines and extracts readable content.
   * @returns The newly extracted readable text (if any)
   */
  push(chunk: string): string {
    this.buffer += chunk;
    let newContent = '';
    const newSegments: FormattedSegment[] = [];

    // Process complete lines
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      // Extract both string and segment representations
      const extracted = this.extractReadableContent(line);
      if (extracted) {
        // Strip any trailing newlines from extracted content to avoid doubles
        // (formatters like formatToolCall add their own trailing newlines)
        newContent += extracted.replace(/\n+$/, '') + '\n';
      }

      const extractedSegments = this.extractReadableSegments(line);
      if (extractedSegments.length > 0) {
        newSegments.push(...extractedSegments);
        newSegments.push({ text: '\n' }); // Add newline segment
      }
    }

    // Append new content to parsed output
    if (newContent) {
      this.parsedOutput += newContent;

      // Trim if exceeding max size (keep the end, trim the start)
      if (this.parsedOutput.length > MAX_PARSED_OUTPUT_SIZE) {
        const trimPoint = this.parsedOutput.length - MAX_PARSED_OUTPUT_SIZE + 1000;
        this.parsedOutput = '[...output trimmed...]\n' + this.parsedOutput.slice(trimPoint);
      }
    }

    // Append new segments
    if (newSegments.length > 0) {
      this.parsedSegments.push(...newSegments);

      // Trim segments if total text exceeds max size
      const totalLength = this.parsedSegments.reduce((acc, s) => acc + s.text.length, 0);
      if (totalLength > MAX_PARSED_OUTPUT_SIZE) {
        // Simple trim: keep last N segments that fit within limit
        let kept = 0;
        let keptLength = 0;
        for (let i = this.parsedSegments.length - 1; i >= 0; i--) {
          const segLen = this.parsedSegments[i]!.text.length;
          if (keptLength + segLen > MAX_PARSED_OUTPUT_SIZE - 1000) {
            break;
          }
          keptLength += segLen;
          kept++;
        }
        // Note: slice(-0) === slice(0) returns full array, so handle kept === 0 specially
        const start = kept === 0 ? this.parsedSegments.length : this.parsedSegments.length - kept;
        this.parsedSegments = [
          { text: '[...output trimmed...]\n', color: 'muted' },
          ...this.parsedSegments.slice(start),
        ];
      }
    }

    return newContent;
  }

  /**
   * Extract readable content from a single JSONL line.
   * Only returns content for events we want to display.
   */
  private extractReadableContent(line: string): string | undefined {
    const trimmed = line.trim();
    if (!trimmed) return undefined;

    if (this.isDroid) {
      const droidResult = parseDroidJsonlLine(trimmed);
      if (droidResult.success) {
        if (droidResult.message.cost && this.droidCostAccumulator) {
          this.droidCostAccumulator.add(droidResult.message.cost);
        }

        const costSummary = this.formatDroidCostSummaryIfFinal(droidResult.message);
        const droidDisplay = formatDroidEventForDisplay(droidResult.message);

        if (droidDisplay && costSummary) {
          // Strip ANSI codes - legacy formatters use ANSI which causes TUI artifacts
          return stripAnsiCodes(`${droidDisplay}\n${costSummary}`);
        }
        if (droidDisplay) {
          return stripAnsiCodes(droidDisplay);
        }
        if (costSummary) {
          return costSummary; // Cost summary doesn't contain ANSI codes
        }
        // Droid event was recognized but nothing to display (e.g., user input echo)
        // Return undefined to skip rather than falling through to generic parsing
        return undefined;
      }
    }

    // OpenCode-specific parsing
    if (this.isOpenCode) {
      const openCodeResult = parseOpenCodeJsonlLine(trimmed);
      if (openCodeResult.success && openCodeResult.event) {
        const openCodeDisplay = formatOpenCodeEventForDisplay(openCodeResult.event);
        // Return the display text or undefined (to skip system events)
        return openCodeDisplay;
      }
    }

    // Codex CLI parsing
    if (this.isCodex) {
      const codexResult = parseCodexJsonlLine(trimmed);
      if (codexResult.success && codexResult.event) {
        const codexDisplay = formatCodexEventForDisplay(codexResult.event);
        // Return the display text or undefined (to skip lifecycle events)
        return codexDisplay;
      }
    }

    // Gemini CLI parsing
    if (this.isGemini) {
      const geminiResult = parseGeminiJsonlLine(trimmed);
      if (geminiResult.success && geminiResult.event) {
        const geminiDisplay = formatGeminiEventForDisplay(geminiResult.event);
        // Return the display text or undefined (to skip init/stats events)
        return geminiDisplay;
      }
    }

    // Kimi CLI parsing
    if (this.isKimi) {
      const kimiResult = parseKimiJsonlLine(trimmed);
      if (kimiResult.success && kimiResult.event) {
        const kimiDisplay = formatKimiEventForDisplay(kimiResult.event);
        // Return the display text or undefined (to skip think/status events)
        return kimiDisplay;
      }
    }

    // Not JSON - return as plain text if it's not just whitespace
    if (!trimmed.startsWith('{')) {
      return trimmed;
    }

    try {
      const event = JSON.parse(trimmed) as AgentEvent;

      // Result event - contains final output (save for later, don't show yet)
      if (event.type === 'result') {
        const resultEvent = event as ClaudeCodeResultEvent;
        if (resultEvent.result) {
          this.lastResultText = resultEvent.result;
          // Don't return result here - it will be shown when getOutput() is called
          // This prevents duplicate display of the final result
        }
        return undefined;
      }

      // Assistant message with content - show the text
      if (event.type === 'assistant') {
        const assistantEvent = event as AssistantEvent;
        const content = assistantEvent.message?.content;
        if (typeof content === 'string' && content.trim()) {
          return content;
        }
        if (Array.isArray(content)) {
          const textParts = content
            .filter((c): c is { type: string; text: string } => c.type === 'text' && !!c.text)
            .map((c) => c.text);
          if (textParts.length > 0) {
            return textParts.join('');
          }
        }
      }

      // User message (tool results returning to Claude) - skip these
      if (event.type === 'user') {
        return undefined;
      }

      // System messages - could show but usually not interesting
      if (event.type === 'system') {
        return undefined;
      }

      // Skip tool_use and tool_result events - too verbose
      // Users can see these in the full logs if needed

      return undefined;
    } catch {
      // Not valid JSON - return as plain text if meaningful
      if (trimmed.length > 0 && !trimmed.startsWith('{')) {
        return trimmed;
      }
      return undefined;
    }
  }

  /**
   * Extract readable content as FormattedSegments for TUI-native color rendering.
   * Mirrors extractReadableContent but returns segments instead of strings.
   * All segment text is stripped of ANSI codes to prevent rendering artifacts.
   */
  private extractReadableSegments(line: string): FormattedSegment[] {
    const trimmed = line.trim();
    if (!trimmed) return [];

    if (this.isDroid) {
      const droidResult = parseDroidJsonlLine(trimmed);
      if (droidResult.success) {
        // Cost accumulation is already handled in extractReadableContent

        const segments = formatDroidEventToSegments(droidResult.message);
        if (segments.length > 0) {
          // Strip ANSI codes from all segment texts
          return segments.map(s => ({ ...s, text: stripAnsiCodes(s.text) }));
        }
        // Droid event was recognized but nothing to display
        return [];
      }
    }

    // OpenCode-specific segment extraction
    if (this.isOpenCode) {
      const openCodeResult = parseOpenCodeJsonlLine(trimmed);
      if (openCodeResult.success && openCodeResult.event) {
        const displayText = formatOpenCodeEventForDisplay(openCodeResult.event);
        if (displayText) {
          // Format tool calls with color
          if (openCodeResult.event.type === 'tool_use') {
            return [{ text: displayText, color: 'cyan' }];
          }
          if (openCodeResult.event.type === 'error') {
            return [{ text: displayText, color: 'yellow' }];
          }
          return [{ text: displayText }];
        }
        // OpenCode event was recognized but nothing to display (system events)
        return [];
      }
    }

    // Codex CLI segment extraction
    if (this.isCodex) {
      const codexResult = parseCodexJsonlLine(trimmed);
      if (codexResult.success && codexResult.event) {
        const displayText = formatCodexEventForDisplay(codexResult.event);
        if (displayText) {
          // Format tool calls with color
          if (codexResult.event.type === 'item.started' && codexResult.event.item?.type === 'command_execution') {
            return [{ text: displayText, color: 'cyan' }];
          }
          if (codexResult.event.type === 'error') {
            return [{ text: displayText, color: 'yellow' }];
          }
          return [{ text: displayText }];
        }
        // Codex event was recognized but nothing to display (lifecycle events)
        return [];
      }
    }

    // Gemini CLI segment extraction
    if (this.isGemini) {
      const geminiResult = parseGeminiJsonlLine(trimmed);
      if (geminiResult.success && geminiResult.event) {
        const displayText = formatGeminiEventForDisplay(geminiResult.event);
        if (displayText) {
          // Format tool calls with color
          if (geminiResult.event.type === 'tool_use') {
            return [{ text: displayText, color: 'cyan' }];
          }
          if (geminiResult.event.type === 'error') {
            return [{ text: displayText, color: 'yellow' }];
          }
          return [{ text: displayText }];
        }
        // Gemini event was recognized but nothing to display (init/stats events)
        return [];
      }
    }

    // Kimi CLI segment extraction
    if (this.isKimi) {
      const kimiResult = parseKimiJsonlLine(trimmed);
      if (kimiResult.success && kimiResult.event) {
        const displayText = formatKimiEventForDisplay(kimiResult.event);
        if (displayText) {
          // Color tool calls and errors
          if (displayText.startsWith('[Tool:')) {
            return [{ text: displayText, color: 'cyan' }];
          }
          if (displayText.startsWith('[Tool Error]') || displayText.startsWith('Error:')) {
            return [{ text: displayText, color: 'yellow' }];
          }
          return [{ text: displayText }];
        }
        // Kimi event was recognized but nothing to display (think/status events)
        return [];
      }
    }

    // Not JSON - return as plain text segment if it's not just whitespace
    if (!trimmed.startsWith('{')) {
      return [{ text: stripAnsiCodes(trimmed) }];
    }

    try {
      const event = JSON.parse(trimmed) as AgentEvent;

      // Result event - skip (same as string version)
      if (event.type === 'result') {
        return [];
      }

      // Assistant message with content - show the text as plain segment
      if (event.type === 'assistant') {
        const assistantEvent = event as AssistantEvent;
        const content = assistantEvent.message?.content;
        if (typeof content === 'string' && content.trim()) {
          return [{ text: stripAnsiCodes(content) }];
        }
        if (Array.isArray(content)) {
          const textParts = content
            .filter((c): c is { type: string; text: string } => c.type === 'text' && !!c.text)
            .map((c) => c.text);
          if (textParts.length > 0) {
            return [{ text: stripAnsiCodes(textParts.join('')) }];
          }
        }
      }

      // User, system messages - skip
      if (event.type === 'user' || event.type === 'system') {
        return [];
      }

      return [];
    } catch {
      // Not valid JSON - return as plain text if meaningful
      if (trimmed.length > 0 && !trimmed.startsWith('{')) {
        return [{ text: stripAnsiCodes(trimmed) }];
      }
      return [];
    }
  }

  private formatDroidCostSummaryIfFinal(message: DroidJsonlMessage): string | undefined {
    if (!this.droidCostAccumulator || !this.droidCostAccumulator.hasData()) {
      return undefined;
    }

    const type = message.type?.toLowerCase();
    const raw = message.raw;
    const isFinal =
      type === 'result' ||
      type === 'final' ||
      type === 'done' ||
      type === 'summary' ||
      raw.final === true ||
      raw.done === true ||
      raw.completed === true;

    if (!isFinal) {
      return undefined;
    }

    const summary = formatDroidCostSummary(this.droidCostAccumulator.getSummary());
    if (summary === this.lastCostSummary) {
      return undefined;
    }

    this.lastCostSummary = summary;
    return summary;
  }

  /**
   * Get the accumulated parsed output.
   * This is the readable content extracted from all chunks so far.
   */
  getOutput(): string {
    return this.parsedOutput;
  }

  /**
   * Get the accumulated parsed segments for TUI-native color rendering.
   * Use this with the FormattedText component for colored output.
   */
  getSegments(): FormattedSegment[] {
    return this.parsedSegments;
  }

  /**
   * Get the final result text (from the 'result' event).
   * This is typically the most complete output at the end.
   */
  getResultText(): string {
    return this.lastResultText;
  }

  /**
   * Reset the parser state for a new iteration.
   */
  reset(): void {
    this.buffer = '';
    this.parsedOutput = '';
    this.parsedSegments = [];
    this.lastResultText = '';
    this.lastCostSummary = '';
    if (this.droidCostAccumulator) {
      this.droidCostAccumulator = new DroidCostAccumulator();
    }
  }
}
