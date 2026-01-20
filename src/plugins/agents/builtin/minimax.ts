/**
 * ABOUTME: MiniMax agent plugin for the MiniMax CLI.
 * Integrates with MiniMax AI for coding assistance.
 * Supports: model selection, file context, timeout, and streaming output.
 */

import { spawn } from 'node:child_process';
import { BaseAgentPlugin, findCommandPath } from '../base.js';
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
 * Parse MiniMax stream-json output into standardized display events.
 * MiniMax (Claude Code) outputs JSON lines when using --output-format stream-json --verbose
 *
 * Event types:
 * - {"type":"assistant","message":{...}} - Assistant response with content
 * - {"type":"result",...} - Final result with result field
 * - {"type":"system","subtype":"init",...} - Initialization (skip for display)
 * - {"type":"tool_use",...} - Tool being called (show name and details)
 * - {"type":"tool_result",...} - Tool result (check for errors)
 */
function parseMiniMaxOutputToEvents(data: string): AgentDisplayEvent[] {
  const allEvents: AgentDisplayEvent[] = [];

  for (const line of data.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;

    try {
      const event = JSON.parse(trimmed);

      switch (event.type) {
        case 'assistant': {
          // Assistant message - extract text content from message.content array
          if (event.message?.content && Array.isArray(event.message.content)) {
            for (const contentItem of event.message.content) {
              if (contentItem.type === 'text' && contentItem.text) {
                allEvents.push({ type: 'text', content: contentItem.text });
              }
            }
          }
          break;
        }

        case 'result': {
          // Final result - check for errors and include result text
          if (event.subtype === 'error' || event.is_error) {
            const errorMsg = event.error || event.result || 'Unknown error';
            allEvents.push({ type: 'error', message: String(errorMsg) });
          }
          // Include result text if available
          if (event.result && typeof event.result === 'string') {
            allEvents.push({ type: 'text', content: event.result });
          }
          break;
        }

        case 'tool_use': {
          // Tool being called - show name and relevant details
          const toolName = event.tool_name || event.tool || event.name || 'unknown';
          const toolInput = event.input || event.parameters;
          allEvents.push({ type: 'tool_use', name: toolName, input: toolInput });
          break;
        }

        case 'tool_result': {
          // Tool completed - check for errors
          const isError = event.is_error === true || event.isError === true;
          if (isError) {
            const errorMsg = event.error || event.output || 'tool execution failed';
            allEvents.push({ type: 'error', message: String(errorMsg) });
          }
          // Always include tool_result marker (shared logic will skip for display)
          allEvents.push({ type: 'tool_result' });
          break;
        }

        case 'system':
          // System events like init, hook_response - skip for display
          allEvents.push({ type: 'system', subtype: event.subtype || 'system' });
          break;

        default:
          // Unknown event type - try to extract any readable content
          if (event.message && typeof event.message === 'string') {
            allEvents.push({ type: 'text', content: event.message });
          }
      }
    } catch {
      // Not valid JSON - skip this line
      // (stream-json should output valid JSON lines)
    }
  }

  return allEvents;
}

/**
 * MiniMax agent plugin implementation.
 * Uses the `minimax` CLI for AI coding tasks.
 *
 * Key features:
 * - Auto-detects minimax binary using `which`
 * - Supports model selection via --model flag
 * - File context via --add-dir flag
 * - Timeout handling with graceful SIGTERM before SIGKILL
 * - Streaming stdout/stderr capture
 * - JSON output parsing for structured events
 */
export class MiniMaxAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'minimax',
    name: 'MiniMax',
    description: 'MiniMax AI coding assistant',
    version: '1.0.0',
    author: 'MiniMax',
    defaultCommand: 'minimax',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: true,
    supportsSubagentTracing: true,
    structuredOutputFormat: 'jsonl',
    skillsPaths: {
      personal: '~/.cc-mirror/minimax/config/skills',
      repo: '.minimax/skills',
    },
  };

  /** Model to use (e.g., 'MiniMax-M2.1', 'MiniMax-M2') */
  private model?: string;

  /** Skip permission prompts for autonomous operation */
  private skipPermissions = true;

  /** Timeout in milliseconds (0 = no timeout) */
  protected override defaultTimeout = 0;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (typeof config.model === 'string' && config.model.length > 0) {
      this.model = config.model;
    }

    if (typeof config.skipPermissions === 'boolean') {
      this.skipPermissions = config.skipPermissions;
    }

    if (typeof config.timeout === 'number' && config.timeout > 0) {
      this.defaultTimeout = config.timeout;
    }
  }

  /**
   * Detect minimax CLI availability.
   * Uses platform-appropriate command (where on Windows, which on Unix).
   */
  override async detect(): Promise<AgentDetectResult> {
    const command = this.commandPath ?? this.meta.defaultCommand;

    // First, try to find the binary in PATH
    const findResult = await findCommandPath(command);

    if (!findResult.found) {
      return {
        available: false,
        error: `MiniMax CLI not found in PATH. Install from https://github.com/anthropics/claude-code`,
      };
    }

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

  override getSandboxRequirements() {
    return {
      authPaths: ['~/.cc-mirror/minimax/config', '~/.minimax', '~/.config/minimax'],
      binaryPaths: ['/usr/local/bin', '~/.local/bin', '~/.npm-global', '~/.cc-mirror/minimax/npm'],
      runtimePaths: ['~/.bun', '~/.nvm'],
      requiresNetwork: true,
    };
  }

  /**
   * Run --version to verify binary and extract version number
   */
  private runVersion(
    command: string
  ): Promise<{ success: boolean; version?: string; error?: string }> {
    return new Promise((resolve) => {
      const proc = spawn(command, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (error) => {
        resolve({
          success: false,
          error: `Failed to execute: ${error.message}`,
        });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // Extract version from output (e.g., "minimax 1.0.5")
          const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
          resolve({
            success: true,
            version: versionMatch?.[1],
          });
        } else {
          resolve({
            success: false,
            error: stderr || `Exited with code ${code}`,
          });
        }
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        proc.kill();
        resolve({ success: false, error: 'Timeout waiting for --version' });
      }, 5000);
    });
  }

  override getSetupQuestions(): AgentSetupQuestion[] {
    const baseQuestions = super.getSetupQuestions();
    return [
      ...baseQuestions,
      {
        id: 'model',
        prompt: 'Model to use:',
        type: 'select',
        choices: [
          { value: '', label: 'Default', description: 'Use configured default model' },
          { value: 'MiniMax-M2.1', label: 'MiniMax-M2.1', description: 'Latest MiniMax model' },
          { value: 'MiniMax-M2', label: 'MiniMax-M2', description: 'MiniMax M2 model' },
          { value: 'MiniMax-M1', label: 'MiniMax-M1', description: 'MiniMax M1 model' },
        ],
        default: '',
        required: false,
        help: 'MiniMax model variant to use for this agent',
      },
      {
        id: 'skipPermissions',
        prompt: 'Skip permission prompts?',
        type: 'boolean',
        default: true,
        required: false,
        help: 'Enable autonomous operation without permission prompts',
      },
    ];
  }

  protected buildArgs(
    _prompt: string,
    files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string[] {
    // MiniMax is a wrapper for Claude Code
    // -p for non-interactive output
    // --output-format stream-json for structured JSON output
    // --verbose is required for stream-json format
    const args: string[] = ['-p', '--output-format', 'stream-json', '--verbose'];

    // Add model if specified
    if (this.model) {
      args.push('--model', this.model);
    }

    // Skip permission prompts for autonomous operation
    if (this.skipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    // Add file context if provided
    if (files && files.length > 0) {
      const directories = new Set<string>();

      for (const file of files) {
        const lastSlash = file.path.lastIndexOf('/');
        if (lastSlash > 0) {
          directories.add(file.path.substring(0, lastSlash));
        }
      }

      for (const dir of directories) {
        args.push('--add-dir', dir);
      }
    }

    // NOTE: Prompt is passed via stdin to avoid shell interpretation issues

    return args;
  }

  /**
   * Provide the prompt via stdin instead of command args.
   * This avoids shell interpretation issues with special characters in prompts.
   */
  protected override getStdinInput(
    prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string {
    return prompt;
  }

  /**
   * Override execute to parse MiniMax JSONL output for display.
   * Wraps callbacks to format tool calls and messages from JSONL events.
   */
  override execute(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): AgentExecutionHandle {
    // Wrap callbacks to parse JSONL events
    const parsedOptions: AgentExecuteOptions = {
      ...options,
      onStdout: (options?.onStdout || options?.onStdoutSegments || options?.onJsonlMessage)
        ? (data: string) => {
            // Parse each line for JSONL messages and forward to onJsonlMessage
            if (options?.onJsonlMessage) {
              for (const line of data.split('\n')) {
                const trimmed = line.trim();
                if (trimmed && trimmed.startsWith('{')) {
                  try {
                    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
                    options.onJsonlMessage(parsed);
                  } catch {
                    // Not valid JSON, skip for JSONL callback
                  }
                }
              }
            }

            // Also parse for display events
            const events = parseMiniMaxOutputToEvents(data);
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
          }
        : undefined,
    };

    return super.execute(prompt, files, parsedOptions);
  }

  override async validateSetup(
    answers: Record<string, unknown>
  ): Promise<string | null> {
    // Validate model if provided
    const model = answers.model;
    if (
      model !== undefined &&
      model !== '' &&
      !['MiniMax-M2.1', 'MiniMax-M2', 'MiniMax-M1'].includes(String(model))
    ) {
      return 'Invalid model. Must be one of: MiniMax-M2.1, MiniMax-M2, MiniMax-M1 (or leave empty for default)';
    }

    return null;
  }

  /**
   * Valid model names for the MiniMax agent.
   */
  static readonly VALID_MODELS = ['MiniMax-M2.1', 'MiniMax-M2', 'MiniMax-M1'] as const;

  /**
   * Validate a model name for the MiniMax agent.
   * @param model The model name to validate
   * @returns null if valid, error message if invalid
   */
  override validateModel(model: string): string | null {
    if (model === '' || model === undefined) {
      return null; // Empty is valid (uses default)
    }
    if (!MiniMaxAgentPlugin.VALID_MODELS.includes(model as typeof MiniMaxAgentPlugin.VALID_MODELS[number])) {
      return `Invalid model "${model}". MiniMax agent accepts: ${MiniMaxAgentPlugin.VALID_MODELS.join(', ')}`;
    }
    return null;
  }

  /**
   * Get MiniMax-specific suggestions for preflight failures.
   */
  protected override getPreflightSuggestion(): string {
    return (
      'Common fixes for MiniMax:\n' +
      '  1. Test MiniMax directly: minimax "hello"\n' +
      '  2. Verify your API key: echo $MINIMAX_API_KEY\n' +
      '  3. Check MiniMax is installed: minimax --version\n' +
      '  4. Check your MiniMax configuration in ~/.config/minimax'
    );
  }
}

/**
 * Factory function for the MiniMax agent plugin.
 */
const createMiniMaxAgent: AgentPluginFactory = () => new MiniMaxAgentPlugin();

export default createMiniMaxAgent;
