/**
 * ABOUTME: xAI Grok CLI agent plugin for the official grok command.
 * Integrates with Grok Build TUI (xAI) for AI-assisted coding.
 * Supports: single-turn (-p) mode, streaming-json output, stdin prompt via --prompt-file, model selection.
 */

import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { BaseAgentPlugin, findCommandPath, quoteForWindowsShell } from '../base.js';
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

/**
 * Parse a Grok streaming-json line into standardized display events.
 *
 * Grok CLI `--output-format streaming-json` emits NDJSON events:
 * - {"type":"text","data":"..."} — response text deltas
 * - {"type":"thought","data":"..."} — internal reasoning (skip)
 * - {"type":"tool_call","toolName":"...","rawInput":{...},...} — tool invocation
 * - {"type":"tool_call_update","status":"completed","rawOutput":...} — tool result
 * - {"type":"available_commands",...} / {"type":"usage",...} / {"type":"end",...} — skip
 * - {"type":"error",...} — error events
 *
 * @internal Exported for testing only.
 */
export function parseGrokJsonLine(jsonLine: string): AgentDisplayEvent[] {
  if (!jsonLine) return [];

  try {
    const event = JSON.parse(jsonLine) as Record<string, unknown>;
    const events: AgentDisplayEvent[] = [];
    const type = event.type;

    if (type === 'text' && typeof event.data === 'string' && event.data.length > 0) {
      events.push({ type: 'text', content: event.data });
    } else if (type === 'tool_call') {
      const toolName =
        (typeof event.toolName === 'string' && event.toolName) ||
        (typeof event.title === 'string' && event.title) ||
        'unknown';
      const toolInput =
        event.rawInput != null && typeof event.rawInput === 'object' && !Array.isArray(event.rawInput)
          ? (event.rawInput as Record<string, unknown>)
          : undefined;
      events.push({ type: 'tool_use', name: toolName, input: toolInput });
    } else if (type === 'tool_call_update') {
      const status = event.status;
      if (status === 'completed' || status === 'failed' || status === 'error') {
        if (status === 'failed' || status === 'error') {
          const errMsg =
            extractErrorMessage(event.rawOutput) ||
            extractErrorMessage(event.error) ||
            extractErrorMessage(event.message) ||
            'Tool call failed';
          events.push({ type: 'error', message: errMsg.slice(0, 200) });
        }
        events.push({ type: 'tool_result' });
      }
    } else if (type === 'error') {
      const msg =
        extractErrorMessage(event.error) ||
        extractErrorMessage(event.message) ||
        extractErrorMessage(event.data) ||
        'Unknown error';
      events.push({ type: 'error', message: msg });
    }
    // Skip: thought, available_commands, usage, end, and other non-content events

    return events;
  } catch {
    // Not valid JSON - skip
    return [];
  }
}

/**
 * Parse Grok streaming-json output into display events.
 * @internal Exported for testing only.
 */
export function parseGrokOutputToEvents(data: string): AgentDisplayEvent[] {
  const allEvents: AgentDisplayEvent[] = [];
  for (const line of data.split('\n')) {
    const events = parseGrokJsonLine(line.trim());
    allEvents.push(...events);
  }
  return allEvents;
}

/**
 * xAI Grok CLI agent plugin implementation.
 * Uses `grok -p` (single-turn) with `--output-format streaming-json` and `--always-approve`.
 * Prompt is delivered via stdin using `--prompt-file /dev/stdin` on Unix-like systems
 * (Grok does not read bare stdin; Windows falls back to `-p` with the prompt arg).
 */
export class GrokAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'grok',
    name: 'Grok CLI',
    description: 'xAI Grok Build TUI for AI-assisted coding',
    version: '1.0.0',
    author: 'xAI',
    defaultCommand: 'grok',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false,
    supportsSubagentTracing: true,
    structuredOutputFormat: 'jsonl',
    skillsPaths: {
      personal: '~/.grok/skills',
      repo: '.grok/skills',
    },
  };

  private model?: string;
  protected override defaultTimeout = 0;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (typeof config.model === 'string' && config.model.trim().length > 0) {
      this.model = config.model.trim();
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
        error:
          'Grok CLI not found in PATH. Install from: https://docs.x.ai/docs/cli (or run the official installer to place grok on PATH)',
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
          // e.g. "grok 0.2.118 (1e1687c1cf6a) [stable]"
          const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
          if (!versionMatch?.[1]) {
            safeResolve({
              success: false,
              error: `Unable to parse grok version output: ${stdout}`,
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

  override getSandboxRequirements() {
    return {
      authPaths: ['~/.grok'],
      binaryPaths: ['~/.grok/bin', '~/.local/bin', '/usr/local/bin'],
      runtimePaths: [],
      requiresNetwork: true,
    };
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
        help: 'Grok model ID (e.g., grok-4.5). Leave empty for default. List with: grok models',
      },
    ];
  }

  protected buildArgs(
    prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string[] {
    const args: string[] = [];

    // Auto-approve tool executions (required for unattended ralph-tui loops)
    args.push('--always-approve');

    // Structured NDJSON stream for subagent tracing and display parsing
    args.push('--output-format', 'streaming-json');

    // Prompt delivery:
    // Grok does not read bare stdin. On Unix we use --prompt-file /dev/stdin so the
    // prompt is still provided via the process stdin pipe (avoids arg length / shell issues).
    // On Windows /dev/stdin is unavailable, so fall back to -p with the prompt argument.
    if (platform() === 'win32') {
      args.push('-p', prompt);
    } else {
      args.push('--prompt-file', '/dev/stdin');
    }

    // Model selection
    if (this.model) {
      args.push('--model', this.model);
    }

    return args;
  }

  /**
   * Provide the prompt via stdin when using --prompt-file /dev/stdin.
   * On Windows, prompt is already in -p args so no stdin content is needed.
   */
  protected override getStdinInput(
    prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string | undefined {
    if (platform() === 'win32') {
      return undefined;
    }
    return prompt;
  }

  /**
   * Override execute to parse Grok streaming-json output into structured display events.
   * Wraps onStdout/onStdoutSegments callbacks to parse JSON lines and extract
   * displayable content (text, tool calls, errors).
   */
  override execute(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): AgentExecutionHandle {
    // Buffer for incomplete JSON lines split across chunks
    let jsonlBuffer = '';

    const flushBuffer = () => {
      if (!jsonlBuffer) return;
      const trimmed = jsonlBuffer.trim();
      if (!trimmed) return;

      if (options?.onJsonlMessage && trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          options.onJsonlMessage(parsed);
        } catch {
          // Not valid JSON, skip
        }
      }

      const events = parseGrokOutputToEvents(trimmed);
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

    const parsedOptions: AgentExecuteOptions = {
      ...options,
      onStdout:
        options?.onStdout || options?.onStdoutSegments || options?.onJsonlMessage
          ? (data: string) => {
              const combined = jsonlBuffer + data;
              const lines = combined.split('\n');

              if (!data.endsWith('\n')) {
                jsonlBuffer = lines.pop() || '';
              } else {
                jsonlBuffer = '';
              }

              const completeData = lines.join('\n');

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

              const events = parseGrokOutputToEvents(completeData);
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
            }
          : undefined,
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
    if (model === '' || model.trim().length === 0) {
      return null;
    }
    // Grok accepts model IDs flexibly; list with `grok models`
    return null;
  }

  /**
   * Get Grok-specific suggestions for preflight failures.
   */
  protected override getPreflightSuggestion(): string {
    return (
      'Common fixes for Grok CLI:\n' +
      '  1. Test Grok directly: grok -p "hello" --always-approve\n' +
      '  2. Check Grok is installed: grok --version\n' +
      '  3. Ensure you are logged in: grok login (OAuth via SuperGrok / xAI)\n' +
      '  4. Auth is stored at ~/.grok/auth.json\n' +
      '  5. List available models: grok models'
    );
  }
}

/**
 * Factory function for the Grok CLI agent plugin.
 */
const createGrokAgent: AgentPluginFactory = () => new GrokAgentPlugin();

export default createGrokAgent;
