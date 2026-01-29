/**
 * ABOUTME: Cursor Agent CLI plugin for the `agent` command.
 * Integrates with Cursor Agent CLI for AI-assisted coding.
 * Supports: print mode execution, JSONL streaming, auto-approve, model selection.
 */

import { spawn } from 'node:child_process';
import { BaseAgentPlugin, findCommandPath, quoteForWindowsShell } from '../base.js';
import { processAgentEvents, processAgentEventsToSegments, type AgentDisplayEvent } from '../output-formatting.js';
import type {
  AgentPluginMeta,
  AgentPluginFactory,
  AgentFileContext,
  AgentExecuteOptions,
  AgentSetupQuestion,
  AgentDetectResult,
  AgentExecutionHandle,
} from '../types.js';

/**
 * Extract a string error message from various error formats.
 * Handles: string, { message: string }, or other objects.
 * @internal Exported for testing only.
 */
export function extractErrorMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.error === 'string') return obj.error;
    // Fallback: stringify the object
    try {
      return JSON.stringify(err);
    } catch {
      return 'Unknown error';
    }
  }
  return String(err);
}

/**
 * Parse Cursor Agent JSON line into standardized display events.
 * Returns AgentDisplayEvent[] - the shared processAgentEvents decides what to show.
 *
 * Cursor Agent CLI event types (when using --output-format stream-json):
 * - "system" with subtype "init": Session initialization
 * - "assistant" with message.content[]: AI response text and tool_use blocks
 * - "tool_call" with subtype "started/completed": Tool invocations
 * - "result": Final result with duration
 * - "error": Error from Cursor
 * @internal Exported for testing only.
 */
export function parseCursorJsonLine(jsonLine: string): AgentDisplayEvent[] {
  if (!jsonLine || jsonLine.length === 0) return [];

  try {
    const event = JSON.parse(jsonLine);
    const events: AgentDisplayEvent[] = [];

    // Handle system events (e.g., init)
    if (event.type === 'system') {
      events.push({ type: 'system', subtype: event.subtype as string });
    }
    // Handle assistant messages (text and tool use)
    else if (event.type === 'assistant' && event.message) {
      const message = event.message as { content?: Array<Record<string, unknown>> };
      if (message.content && Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block.type === 'text' && typeof block.text === 'string') {
            events.push({ type: 'text', content: block.text });
          } else if (block.type === 'tool_use' && typeof block.name === 'string') {
            events.push({
              type: 'tool_use',
              name: block.name,
              input: block.input as Record<string, unknown>,
            });
          }
        }
      }
    }
    // Handle tool_call events with started/completed subtypes
    else if (event.type === 'tool_call') {
      if (event.subtype === 'started') {
        // Cursor format has tool name as a key inside tool_call object
        // e.g., { tool_call: { readToolCall: { args: {...} } } }
        let toolName = event.name || event.tool || 'unknown';
        let input = event.input;

        // Extract tool name and input from Cursor's tool_call format
        const toolCall = event.tool_call as Record<string, unknown> | undefined;
        if (toolCall && typeof toolCall === 'object') {
          const toolKeys = Object.keys(toolCall);
          if (toolKeys.length > 0) {
            const toolKey = toolKeys[0] ?? '';
            // Convert camelCase tool key to readable name (e.g., readToolCall -> Read)
            toolName = toolKey
              .replace(/ToolCall$/, '')
              .replace(/^([a-z])/, (_, c: string) => c.toUpperCase());
            // Extract args from the tool call
            const toolData = toolCall[toolKey] as Record<string, unknown> | undefined;
            if (toolData?.args) {
              input = toolData.args as Record<string, unknown>;
            }
          }
        }

        events.push({ type: 'tool_use', name: toolName, input });
      } else if (event.subtype === 'completed') {
        const isError = event.is_error === true || event.error !== undefined;
        if (isError) {
          const errMsg = extractErrorMessage(event.error);
          events.push({ type: 'error', message: errMsg });
        }
        events.push({ type: 'tool_result' });
      }
    }
    // Handle result events (session completion)
    else if (event.type === 'result') {
      // Result events typically contain duration/stats, which we skip for display
      // but can be used for logging
    }
    // Handle error events
    else if (event.type === 'error' || event.error) {
      const errorMsg = extractErrorMessage(event.error) || extractErrorMessage(event.message) || 'Unknown error';
      events.push({ type: 'error', message: errorMsg });
    }

    return events;
  } catch {
    // Not valid JSON - skip silently
    return [];
  }
}

/**
 * Parse Cursor Agent stream output into display events.
 * @internal Exported for testing only.
 */
export function parseCursorOutputToEvents(data: string): AgentDisplayEvent[] {
  const allEvents: AgentDisplayEvent[] = [];
  for (const line of data.split('\n')) {
    const events = parseCursorJsonLine(line.trim());
    allEvents.push(...events);
  }
  return allEvents;
}

/**
 * Cursor Agent CLI plugin implementation.
 * Uses the `agent` CLI to execute AI coding tasks.
 */
export class CursorAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'cursor',
    name: 'Cursor Agent',
    description: 'Cursor Agent CLI for AI-assisted coding',
    version: '1.0.0',
    author: 'Cursor',
    defaultCommand: 'agent',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false,
    supportsSubagentTracing: true,
    structuredOutputFormat: 'jsonl',
    skillsPaths: {
      personal: '~/.cursor/skills',
      repo: '.cursor/skills',
    },
  };

  private model?: string;
  private force = true;
  private mode: 'agent' | 'plan' | 'ask' = 'agent';
  protected override defaultTimeout = 0;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (typeof config.model === 'string' && config.model.length > 0) {
      this.model = config.model;
    }

    if (typeof config.force === 'boolean') {
      this.force = config.force;
    }

    if (typeof config.mode === 'string' &&
        ['agent', 'plan', 'ask'].includes(config.mode)) {
      this.mode = config.mode as typeof this.mode;
    }

    if (typeof config.timeout === 'number' && config.timeout > 0) {
      this.defaultTimeout = config.timeout;
    }
  }

  override getSandboxRequirements() {
    return {
      authPaths: ['~/.cursor', '~/.config/cursor'],
      binaryPaths: [
        '/usr/local/bin',
        '~/.local/bin',
        '~/.cursor/bin',
      ],
      runtimePaths: [],
      requiresNetwork: true,
    };
  }

  override async detect(): Promise<AgentDetectResult> {
    const command = this.commandPath ?? this.meta.defaultCommand;
    const findResult = await findCommandPath(command);

    if (!findResult.found) {
      return {
        available: false,
        error: `Cursor Agent CLI not found in PATH. Install with: curl https://cursor.com/install | sh`,
      };
    }

    const versionResult = await this.runVersion(findResult.path);

    if (!versionResult.success) {
      return {
        available: false,
        executablePath: findResult.path,
        error: versionResult.error,
      };
    }

    // Store the detected path for use in execute()
    this.commandPath = findResult.path;

    return {
      available: true,
      version: versionResult.version,
      executablePath: findResult.path,
    };
  }

  private runVersion(
    command: string
  ): Promise<{ success: boolean; version?: string; error?: string }> {
    return new Promise((resolve) => {
      // Only use shell on Windows where direct spawn may not work
      const useShell = process.platform === 'win32';
      const proc = spawn(useShell ? quoteForWindowsShell(command) : command, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: useShell,
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const safeResolve = (result: { success: boolean; version?: string; error?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        safeResolve({ success: false, error: `Failed to execute: ${error.message}` });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
          if (!versionMatch?.[1]) {
            safeResolve({
              success: false,
              error: `Unable to parse agent version output: ${stdout}`,
            });
            return;
          }
          safeResolve({ success: true, version: versionMatch[1] });
        } else {
          safeResolve({ success: false, error: stderr || `Exited with code ${code}` });
        }
      });

      const timer = setTimeout(() => {
        proc.kill();
        safeResolve({ success: false, error: 'Timeout waiting for --version' });
      }, 5000);
    });
  }

  override getSetupQuestions(): AgentSetupQuestion[] {
    return [
      ...super.getSetupQuestions(),
      {
        id: 'model',
        prompt: 'Model to use:',
        type: 'text',
        default: '',
        required: false,
        help: 'Model name (e.g., claude-4.5-sonnet, gpt-5.2). Leave empty for default.',
      },
      {
        id: 'force',
        prompt: 'Auto-approve file modifications?',
        type: 'boolean',
        default: true,
        required: false,
        help: 'Enable --force flag for autonomous operation',
      },
      {
        id: 'mode',
        prompt: 'Execution mode:',
        type: 'select',
        choices: [
          { value: 'agent', label: 'Agent', description: 'Full agent mode (default)' },
          { value: 'plan', label: 'Plan', description: 'Planning only, no execution' },
          { value: 'ask', label: 'Ask', description: 'Question answering mode' },
        ],
        default: 'agent',
        required: false,
        help: 'Cursor Agent execution mode',
      },
    ];
  }

  protected buildArgs(
    _prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string[] {
    const args: string[] = [];

    // Print mode for non-interactive output
    args.push('--print');

    // Auto-approve file modifications
    if (this.force) {
      args.push('--force');
    }

    // Always use stream-json format for output parsing
    args.push('--output-format', 'stream-json');

    // Model selection
    if (this.model) {
      args.push('--model', this.model);
    }

    // Execution mode (if not the default 'agent')
    if (this.mode !== 'agent') {
      args.push('--mode', this.mode);
    }

    // Note: Prompt is passed via stdin (see getStdinInput)

    return args;
  }

  /**
   * Provide the prompt via stdin instead of command args.
   * This avoids shell interpretation issues with special characters in prompts
   * on Windows where shell: true is required for wrapper script execution.
   */
  protected override getStdinInput(
    prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string {
    return prompt;
  }

  /**
   * Override execute to parse Cursor Agent JSON output.
   * Wraps the onStdout/onStdoutSegments callbacks to parse JSONL events and extract displayable content.
   * Also forwards raw JSONL messages to onJsonlMessage for subagent tracing.
   *
   * Uses buffering to handle JSONL records that may be split across chunks.
   */
  override execute(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): AgentExecutionHandle {
    // Buffer for incomplete JSONL lines split across chunks
    let jsonlBuffer = '';

    // Helper to flush remaining buffer content
    const flushBuffer = () => {
      if (!jsonlBuffer) return;
      const trimmed = jsonlBuffer.trim();
      if (!trimmed) return;

      // Forward to onJsonlMessage if valid JSON
      if (options?.onJsonlMessage && trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          options.onJsonlMessage(parsed);
        } catch {
          // Not valid JSON, skip
        }
      }

      // Process for display events
      const events = parseCursorOutputToEvents(trimmed);
      if (events.length > 0) {
        if (options?.onStdoutSegments) {
          const segments = processAgentEventsToSegments(events);
          if (segments.length > 0) {
            options.onStdoutSegments(segments);
          }
        }
        if (options?.onStdout) {
          const parsed = processAgentEvents(events);
          if (parsed.length > 0) {
            options.onStdout(parsed);
          }
        }
      }

      jsonlBuffer = '';
    };

    // Wrap callbacks to parse JSON events
    const parsedOptions: AgentExecuteOptions = {
      ...options,
      onStdout: (options?.onStdout || options?.onStdoutSegments || options?.onJsonlMessage)
        ? (data: string) => {
            // Prepend any buffered partial line from previous chunk
            const combined = jsonlBuffer + data;

            // Split into lines - last element may be incomplete
            const lines = combined.split('\n');

            // If data doesn't end with newline, last line is incomplete - buffer it
            if (!data.endsWith('\n')) {
              jsonlBuffer = lines.pop() || '';
            } else {
              jsonlBuffer = '';
            }

            // Process complete lines
            const completeData = lines.join('\n');

            // Parse raw JSONL lines and forward to onJsonlMessage for subagent tracing
            if (options?.onJsonlMessage) {
              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && trimmed.startsWith('{')) {
                  try {
                    const parsed = JSON.parse(trimmed);
                    options.onJsonlMessage(parsed);
                  } catch {
                    // Not valid JSON, skip
                  }
                }
              }
            }

            // Process for display events
            const events = parseCursorOutputToEvents(completeData);
            if (events.length > 0) {
              // Call TUI-native segments callback if provided
              if (options?.onStdoutSegments) {
                const segments = processAgentEventsToSegments(events);
                if (segments.length > 0) {
                  options.onStdoutSegments(segments);
                }
              }
              // Also call legacy string callback if provided
              if (options?.onStdout) {
                const parsed = processAgentEvents(events);
                if (parsed.length > 0) {
                  options.onStdout(parsed);
                }
              }
            }
          }
        : undefined,
      // Wrap onEnd to flush buffer before calling original callback
      onEnd: (result) => {
        flushBuffer();
        options?.onEnd?.(result);
      },
    };

    return super.execute(prompt, files, parsedOptions);
  }

  override async validateSetup(answers: Record<string, unknown>): Promise<string | null> {
    const mode = answers.mode;
    if (mode !== undefined && mode !== '' && typeof mode === 'string') {
      if (!['agent', 'plan', 'ask'].includes(mode)) {
        return 'Invalid mode. Must be one of: agent, plan, ask';
      }
    }
    return null;
  }

  override validateModel(_model: string): string | null {
    // Cursor Agent accepts various models, no strict validation
    return null;
  }

  /**
   * Get Cursor-specific suggestions for preflight failures.
   * Provides actionable guidance for common configuration issues.
   */
  protected override getPreflightSuggestion(): string {
    return (
      'Common fixes for Cursor Agent:\n' +
      '  1. Test Cursor Agent directly: agent --print "hello"\n' +
      '  2. Check Cursor Agent is installed: agent --version\n' +
      '  3. Install with: curl https://cursor.com/install | sh\n' +
      '  4. Verify your model configuration if using a specific model'
    );
  }
}

const createCursorAgent: AgentPluginFactory = () => new CursorAgentPlugin();

export default createCursorAgent;
