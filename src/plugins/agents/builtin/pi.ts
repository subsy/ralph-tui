/**
 * ABOUTME: Pi Coding Agent plugin for the pi CLI.
 * Integrates with Pi (pi-coding-agent) for AI-assisted coding.
 * Supports: non-interactive mode (--print), JSON output, multi-provider models.
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
 * Pi Coding Agent plugin implementation.
 * Uses `pi --print --mode json` for non-interactive AI coding tasks.
 * Pi outputs structured JSONL with rich event types for subagent tracing.
 */
export class PiAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'pi',
    name: 'Pi Coding Agent',
    description: 'Minimal, extensible terminal coding agent with tiny core',
    version: '1.0.0',
    author: 'badlogic',
    defaultCommand: 'pi',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: true,
    supportsSubagentTracing: true,
    structuredOutputFormat: 'jsonl',
    skillsPaths: {
      personal: '~/.pi/skills',
      repo: '.pi/skills',
    },
  };

  /** Output mode: text or json */
  private mode: 'text' | 'json' = 'json';

  /** Model to use (supports "provider/id" format and ":thinking" suffix) */
  private model?: string;

  /** Thinking level: off, minimal, low, medium, high, xhigh */
  private thinking?: string;

  /** Timeout in milliseconds (0 = no timeout) */
  protected override defaultTimeout = 0;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (
      typeof config.mode === 'string' &&
      ['text', 'json'].includes(config.mode)
    ) {
      this.mode = config.mode as 'text' | 'json';
    }

    if (typeof config.model === 'string' && config.model.length > 0) {
      this.model = config.model;
    }

    if (
      typeof config.thinking === 'string' &&
      ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(config.thinking)
    ) {
      this.thinking = config.thinking;
    }

    if (typeof config.timeout === 'number' && config.timeout > 0) {
      this.defaultTimeout = config.timeout;
    }
  }

  override async detect(): Promise<AgentDetectResult> {
    const command = this.commandPath ?? this.meta.defaultCommand;

    // Find the binary in PATH
    const findResult = await findCommandPath(command);

    if (!findResult.found) {
      return {
        available: false,
        error: `Pi not found in PATH. Install from: https://github.com/badlogic/pi-coding-agent`,
      };
    }

    // Store the resolved path for execute() to use
    this.commandPath = findResult.path;

    // Verify the binary works by running --version
    const versionResult = await this.runVersion(findResult.path);

    if (!versionResult.success) {
      return {
        available: false,
        executablePath: findResult.path,
        error: versionResult.error,
      };
    }

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

      const settle = (result: { success: boolean; version?: string; error?: string }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        resolve(result);
      };

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        settle({
          success: false,
          error: `Failed to execute: ${error.message}`,
        });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // Pi outputs version as "X.Y.Z"
          const versionMatch = stdout.trim().match(/(\d+\.\d+\.\d+)/);
          settle({
            success: true,
            version: versionMatch?.[1],
          });
        } else {
          settle({
            success: false,
            error: stderr || `Exited with code ${code}`,
          });
        }
      });

      // Timeout after 15 seconds
      const timeoutId = setTimeout(() => {
        proc.kill();
        settle({ success: false, error: 'Timeout waiting for --version' });
      }, 15000);
    });
  }

  override getSandboxRequirements() {
    return {
      authPaths: ['~/.pi'],
      binaryPaths: ['/usr/local/bin', '~/.local/bin'],
      runtimePaths: ['~/.bun', '~/.nvm'],
      requiresNetwork: true,
    };
  }

  override getSetupQuestions(): AgentSetupQuestion[] {
    const baseQuestions = super.getSetupQuestions();
    return [
      ...baseQuestions,
      {
        id: 'mode',
        prompt: 'Output mode:',
        type: 'select',
        choices: [
          {
            value: 'json',
            label: 'JSON',
            description: 'Structured JSONL output (recommended for tracing)',
          },
          { value: 'text', label: 'Text', description: 'Plain text output' },
        ],
        default: 'json',
        required: false,
        help: 'JSON mode enables subagent tracing with structured events',
      },
      {
        id: 'model',
        prompt: 'Model to use (e.g., sonnet, openai/gpt-4o):',
        type: 'text',
        default: '',
        required: false,
        help: 'Model pattern or ID. Supports "provider/id" format (e.g., anthropic/claude-sonnet, openai/gpt-4o)',
      },
      {
        id: 'thinking',
        prompt: 'Thinking level:',
        type: 'select',
        choices: [
          { value: '', label: 'Default', description: 'Use model defaults' },
          { value: 'off', label: 'Off', description: 'No extended thinking' },
          { value: 'minimal', label: 'Minimal', description: 'Minimal thinking' },
          { value: 'low', label: 'Low', description: 'Low thinking budget' },
          { value: 'medium', label: 'Medium', description: 'Medium thinking budget' },
          { value: 'high', label: 'High', description: 'High thinking budget' },
          { value: 'xhigh', label: 'Extra High', description: 'Maximum thinking' },
        ],
        default: '',
        required: false,
        help: 'Extended thinking level for supported models',
      },
    ];
  }

  protected buildArgs(
    _prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): string[] {
    const args: string[] = [];

    // Non-interactive mode
    args.push('--print');

    // Output mode - use JSON for subagent tracing
    if (options?.subagentTracing || this.mode === 'json') {
      args.push('--mode', 'json');
    }

    // Model selection
    if (this.model) {
      args.push('--model', this.model);
    }

    // Thinking level
    if (this.thinking) {
      args.push('--thinking', this.thinking);
    }

    // File context - Pi uses @file syntax
    // Files are passed as positional args with @ prefix
    if (files && files.length > 0) {
      for (const file of files) {
        args.push(`@${file.path}`);
      }
    }

    // NOTE: Prompt is passed via stdin to avoid shell interpretation issues

    return args;
  }

  /**
   * Provide the prompt via stdin instead of command args.
   * This avoids shell interpretation issues with special characters.
   */
  protected override getStdinInput(
    prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string {
    return prompt;
  }

  /**
   * Parse a Pi JSONL line into standardized display events.
   */
  private parsePiJsonLine(jsonLine: string): AgentDisplayEvent[] {
    if (!jsonLine || jsonLine.length === 0) return [];

    try {
      const event = JSON.parse(jsonLine) as Record<string, unknown>;
      const events: AgentDisplayEvent[] = [];

      switch (event.type) {
        case 'message_update': {
          const assistantEvent = event.assistantMessageEvent as Record<string, unknown> | undefined;
          if (assistantEvent) {
            const eventType = assistantEvent.type as string | undefined;
            switch (eventType) {
              case 'text_delta':
              case 'text_end':
                // Text content is accumulated in the message
                break;
              case 'tool_use_start':
                events.push({
                  type: 'tool_use',
                  name: assistantEvent.name as string,
                  input: assistantEvent.input as Record<string, unknown>,
                });
                break;
              case 'tool_use_end':
                events.push({ type: 'tool_result' });
                break;
            }
          }
          break;
        }

        case 'message_end': {
          const message = event.message as Record<string, unknown> | undefined;
          if (message && Array.isArray(message.content)) {
            for (const block of message.content) {
              const blockType = (block as Record<string, unknown>).type as string;
              if (blockType === 'text') {
                const text = (block as Record<string, unknown>).text as string;
                if (text) {
                  events.push({ type: 'text', content: text });
                }
              }
            }
          }
          break;
        }

        case 'turn_end': {
          const msg = event.message as Record<string, unknown> | undefined;
          if (msg && Array.isArray(msg.toolResults) && msg.toolResults.length > 0) {
            for (const result of msg.toolResults) {
              const resultObj = result as Record<string, unknown>;
              if (resultObj.error) {
                events.push({
                  type: 'error',
                  message: String(resultObj.error),
                });
              }
            }
          }
          break;
        }
      }

      return events;
    } catch {
      // Not valid JSON - skip
      return [];
    }
  }

  /**
   * Override execute to parse Pi JSONL output for display.
   */
  override execute(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): AgentExecutionHandle {
    const isJsonMode = options?.subagentTracing || this.mode === 'json';
    let jsonlBuffer = '';

    const processLines = (lines: string[]) => {
      const events: AgentDisplayEvent[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (options?.onJsonlMessage) {
          try {
            const rawJson = JSON.parse(trimmed) as Record<string, unknown>;
            options.onJsonlMessage(rawJson);
          } catch {
            // Not valid JSON, skip
          }
        }

        events.push(...this.parsePiJsonLine(trimmed));
      }

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
    };

    const parsedOptions: AgentExecuteOptions = {
      ...options,
      onStdout: isJsonMode && (options?.onStdout || options?.onStdoutSegments || options?.onJsonlMessage)
        ? (data: string) => {
            jsonlBuffer += data;
            const lines = jsonlBuffer.split('\n');
            // Last element is incomplete — keep it in the buffer
            jsonlBuffer = lines.pop() ?? '';
            processLines(lines);
          }
        : options?.onStdout,
      onEnd: isJsonMode && (options?.onStdout || options?.onStdoutSegments || options?.onJsonlMessage)
        ? (result) => {
            // Flush any remaining buffered data
            if (jsonlBuffer.trim()) {
              processLines([jsonlBuffer]);
              jsonlBuffer = '';
            }
            options?.onEnd?.(result);
          }
        : options?.onEnd,
    };

    return super.execute(prompt, files, parsedOptions);
  }

  override async validateSetup(
    _answers: Record<string, unknown>
  ): Promise<string | null> {
    return null;
  }

  /**
   * Validate a model name for Pi.
   * Pi accepts any model pattern (flexible format).
   */
  override validateModel(_model: string): string | null {
    // Pi accepts any model pattern, including:
    // - Shorthand: "sonnet", "haiku", "opus"
    // - Provider prefix: "openai/gpt-4o", "anthropic/claude-sonnet"
    // - With thinking suffix: "sonnet:high"
    return null;
  }

  /**
   * Get Pi-specific suggestions for preflight failures.
   */
  protected override getPreflightSuggestion(): string {
    return (
      'Common fixes for Pi:\n' +
      '  1. Test Pi directly: pi "hello"\n' +
      '  2. Check Pi is installed: pi --version\n' +
      '  3. Verify API key is set for your provider:\n' +
      '     - Anthropic: ANTHROPIC_API_KEY\n' +
      '     - OpenAI: OPENAI_API_KEY\n' +
      '     - Google: GEMINI_API_KEY\n' +
      '  4. List available models: pi --list-models'
    );
  }
}

/**
 * Factory function for the Pi Coding Agent plugin.
 */
const createPiAgent: AgentPluginFactory = () => new PiAgentPlugin();

export default createPiAgent;
