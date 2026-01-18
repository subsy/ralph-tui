/**
 * ABOUTME: Parser for extracting subagent lifecycle events from Claude Code JSONL output.
 * Processes streaming JSONL to detect Task tool invocations, track subagent hierarchy,
 * and emit events for spawns, progress, completions, and errors.
 */

import type { ClaudeJsonlMessage } from '../builtin/claude.js';
import type {
  SubagentEvent,
  SubagentSpawnEvent,
  SubagentCompleteEvent,
  SubagentErrorEvent,
  SubagentState,
  SubagentEventCallback,
  SubagentTraceParserOptions,
  SubagentTraceSummary,
} from './types.js';

/**
 * Generates a unique ID for subagent tracking.
 */
function generateSubagentId(): string {
  return `subagent_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Parser for extracting subagent lifecycle events from Claude Code JSONL output.
 *
 * Usage:
 * ```typescript
 * const parser = new SubagentTraceParser({
 *   onEvent: (event) => console.log('Subagent event:', event)
 * });
 *
 * // Process JSONL messages as they arrive
 * parser.processMessage(jsonlMessage);
 *
 * // Get current state
 * const states = parser.getActiveSubagents();
 * const summary = parser.getSummary();
 * ```
 */
export class SubagentTraceParser {
  /** Map of subagent ID to state */
  private subagents: Map<string, SubagentState> = new Map();

  /** Stack of active subagent IDs for hierarchy tracking */
  private activeStack: string[] = [];

  /** Callback for emitting events */
  private onEvent?: SubagentEventCallback;

  /** Whether to track parent-child hierarchy */
  private trackHierarchy: boolean;

  /** All emitted events for replay/debugging */
  private events: SubagentEvent[] = [];

  /** Map of tool_use_id to subagent ID for correlating tool results */
  private toolUseIdToSubagentId: Map<string, string> = new Map();

  constructor(options: SubagentTraceParserOptions = {}) {
    this.onEvent = options.onEvent;
    this.trackHierarchy = options.trackHierarchy ?? true;
  }

  /**
   * Process a single JSONL message from Claude Code output.
   * Detects Task tool invocations and subagent lifecycle events.
   *
   * @param message Parsed JSONL message
   * @returns Array of subagent events detected in this message
   */
  processMessage(message: ClaudeJsonlMessage): SubagentEvent[] {
    const detectedEvents: SubagentEvent[] = [];

    // Check for Task tool invocation (subagent spawn)
    if (this.isTaskToolInvocation(message)) {
      const spawnEvent = this.handleTaskToolSpawn(message);
      if (spawnEvent) {
        detectedEvents.push(spawnEvent);
      }
    }

    // Check for tool result (potential subagent completion)
    if (this.isToolResult(message)) {
      const completionEvent = this.handleToolResult(message);
      if (completionEvent) {
        detectedEvents.push(completionEvent);
      }
    }

    // Check for subagent error patterns
    if (this.isErrorMessage(message)) {
      const errorEvent = this.handleErrorMessage(message);
      if (errorEvent) {
        detectedEvents.push(errorEvent);
      }
    }

    return detectedEvents;
  }

  /**
   * Process multiple JSONL messages.
   *
   * @param messages Array of parsed JSONL messages
   * @returns Array of all subagent events detected
   */
  processMessages(messages: ClaudeJsonlMessage[]): SubagentEvent[] {
    const allEvents: SubagentEvent[] = [];
    for (const message of messages) {
      const events = this.processMessage(message);
      allEvents.push(...events);
    }
    return allEvents;
  }

  /**
   * Check if a message represents a Task tool invocation.
   */
  private isTaskToolInvocation(message: ClaudeJsonlMessage): boolean {
    // Task tool invocations appear as tool use with name "Task"
    if (message.tool?.name === 'Task') {
      return true;
    }

    // Also check raw message for tool_use content blocks
    // Claude's format: {"type": "assistant", "message": {"content": [...]}}
    const raw = message.raw;
    const rawMessage = raw.message as { content?: unknown[] } | undefined;
    const contentArray = Array.isArray(raw.content)
      ? raw.content
      : Array.isArray(rawMessage?.content)
        ? rawMessage.content
        : null;

    if (raw.type === 'assistant' && contentArray) {
      for (const block of contentArray) {
        if (
          typeof block === 'object' &&
          block !== null &&
          'type' in block &&
          block.type === 'tool_use' &&
          'name' in block &&
          block.name === 'Task'
        ) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Check if a message represents a tool result.
   */
  private isToolResult(message: ClaudeJsonlMessage): boolean {
    const raw = message.raw;
    return raw.type === 'tool_result' || message.type === 'result';
  }

  /**
   * Check if a message represents an error.
   */
  private isErrorMessage(message: ClaudeJsonlMessage): boolean {
    const raw = message.raw;
    return (
      raw.type === 'error' ||
      message.type === 'error' ||
      (typeof raw.error === 'object' && raw.error !== null)
    );
  }

  /**
   * Handle a Task tool invocation and create a spawn event.
   */
  private handleTaskToolSpawn(message: ClaudeJsonlMessage): SubagentSpawnEvent | null {
    const raw = message.raw;
    let toolInput: Record<string, unknown> | undefined;
    let toolUseId: string | undefined;

    // Extract tool input from message.tool or raw content blocks
    // Claude's format: {"type": "assistant", "message": {"content": [...]}}
    if (message.tool?.input) {
      toolInput = message.tool.input;
    } else if (raw.type === 'assistant') {
      const rawMessage = raw.message as { content?: unknown[] } | undefined;
      const contentArray = Array.isArray(raw.content)
        ? raw.content
        : Array.isArray(rawMessage?.content)
          ? rawMessage.content
          : null;

      if (contentArray) {
        for (const block of contentArray) {
          if (
            typeof block === 'object' &&
            block !== null &&
            'type' in block &&
            block.type === 'tool_use' &&
            'name' in block &&
            block.name === 'Task'
          ) {
            const toolBlock = block as Record<string, unknown>;
            toolInput = toolBlock.input as Record<string, unknown>;
            toolUseId = toolBlock.id as string;
            break;
          }
        }
      }
    }

    if (!toolInput) {
      return null;
    }

    // Extract Task tool parameters
    const subagentType = (toolInput.subagent_type as string) || 'unknown';
    const description = (toolInput.description as string) || '';
    const prompt = (toolInput.prompt as string) || '';
    const model = toolInput.model as string | undefined;

    // Generate subagent ID
    const id = generateSubagentId();

    // Determine parent ID from active stack
    const parentId = this.trackHierarchy && this.activeStack.length > 0
      ? this.activeStack[this.activeStack.length - 1]
      : undefined;

    // Create subagent state
    const state: SubagentState = {
      id,
      agentType: subagentType,
      description,
      status: 'running',
      parentId,
      childIds: [],
      spawnedAt: new Date().toISOString(),
      prompt,
    };

    // Update parent's children
    if (parentId) {
      const parentState = this.subagents.get(parentId);
      if (parentState) {
        parentState.childIds.push(id);
      }
    }

    // Track state
    this.subagents.set(id, state);
    this.activeStack.push(id);

    // Map tool_use_id to subagent ID for correlation
    if (toolUseId) {
      this.toolUseIdToSubagentId.set(toolUseId, id);
    }

    // Create spawn event
    const event: SubagentSpawnEvent = {
      id,
      type: 'spawn',
      timestamp: state.spawnedAt,
      agentType: subagentType,
      description,
      parentId,
      prompt,
      model,
    };

    this.emitEvent(event);
    return event;
  }

  /**
   * Handle a tool result and create a completion or error event.
   */
  private handleToolResult(
    message: ClaudeJsonlMessage
  ): SubagentCompleteEvent | SubagentErrorEvent | null {
    const raw = message.raw;

    // Try to find the subagent ID from tool_use_id correlation
    let subagentId: string | undefined;
    const toolUseId = raw.tool_use_id as string | undefined;

    if (toolUseId) {
      subagentId = this.toolUseIdToSubagentId.get(toolUseId);
    }

    // If no correlation found, use the top of the active stack
    if (!subagentId && this.activeStack.length > 0) {
      subagentId = this.activeStack[this.activeStack.length - 1];
    }

    if (!subagentId) {
      return null;
    }

    const state = this.subagents.get(subagentId);
    if (!state || state.status !== 'running') {
      return null;
    }

    // Check if this is an error result
    const isError =
      raw.is_error === true ||
      (typeof raw.content === 'string' && raw.content.toLowerCase().includes('error'));

    const now = new Date().toISOString();
    const durationMs = new Date(now).getTime() - new Date(state.spawnedAt).getTime();

    // Update state
    state.status = isError ? 'error' : 'completed';
    state.endedAt = now;
    state.durationMs = durationMs;

    // Extract result content
    let resultContent: string | undefined;
    if (typeof raw.content === 'string') {
      resultContent = raw.content;
    } else if (Array.isArray(raw.content)) {
      resultContent = raw.content
        .map((block) => {
          if (typeof block === 'string') return block;
          if (typeof block === 'object' && block !== null && 'text' in block) {
            return (block as { text: string }).text;
          }
          return '';
        })
        .join('\n');
    }

    state.result = resultContent;

    // Remove from active stack
    const stackIndex = this.activeStack.indexOf(subagentId);
    if (stackIndex !== -1) {
      this.activeStack.splice(stackIndex, 1);
    }

    // Clean up tool_use_id correlation
    if (toolUseId) {
      this.toolUseIdToSubagentId.delete(toolUseId);
    }

    // Create event
    if (isError) {
      const errorEvent: SubagentErrorEvent = {
        id: subagentId,
        type: 'error',
        timestamp: now,
        agentType: state.agentType,
        description: state.description,
        parentId: state.parentId,
        errorMessage: resultContent || 'Unknown error',
        durationMs,
      };
      this.emitEvent(errorEvent);
      return errorEvent;
    } else {
      const completeEvent: SubagentCompleteEvent = {
        id: subagentId,
        type: 'complete',
        timestamp: now,
        agentType: state.agentType,
        description: state.description,
        parentId: state.parentId,
        exitStatus: 'success',
        durationMs,
        result: resultContent,
      };
      this.emitEvent(completeEvent);
      return completeEvent;
    }
  }

  /**
   * Handle an error message and create an error event if applicable.
   */
  private handleErrorMessage(message: ClaudeJsonlMessage): SubagentErrorEvent | null {
    // If there's no active subagent, ignore
    if (this.activeStack.length === 0) {
      return null;
    }

    const subagentId = this.activeStack[this.activeStack.length - 1];
    const state = this.subagents.get(subagentId);

    if (!state || state.status !== 'running') {
      return null;
    }

    const raw = message.raw;
    let errorMessage = 'Unknown error';
    let errorCode: string | undefined;

    if (typeof raw.error === 'object' && raw.error !== null) {
      const errorObj = raw.error as Record<string, unknown>;
      errorMessage = (errorObj.message as string) || errorMessage;
      errorCode = errorObj.code as string | undefined;
    } else if (typeof raw.message === 'string') {
      errorMessage = raw.message;
    }

    const now = new Date().toISOString();
    const durationMs = new Date(now).getTime() - new Date(state.spawnedAt).getTime();

    // Update state
    state.status = 'error';
    state.endedAt = now;
    state.durationMs = durationMs;
    state.result = errorMessage;

    // Remove from active stack
    this.activeStack.pop();

    const event: SubagentErrorEvent = {
      id: subagentId,
      type: 'error',
      timestamp: now,
      agentType: state.agentType,
      description: state.description,
      parentId: state.parentId,
      errorMessage,
      errorCode,
      durationMs,
    };

    this.emitEvent(event);
    return event;
  }

  /**
   * Emit an event through the callback and store it.
   */
  private emitEvent(event: SubagentEvent): void {
    this.events.push(event);
    if (this.onEvent) {
      this.onEvent(event);
    }
  }

  /**
   * Get all currently active (running) subagents.
   */
  getActiveSubagents(): SubagentState[] {
    return Array.from(this.subagents.values()).filter((s) => s.status === 'running');
  }

  /**
   * Get all tracked subagents.
   */
  getAllSubagents(): SubagentState[] {
    return Array.from(this.subagents.values());
  }

  /**
   * Get a specific subagent by ID.
   */
  getSubagent(id: string): SubagentState | undefined {
    return this.subagents.get(id);
  }

  /**
   * Get all emitted events.
   */
  getEvents(): SubagentEvent[] {
    return [...this.events];
  }

  /**
   * Get the current nesting depth (number of active subagents in the hierarchy).
   */
  getCurrentDepth(): number {
    return this.activeStack.length;
  }

  /**
   * Get the active subagent stack (deepest first).
   * Returns array of subagent IDs in order from deepest to shallowest.
   * Empty array if no subagents are active.
   */
  getActiveStack(): string[] {
    return [...this.activeStack].reverse();
  }

  /**
   * Get a summary of subagent activity.
   */
  getSummary(): SubagentTraceSummary {
    const states = Array.from(this.subagents.values());

    const byAgentType: Record<string, number> = {};
    let totalDurationMs = 0;
    let maxDepth = 0;

    for (const state of states) {
      // Count by agent type
      byAgentType[state.agentType] = (byAgentType[state.agentType] || 0) + 1;

      // Sum durations of completed subagents
      if (state.durationMs !== undefined) {
        totalDurationMs += state.durationMs;
      }

      // Calculate depth for this subagent
      let depth = 1;
      let current = state;
      while (current.parentId) {
        depth++;
        const parent = this.subagents.get(current.parentId);
        if (!parent) break;
        current = parent;
      }
      maxDepth = Math.max(maxDepth, depth);
    }

    return {
      totalSpawned: states.length,
      completed: states.filter((s) => s.status === 'completed').length,
      errored: states.filter((s) => s.status === 'error').length,
      running: states.filter((s) => s.status === 'running').length,
      maxDepth,
      totalDurationMs,
      byAgentType,
    };
  }

  /**
   * Reset the parser state.
   */
  reset(): void {
    this.subagents.clear();
    this.activeStack = [];
    this.events = [];
    this.toolUseIdToSubagentId.clear();
  }
}
