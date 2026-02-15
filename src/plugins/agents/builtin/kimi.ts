/**
 * ABOUTME: Kimi CLI agent plugin for Moonshot AI's kimi command.
 * Integrates with Kimi Code CLI for AI-assisted coding.
 * Supports: non-interactive (print) mode, stream-json output, stdin prompt, model selection.
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
 * Parse a Kimi stream-json line into standardized display events.
 *
 * Kimi CLI stream-json format:
 * - {"role":"assistant","content":[{"type":"think","think":"..."}, {"type":"text","text":"..."}]}
 * - {"role":"tool","content":[{"type":"function","id":"...","function":{"name":"...","arguments":"..."}}]}
 * - Tool results, status updates, etc.
 *
 * @internal Exported for testing only.
 */
export function parseKimiJsonLine(jsonLine: string): AgentDisplayEvent[] {
  if (!jsonLine || jsonLine.length === 0) return [];

  try {
    const event = JSON.parse(jsonLine);
    const events: AgentDisplayEvent[] = [];

    // Handle content array format (most common)
    if (event.content && Array.isArray(event.content)) {
      for (const item of event.content) {
        if (item.type === 'text' && item.text) {
          events.push({ type: 'text', content: item.text });
        } else if (item.type === 'function' && item.function) {
          // Tool call
          const toolName = item.function.name || 'unknown';
          let toolInput: Record<string, unknown> | undefined;
          if (item.function.arguments) {
            try {
              toolInput = JSON.parse(item.function.arguments);
            } catch {
              toolInput = { command: item.function.arguments };
            }
          }
          events.push({ type: 'tool_use', name: toolName, input: toolInput });
        } else if (item.type === 'tool_result' || item.type === 'function_result') {
          const isError = item.is_error === true;
          if (isError && item.output) {
            events.push({ type: 'error', message: String(item.output).slice(0, 200) });
          }
          events.push({ type: 'tool_result' });
        }
        // Skip: think (internal reasoning), status updates, etc.
      }
    }

    // Handle top-level text content
    if (event.type === 'text' && event.text) {
      events.push({ type: 'text', content: event.text });
    }

    // Handle error events
    if (event.type === 'error' || event.error) {
      const msg = event.error?.message || event.message || event.error || 'Unknown error';
      events.push({ type: 'error', message: String(msg) });
    }

    return events;
  } catch {
    // Not valid JSON - skip
    return [];
  }
}

/**
 * Parse Kimi stream-json output into display events.
 * @internal Exported for testing only.
 */
export function parseKimiOutputToEvents(data: string): AgentDisplayEvent[] {
  const allEvents: AgentDisplayEvent[] = [];
  for (const line of data.split('\n')) {
    const events = parseKimiJsonLine(line.trim());
    allEvents.push(...events);
  }
  return allEvents;
}

/**
 * Kimi CLI agent plugin implementation.
 * Uses the `kimi` CLI with `--print` mode for non-interactive AI coding tasks.
 * Parses stream-json output into structured display events for the TUI.
 */
export class KimiAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'kimi',
    name: 'Kimi CLI',
    description: 'Moonshot AI Kimi Code CLI for AI-assisted coding',
    version: '1.0.0',
    author: 'Moonshot AI',
    defaultCommand: 'kimi',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false,
    supportsSubagentTracing: true,
    structuredOutputFormat: 'jsonl',
    skillsPaths: {
      personal: '~/.kimi/skills',
      repo: '.kimi/skills',
    },
  };

  private model?: string;
  protected override defaultTimeout = 0;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (typeof config.model === 'string' && config.model.length > 0) {
      this.model = config.model;
    }

    if (typeof config.timeout === 'number' && config.timeout > 0) {
      this.defaultTimeout = config.timeout;
    }
  }

  override async detect(): Promise<AgentDetectResult> {
    const command = this.commandPath ?? this.meta.defaultCommand;
    const findResult = await findCommandPath(command);

    if (!findResult.found) {
      return {
        available: false,
        error: `Kimi CLI not found in PATH. Install: curl -LsSf https://code.kimi.com/install.sh | bash (see https://moonshotai.github.io/kimi-cli/en/guides/getting-started.html)`,
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
              error: `Unable to parse kimi version output: ${stdout}`,
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
        type: 'text',
        default: '',
        required: false,
        help: 'Kimi model to use (e.g., kimi-k2-0711). Leave empty for default.',
      },
    ];
  }

  protected buildArgs(
    _prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string[] {
    const args: string[] = [];

    // Use --print for non-interactive mode (implicitly adds --yolo)
    args.push('--print');

    // Use stdin for prompt delivery via --input-format text
    // This avoids Windows shell word-splitting issues with --prompt
    args.push('--input-format', 'text');

    // Use stream-json for structured output that we can parse into display events
    args.push('--output-format', 'stream-json');

    // Model selection
    if (this.model) {
      args.push('--model', this.model);
    }

    return args;
  }

  /**
   * Provide the prompt via stdin.
   * Kimi CLI with --print --input-format text reads from stdin,
   * which avoids Windows shell word-splitting issues with --prompt.
   */
  protected override getStdinInput(
    prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string {
    return prompt;
  }

  /**
   * Override execute to parse Kimi stream-json output into structured display events.
   * Wraps onStdout/onStdoutSegments callbacks to parse JSON lines and extract
   * displayable content (text, tool calls, errors), matching Gemini's approach.
   * Also injects Python UTF-8 env vars for Windows compatibility.
   */
  override execute(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): AgentExecutionHandle {
    // Buffer for incomplete JSON lines split across chunks
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
      const events = parseKimiOutputToEvents(trimmed);
      if (events.length > 0) {
        if (options?.onStdoutSegments) {
          const segments = processAgentEventsToSegments(events);
          if (segments.length > 0) {
            options.onStdoutSegments(segments);
          }
        }
        if (options?.onStdout) {
          const formatted = processAgentEvents(events);
          if (formatted.length > 0) {
            options.onStdout(formatted);
          }
        }
      }

      jsonlBuffer = '';
    };

    // Wrap callbacks to parse JSON events
    const parsedOptions: AgentExecuteOptions = {
      ...options,
      // Inject Python UTF-8 env vars for Windows charmap compatibility
      env: {
        ...options?.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
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

          // Parse raw JSON lines and forward to onJsonlMessage for subagent tracing
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
          const events = parseKimiOutputToEvents(completeData);
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
              const formatted = processAgentEvents(events);
              if (formatted.length > 0) {
                options.onStdout(formatted);
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
      const err = this.validateModel(model);
      if (err) return err;
    }
    return null;
  }

  override validateModel(model: string): string | null {
    if (model === '' || model === undefined) {
      return null;
    }
    // Kimi CLI accepts various model identifiers; basic validation only
    if (typeof model !== 'string' || model.trim().length === 0) {
      return 'Model name must be a non-empty string';
    }
    return null;
  }
}

const createKimiAgent: AgentPluginFactory = () => new KimiAgentPlugin();

export default createKimiAgent;
