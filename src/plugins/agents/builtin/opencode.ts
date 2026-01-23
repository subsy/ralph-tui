/**
 * ABOUTME: OpenCode agent plugin for the opencode CLI.
 * Integrates with the OpenCode AI coding assistant for AI-assisted coding.
 * Supports: run mode execution, model selection (provider/model format), file context,
 * agent type selection, timeout, graceful interruption.
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
 * Callbacks for the JSONL streaming buffer.
 */
export interface JsonlBufferCallbacks {
  /** Called when a JSONL message is parsed (for subagent tracing) */
  onJsonlMessage?: (message: Record<string, unknown>) => void;
  /** Called with formatted display events */
  onDisplayEvents?: (events: AgentDisplayEvent[]) => void;
}

/**
 * State object for JSONL streaming buffer.
 * Accumulates partial data and emits complete lines.
 */
export interface JsonlStreamingBuffer {
  /** Push new data into the buffer, processing any complete lines */
  push: (data: string) => void;
  /** Flush any remaining buffered content (call on stream end) */
  flush: () => void;
}

/**
 * Create a streaming buffer for OpenCode JSONL output.
 * Handles partial chunks and emits complete lines for processing.
 *
 * This is exported for testability - the execute() method uses this internally.
 */
export function createOpenCodeJsonlBuffer(
  callbacks: JsonlBufferCallbacks
): JsonlStreamingBuffer {
  let buffer = '';

  const processLine = (line: string): void => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Parse raw JSONL lines and forward to onJsonlMessage for subagent tracing
    if (callbacks.onJsonlMessage && trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        callbacks.onJsonlMessage(parsed);
      } catch {
        // Not valid JSON, skip
      }
    }

    // Process for display events
    const events = parseOpenCodeJsonLine(trimmed);
    if (events.length > 0 && callbacks.onDisplayEvents) {
      callbacks.onDisplayEvents(events);
    }
  };

  return {
    push: (data: string): void => {
      buffer += data;

      // If no newline, wait for more data
      if (!buffer.includes('\n')) return;

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // Keep the last partial line in buffer

      for (const line of lines) {
        processLine(line);
      }
    },

    flush: (): void => {
      // Process any remaining content that didn't end with a newline
      if (buffer.length > 0) {
        processLine(buffer);
        buffer = '';
      }
    },
  };
}

/**
 * Parse opencode JSON line into standardized display events.
 * Returns AgentDisplayEvent[] - the shared processAgentEvents decides what to show.
 *
 * OpenCode event types:
 * - "text": Main text output from the LLM
 * - "tool_use": Tool being called
 * - "tool_result": Tool completed (results)
 * - "step_start"/"step_finish": Step markers
 * - "error": Error from opencode
 */
function parseOpenCodeJsonLine(jsonLine: string): AgentDisplayEvent[] {
  if (!jsonLine || jsonLine.length === 0) return [];

  try {
    const event = JSON.parse(jsonLine);
    const events: AgentDisplayEvent[] = [];

    switch (event.type) {
      case 'text':
        // Main text output from the LLM
        if (event.part?.text) {
          events.push({ type: 'text', content: event.part.text });
        }
        break;

      case 'tool_use': {
        // Tool being called - show name and relevant details
        // opencode structure: event.part.state.input contains tool arguments
        const toolName = event.part?.tool || event.part?.name || 'unknown';
        const toolInput = event.part?.state?.input;
        events.push({ type: 'tool_use', name: toolName, input: toolInput });
        break;
      }

      case 'tool_result': {
        // Tool completed - check for errors in the result
        const resultState = event.part?.state;
        const isError = resultState?.isError === true || resultState?.is_error === true;
        if (isError) {
          const errorMsg = resultState?.error || resultState?.content || 'tool execution failed';
          events.push({ type: 'error', message: errorMsg });
        }
        // Always include tool_result marker (shared logic will skip for display)
        events.push({ type: 'tool_result' });
        break;
      }

      case 'step_start':
      case 'step_finish':
        // Step markers - treat as system events (shared logic will skip)
        events.push({ type: 'system', subtype: event.type });
        break;

      case 'error':
        // Error from opencode
        events.push({ type: 'error', message: event.error?.message || 'Unknown error' });
        break;
    }

    return events;
  } catch {
    // Not valid JSON - might be plugin output like [oh-my-opencode]
    // Pass through non-JSON lines that look like plugin messages as text
    if (jsonLine.startsWith('[') && jsonLine.includes(']')) {
      return [{ type: 'text', content: jsonLine + '\n' }];
    }
    return [];
  }
}

/**
 * OpenCode agent plugin implementation.
 * Uses the `opencode run` command for non-interactive AI coding tasks.
 *
 * Key features:
 * - Auto-detects opencode binary using `which`
 * - Executes in run mode (opencode run) for non-interactive use
 * - Supports --agent flag for agent type selection (general, build, plan)
 * - Model specified in provider/model format (e.g., anthropic/claude-3-5-sonnet)
 * - File attachment via --file flag (can be used multiple times)
 * - Timeout handling with graceful SIGTERM before SIGKILL
 * - Streaming stdout/stderr capture
 * - Filters metadata lines from output (slashcommand, agent warnings)
 */
export class OpenCodeAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'opencode',
    name: 'OpenCode',
    description: 'OpenCode AI coding assistant CLI',
    version: '1.0.0',
    author: 'SST',
    defaultCommand: 'opencode',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: true,
    supportsSubagentTracing: true,
    skillsPaths: {
      personal: '~/.config/opencode/skills',
      repo: '.opencode/skills',
    },
  };

  /** AI provider (any string, validated by OpenCode CLI) */
  private provider?: string;

  /** Model name (without provider prefix) */
  private model?: string;

  /** Model variant (provider-specific reasoning effort: high, max, minimal) */
  private variant?: string;

  /** Agent type to use (general, build, plan) */
  private agent: string = 'general';

  /** Timeout in milliseconds (0 = no timeout) */
  protected override defaultTimeout = 0;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    // Accept any provider string - OpenCode CLI validates provider validity
    if (typeof config.provider === 'string' && config.provider.length > 0) {
      this.provider = config.provider;
    }

    if (typeof config.model === 'string' && config.model.length > 0) {
      this.model = config.model;
    }

    // Accept any variant string - validation is delegated to OpenCode CLI
    // Different models support different variant values (e.g., Gemini: minimal/high/max)
    if (typeof config.variant === 'string' && config.variant.length > 0) {
      this.variant = config.variant;
    }

    if (
      typeof config.agent === 'string' &&
      ['general', 'build', 'plan'].includes(config.agent)
    ) {
      this.agent = config.agent;
    }

    if (typeof config.timeout === 'number' && config.timeout > 0) {
      this.defaultTimeout = config.timeout;
    }
  }

  /**
   * Detect opencode CLI availability.
   * Uses platform-appropriate command (where on Windows, which on Unix).
   */
  override async detect(): Promise<AgentDetectResult> {
    const command = this.commandPath ?? this.meta.defaultCommand;

    // First, try to find the binary in PATH
    const findResult = await findCommandPath(command);

    if (!findResult.found) {
      return {
        available: false,
        error: `OpenCode CLI not found in PATH. Install with: curl -fsSL https://opencode.ai/install | bash`,
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

  override getSandboxRequirements() {
    return {
      // ~/.local/share/opencode contains auth.json with OAuth tokens
      authPaths: ['~/.opencode', '~/.config/opencode', '~/.local/share/opencode'],
      binaryPaths: ['/usr/local/bin', '~/.local/bin', '~/go/bin', '/opt/homebrew/bin'],
      runtimePaths: [],
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
      const useShell = process.platform === 'win32';
      const proc = spawn(useShell ? quoteForWindowsShell(command) : command, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: useShell,
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
          // Extract version from output (e.g., "opencode 1.0.5" or just "1.0.5")
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
        id: 'provider',
        prompt: 'AI provider:',
        type: 'select',
        choices: [
          { value: '', label: 'Default', description: 'Use configured default provider' },
          { value: 'anthropic', label: 'Anthropic', description: 'Claude models' },
          { value: 'openai', label: 'OpenAI', description: 'GPT models' },
          { value: 'google', label: 'Google', description: 'Gemini models' },
          { value: 'xai', label: 'xAI', description: 'Grok models' },
          { value: 'ollama', label: 'Ollama', description: 'Local models via Ollama' },
        ],
        default: '',
        required: false,
        help: 'Which AI provider to use (leave empty for OpenCode default)',
      },
      {
        id: 'model',
        prompt: 'Model name:',
        type: 'text',
        default: '',
        required: false,
        help: 'Model name without provider prefix (e.g., claude-3-5-sonnet, gpt-4o)',
      },
      {
        id: 'agent',
        prompt: 'Agent type:',
        type: 'select',
        choices: [
          { value: 'general', label: 'General', description: 'General-purpose agent (default)' },
          { value: 'build', label: 'Build', description: 'Focused on building code' },
          { value: 'plan', label: 'Plan', description: 'Planning and architecture' },
        ],
        default: 'general',
        required: false,
        help: 'Which agent type to use for task execution',
      },
    ];
  }

  protected buildArgs(
    _prompt: string,
    files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string[] {
    // OpenCode uses: opencode run [flags] [message..]
    const args: string[] = ['run'];

    // Only add agent type if explicitly set to non-default value
    // Omitting --agent lets opencode use its default, avoiding warning messages
    if (this.agent !== 'general') {
      args.push('--agent', this.agent);
    }

    // Add model in provider/model format if both are specified
    const modelToUse = this.buildModelString();
    if (modelToUse) {
      args.push('--model', modelToUse);
    }

    // Add model variant if specified
    if (this.variant) {
      args.push('--variant', this.variant);
    }

    // Always use JSON format for streaming output parsing
    // This gives us structured events (text, tool_use, etc.) that we can format nicely
    args.push('--format', 'json');

    // Add file context if provided (--file can be used multiple times)
    if (files && files.length > 0) {
      for (const file of files) {
        args.push('--file', file.path);
      }
    }

    // NOTE: Prompt is NOT added here - it's passed via stdin to avoid
    // shell interpretation of special characters on Windows where shell: true
    // is required for wrapper script execution.

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
   * Override execute to parse opencode JSON output.
   * Wraps the onStdout/onStdoutSegments callbacks to parse JSONL events and extract displayable content.
   * Also forwards raw JSONL messages to onJsonlMessage for subagent tracing.
   */
  override execute(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): AgentExecutionHandle {
    // Create streaming buffer with callbacks for display and tracing
    const streamingBuffer = createOpenCodeJsonlBuffer({
      onJsonlMessage: options?.onJsonlMessage,
      onDisplayEvents: (events) => {
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
      },
    });

    // Wrap callbacks to parse JSON events
    const parsedOptions: AgentExecuteOptions = {
      ...options,
      onStdout: (options?.onStdout || options?.onStdoutSegments || options?.onJsonlMessage)
        ? (data: string) => streamingBuffer.push(data)
        : undefined,
      // Wrap onEnd to flush any remaining buffered content
      onEnd: (result) => {
        // Flush buffer before calling original onEnd
        streamingBuffer.flush();
        // Call the original onEnd if provided
        options?.onEnd?.(result);
      },
    };

    return super.execute(prompt, files, parsedOptions);
  }

  /**
   * Build the model string in provider/model format.
   * OpenCode expects models like: anthropic/claude-3-5-sonnet, openai/gpt-4o
   */
  private buildModelString(): string | undefined {
    if (this.provider && this.model) {
      return `${this.provider}/${this.model}`;
    }
    if (this.model) {
      // If only model is specified, return it as-is (may include provider already)
      return this.model;
    }
    return undefined;
  }

  override async validateSetup(
    answers: Record<string, unknown>
  ): Promise<string | null> {
    // Validate provider - accept any non-empty string since OpenCode supports 75+ providers
    const provider = answers.provider;
    if (
      provider !== undefined &&
      provider !== '' &&
      typeof provider !== 'string'
    ) {
      return 'Provider must be a string';
    }
    // Provider validation is delegated to OpenCode CLI - it will error if invalid

    // Validate agent type
    const agent = answers.agent;
    if (
      agent !== undefined &&
      agent !== '' &&
      !['general', 'build', 'plan'].includes(String(agent))
    ) {
      return 'Invalid agent type. Must be one of: general, build, plan';
    }

    // Variant validation is delegated to OpenCode CLI - different models support different values

    return null;
  }

  /**
   * Get OpenCode-specific suggestions for preflight failures.
   * Provides actionable guidance for common configuration issues.
   */
  protected override getPreflightSuggestion(): string {
    return (
      'Common fixes for OpenCode:\n' +
      '  1. Test OpenCode directly: opencode run "hello"\n' +
      '  2. Configure a default model in ~/.config/opencode/opencode.json\n' +
      '  3. Verify your API key is set for the chosen provider\n' +
      '  4. Try specifying a model: ralph-tui run --model anthropic/claude-3-5-sonnet'
    );
  }

  /**
    * Validate a model name for the OpenCode agent.
    * Accepts either "provider/model" format or just "model" name.
    * Provider validation is delegated to the OpenCode CLI which supports 75+ providers.
    * @param model The model name to validate
    * @returns null if valid, error message if invalid
    */
  override validateModel(model: string): string | null {
    if (model === '' || model === undefined) {
      return null; // Empty is valid (uses default)
    }

    // Check if model is in provider/model format
    // We accept any provider name since OpenCode CLI validates providers
    // and supports 75+ LLM providers through its AI SDK integration
    if (model.includes('/')) {
      const [provider, modelName] = model.split('/');
      if (!provider || !modelName) {
        return `Invalid model format "${model}". Expected format: provider/model (e.g., anthropic/claude-3-5-sonnet)`;
      }
      // Provider and model name are passed through - OpenCode CLI validates them
    }

    // Model name itself is not validated - let opencode CLI handle it
    return null;
  }
}

/**
 * Factory function for the OpenCode agent plugin.
 */
const createOpenCodeAgent: AgentPluginFactory = () => new OpenCodeAgentPlugin();

export default createOpenCodeAgent;
