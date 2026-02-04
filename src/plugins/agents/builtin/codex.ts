/**
 * ABOUTME: Codex CLI agent plugin for OpenAI's codex command.
 * Integrates with Codex CLI for AI-assisted coding.
 * Supports: non-interactive exec mode, JSONL streaming, full-auto mode, sandbox modes.
 */

import { spawn } from 'node:child_process';
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

// Re-export for backward compatibility with tests
export { extractErrorMessage } from '../utils.js';

/**
 * Parse Codex JSON line into standardized display events.
 * Returns AgentDisplayEvent[] - the shared processAgentEvents decides what to show.
 *
 * Codex CLI event types (when using --json flag):
 * - "thread.started": Session started (skip)
 * - "turn.started": Turn started (skip)
 * - "item.started": Item starting - can be todo_list, command_execution, agent_message
 * - "item.completed": Item finished - extract text from agent_message
 * - "turn.completed": Turn finished with usage stats (skip)
 * - "error": Error from Codex
 * @internal Exported for testing only.
 */
export function parseCodexJsonLine(jsonLine: string): AgentDisplayEvent[] {
  if (!jsonLine || jsonLine.length === 0) return [];

  try {
    const event = JSON.parse(jsonLine);
    const events: AgentDisplayEvent[] = [];

    // Handle Codex CLI's actual event types
    if (event.type === 'item.completed' || event.type === 'item.started') {
      const item = event.item;
      if (!item) return [];

      // Agent message - extract text
      if (item.type === 'agent_message' && item.text) {
        events.push({ type: 'text', content: item.text });
      }
      // Command execution - show as tool use
      else if (item.type === 'command_execution') {
        if (event.type === 'item.started' && item.command) {
          events.push({ type: 'tool_use', name: 'shell', input: { command: item.command } });
        } else if (event.type === 'item.completed') {
          const isError = item.exit_code !== 0 && item.exit_code !== null;
          if (isError && item.aggregated_output) {
            events.push({ type: 'error', message: item.aggregated_output.slice(0, 500) });
          }
          events.push({ type: 'tool_result' });
        }
      }
      // File operations
      else if (item.type === 'file_edit' || item.type === 'file_write' || item.type === 'file_read') {
        if (event.type === 'item.started') {
          const filePath = item.file_path || item.path || 'unknown';
          events.push({ type: 'tool_use', name: item.type, input: { path: filePath } });
        } else {
          events.push({ type: 'tool_result' });
        }
      }
    }
    // Error events
    else if (event.type === 'error' || event.error) {
      const errorMsg = extractErrorMessage(event.error) || extractErrorMessage(event.message) || 'Unknown error';
      events.push({ type: 'error', message: errorMsg });
    }
    // Skip: thread.started, turn.started, turn.completed (no displayable content)

    return events;
  } catch {
    // Not valid JSON - skip silently
    return [];
  }
}

/**
 * Parse Codex JSON stream output into display events.
 * @internal Exported for testing only.
 */
export function parseCodexOutputToEvents(data: string): AgentDisplayEvent[] {
  const allEvents: AgentDisplayEvent[] = [];
  for (const line of data.split('\n')) {
    const events = parseCodexJsonLine(line.trim());
    allEvents.push(...events);
  }
  return allEvents;
}

/**
 * Codex CLI agent plugin implementation.
 * Uses the `codex exec` command for non-interactive AI coding tasks.
 */
export class CodexAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'codex',
    name: 'Codex CLI',
    description: 'OpenAI Codex CLI for AI-assisted coding',
    version: '1.0.0',
    author: 'OpenAI',
    defaultCommand: 'codex',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false,
    supportsSubagentTracing: true,
    structuredOutputFormat: 'jsonl',
    skillsPaths: {
      personal: '~/.codex/skills',
      repo: '.codex/skills',
    },
  };

  private model?: string;
  private fullAuto = true;
  private sandbox: 'read-only' | 'workspace-write' | 'danger-full-access' = 'workspace-write';
  protected override defaultTimeout = 0;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (typeof config.model === 'string' && config.model.length > 0) {
      this.model = config.model;
    }

    if (typeof config.fullAuto === 'boolean') {
      this.fullAuto = config.fullAuto;
    }

    if (typeof config.sandbox === 'string' &&
        ['read-only', 'workspace-write', 'danger-full-access'].includes(config.sandbox)) {
      this.sandbox = config.sandbox as typeof this.sandbox;
    }

    if (typeof config.timeout === 'number' && config.timeout > 0) {
      this.defaultTimeout = config.timeout;
    }
  }

  override getSandboxRequirements() {
    return {
      authPaths: ['~/.codex', '~/.config/codex', '~/.local/share/codex'],
      binaryPaths: [
        '/usr/local/bin',
        '~/.local/bin',
        '~/.local/share/mise/installs',
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
        error: `Codex CLI not found in PATH. Install from: https://github.com/openai/codex`,
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
              error: `Unable to parse codex version output: ${stdout}`,
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
        help: 'OpenAI model to use (leave empty for default)',
      },
      {
        id: 'fullAuto',
        prompt: 'Enable full-auto mode?',
        type: 'boolean',
        default: true,
        required: false,
        help: 'Auto-approve all actions for autonomous operation',
      },
      {
        id: 'sandbox',
        prompt: 'Sandbox mode:',
        type: 'select',
        choices: [
          { value: 'read-only', label: 'Read Only', description: 'No file modifications' },
          { value: 'workspace-write', label: 'Workspace Write', description: 'Can modify workspace files' },
          { value: 'danger-full-access', label: 'Full Access', description: 'Full system access (dangerous)' },
        ],
        default: 'workspace-write',
        required: false,
        help: 'Sandbox restrictions for file access',
      },
    ];
  }

  protected buildArgs(
    _prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string[] {
    const preArgs: string[] = [];
    const args: string[] = [];

    // --full-auto forces workspace-write; use approval flag when sandbox is customized.
    // -a is a global flag (must come before exec), --full-auto is a subcommand flag (after exec).
    if (this.fullAuto && this.sandbox !== 'workspace-write') {
      preArgs.push('-a', 'on-request');
    }

    // Use exec subcommand for non-interactive mode
    args.push('exec');

    // --full-auto is a subcommand flag, must come after exec
    if (this.fullAuto && this.sandbox === 'workspace-write') {
      args.push('--full-auto');
    }

    // Always use JSON format for output parsing
    // This gives us structured events (text, tool_use, etc.) that we can format nicely
    args.push('--json');

    // Model selection
    if (this.model) {
      args.push('--model', this.model);
    }

    // Sandbox mode
    args.push('--sandbox', this.sandbox);

    // Use '-' to tell Codex to read prompt from stdin (per CLI reference docs)
    args.push('-');

    return [...preArgs, ...args];
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
   * Override execute to parse Codex JSON output.
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
      const events = parseCodexOutputToEvents(trimmed);
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
            const events = parseCodexOutputToEvents(completeData);
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

  override async validateSetup(_answers: Record<string, unknown>): Promise<string | null> {
    return null;
  }

  override validateModel(_model: string): string | null {
    // Codex accepts various OpenAI models, no strict validation
    return null;
  }
}

const createCodexAgent: AgentPluginFactory = () => new CodexAgentPlugin();

export default createCodexAgent;
