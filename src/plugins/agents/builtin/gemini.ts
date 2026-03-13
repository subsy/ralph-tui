/**
 * ABOUTME: Gemini CLI agent plugin for Google's Gemini command.
 * Integrates with Gemini CLI for AI-assisted coding.
 * Supports: non-interactive mode, JSONL streaming, model selection, yolo mode.
 */

import { spawn } from 'node:child_process';
import { BaseAgentPlugin, quoteForWindowsShell } from '../base.js';
import { processAgentEvents, processAgentEventsToSegments, type AgentDisplayEvent } from '../output-formatting.js';
import { extractErrorMessage } from '../utils.js';
import type {
  AgentPluginMeta,
  AgentPluginFactory,
  AgentFileContext,
  AgentExecuteOptions,
  AgentSetupQuestion,
  AgentDetectResult,
  AgentExecutionHandle,
} from '../types.js';

// Re-export for backward compatibility with tests
export { extractErrorMessage } from '../utils.js';

/**
 * Parse Gemini JSON line into standardized display events.
 * Returns AgentDisplayEvent[] - the shared processAgentEvents decides what to show.
 *
 * Gemini CLI event types (when using --output-format stream-json):
 * - "init": Session initialization (skip)
 * - "message" with role "user": Echo of input prompt (skip!)
 * - "message" with role "assistant": LLM response text (extract!)
 * - "tool_call": Tool being called
 * - "tool_result": Tool execution result
 * - "result": Stats/completion (skip)
 * - "error": Error from Gemini
 * @internal Exported for testing only.
 */
export function parseGeminiJsonLine(jsonLine: string): AgentDisplayEvent[] {
  if (!jsonLine || jsonLine.length === 0) return [];

  try {
    const event = JSON.parse(jsonLine);
    const events: AgentDisplayEvent[] = [];

    // Handle Gemini CLI event types
    if (event.type === 'message') {
      // IMPORTANT: Skip user messages - they echo the input prompt
      if (event.role === 'user') {
        return [];
      }
      // Extract assistant response
      if (event.role === 'assistant' && event.content) {
        events.push({ type: 'text', content: event.content });
      }
    } else if (event.type === 'tool_call' || event.type === 'function_call') {
      // Tool call event
      const toolName = event.name || event.function?.name || 'unknown';
      const toolInput = event.arguments || event.args || event.input;
      events.push({ type: 'tool_use', name: toolName, input: toolInput });
    } else if (event.type === 'tool_result' || event.type === 'function_result') {
      // Tool result
      const isError = event.is_error === true || event.error !== undefined;
      if (isError) {
        const errMsg = extractErrorMessage(event.error);
        events.push({ type: 'error', message: errMsg });
      }
      events.push({ type: 'tool_result' });
    } else if (event.type === 'error') {
      // Error event
      const errorMsg = extractErrorMessage(event.error) || extractErrorMessage(event.message) || 'Unknown error';
      events.push({ type: 'error', message: errorMsg });
    }
    // Skip: init, result (stats), and other non-content events

    return events;
  } catch {
    // Not valid JSON - skip silently (e.g., "YOLO mode is enabled" text)
    return [];
  }
}

/**
 * Parse Gemini JSON stream output into display events.
 * @internal Exported for testing only.
 */
export function parseGeminiOutputToEvents(data: string): AgentDisplayEvent[] {
  const allEvents: AgentDisplayEvent[] = [];
  for (const line of data.split('\n')) {
    const events = parseGeminiJsonLine(line.trim());
    allEvents.push(...events);
  }
  return allEvents;
}

/**
 * Gemini CLI agent plugin implementation.
 * Uses the `gemini-cli` CLI to execute AI coding tasks.
 */
export class GeminiAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'gemini',
    name: 'Gemini CLI',
    description: 'Google Gemini CLI for AI-assisted coding',
    version: '1.0.0',
    author: 'Google',
    defaultCommand: 'gemini-cli',
    commandAliases: ['gemini'],
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false,
    supportsSubagentTracing: true,
    structuredOutputFormat: 'jsonl',
    skillsPaths: {
      personal: '~/.gemini/skills',
      repo: '.gemini/skills',
    },
  };

  private model?: string;
  private yoloMode = true;
  protected override defaultTimeout = 0;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (typeof config.model === 'string' && config.model.length > 0) {
      this.model = config.model;
    }

    if (typeof config.yoloMode === 'boolean') {
      this.yoloMode = config.yoloMode;
    }

    if (typeof config.timeout === 'number' && config.timeout > 0) {
      this.defaultTimeout = config.timeout;
    }
  }

  override async detect(): Promise<AgentDetectResult> {
    const resolvedCommand = await this.resolveCommandPath();

    if (!resolvedCommand) {
      return {
        available: false,
        error: this.getCommandNotFoundMessage(),
      };
    }

    const commandPath = resolvedCommand.executablePath;
    const versionResult = await this.runVersion(commandPath);

    if (!versionResult.success) {
      return {
        available: false,
        executablePath: commandPath,
        error: versionResult.error,
      };
    }

    // Store the detected path for use in execute()
    this.commandPath = commandPath;

    return {
      available: true,
      version: versionResult.version,
      executablePath: commandPath,
    };
  }

  protected override getCommandNotFoundMessage(): string {
    return `Gemini CLI not found in PATH. Install from: https://github.com/google-gemini/gemini-cli` +
      ' Expected one of `gemini-cli`, `gemini` (legacy alias)';
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
              error: `Unable to parse gemini version output: ${stdout}`,
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
      }, 15000);
    });
  }

  override getSetupQuestions(): AgentSetupQuestion[] {
    return [
      ...super.getSetupQuestions(),
      {
        id: 'model',
        prompt: 'Model to use:',
        type: 'select',
        choices: [
          { value: '', label: 'Default', description: 'Use configured default model' },
          { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Most capable' },
          { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Fast and efficient' },
        ],
        default: '',
        required: false,
        help: 'Gemini model to use',
      },
      {
        id: 'yoloMode',
        prompt: 'Enable YOLO mode (auto-approve)?',
        type: 'boolean',
        default: true,
        required: false,
        help: 'Skip approval prompts for autonomous operation',
      },
    ];
  }

  protected buildArgs(
    _prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string[] {
    const args: string[] = [];

    // Note: Prompt is passed via stdin (see getStdinInput) to avoid
    // Windows shell interpretation issues with special characters.
    // Gemini CLI reads from stdin when -p is not provided.

    // Always use stream-json format for output parsing
    // This gives us structured events (text, tool_use, etc.) that we can format nicely
    args.push('--output-format', 'stream-json');

    // Model selection
    if (this.model) {
      args.push('-m', this.model);
    }

    // Auto-approve mode
    if (this.yoloMode) {
      args.push('--yolo');
    }

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
   * Override execute to parse Gemini JSON output.
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
      const events = parseGeminiOutputToEvents(trimmed);
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
            const events = parseGeminiOutputToEvents(completeData);
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
    const model = answers.model;
    if (model !== undefined && model !== '' && typeof model === 'string') {
      if (!model.startsWith('gemini-')) {
        return 'Invalid model. Gemini models start with "gemini-"';
      }
    }
    return null;
  }

  override validateModel(model: string): string | null {
    if (model === '' || model === undefined) {
      return null;
    }
    if (!model.startsWith('gemini-')) {
      return `Invalid model "${model}". Gemini models start with "gemini-"`;
    }
    return null;
  }
}

const createGeminiAgent: AgentPluginFactory = () => new GeminiAgentPlugin();

export default createGeminiAgent;
