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
  private droidCostAccumulator?: DroidCostAccumulator;

  constructor(options: StreamingOutputParserOptions = {}) {
    this.isDroid = isDroidAgent(options.agentPlugin);
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
