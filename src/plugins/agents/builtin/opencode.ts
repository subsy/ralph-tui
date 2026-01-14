/**
 * ABOUTME: OpenCode agent plugin for the opencode CLI.
 * Integrates with the OpenCode AI coding assistant for AI-assisted coding.
 * Supports: run mode execution, model selection (provider/model format), file context,
 * agent type selection, timeout, graceful interruption.
 */

import { spawn } from 'node:child_process';
import { BaseAgentPlugin } from '../base.js';
import type {
  AgentPluginMeta,
  AgentPluginFactory,
  AgentFileContext,
  AgentExecuteOptions,
  AgentSetupQuestion,
  AgentDetectResult,
  AgentExecutionHandle,
} from '../types.js';

/** Supported providers for the model flag */
type OpenCodeProvider = 'anthropic' | 'openai' | 'google' | 'xai' | 'ollama';

/** Output format options */
type OpenCodeFormat = 'default' | 'json';

/**
 * Patterns to match opencode metadata lines that should be filtered from output.
 * These are status/debug lines that aren't part of the actual response.
 */
const OPENCODE_METADATA_PATTERNS = [
  /^[|!]\s+/,                  // Any line starting with "| " or "! " (tool calls, status)
  /^\s*\[\d+\/\d+\]/,          // Progress indicators like "[1/3]"
  /^(Reading|Writing|Creating|Updating|Running)\s+/i,  // Action status lines
  /^\s*\{[\s\S]*"type":\s*"/,  // JSON event objects
  /^\s*\{[\s\S]*"description":\s*"/,  // JSON with description field (background_task)
  /^\s*\{[\s\S]*"path":\s*"/,  // JSON with path field (Glob, Read)
  /^\s*\{[\s\S]*"pattern":\s*"/,  // JSON with pattern field (grep)
  /^[^\s]+\.(md|ts|tsx|js|json):\s*["{[]/,  // Grep-style output: filepath: JSON/string
  /^skills\//,                 // Skills directory paths
];

/**
 * Check if a line matches any metadata pattern.
 */
function isMetadataLine(line: string): boolean {
  // Strip ANSI escape codes for pattern matching
  const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, '');
  return OPENCODE_METADATA_PATTERNS.some((pattern) => pattern.test(cleanLine));
}

/**
 * Filter opencode metadata lines from output.
 * Returns the text with metadata lines removed.
 */
function filterOpenCodeMetadata(text: string): string {
  return text
    .split('\n')
    .filter((line) => !isMetadataLine(line))
    .join('\n');
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
    supportsSubagentTracing: false,
  };

  /** AI provider (anthropic, openai, google, xai, ollama) */
  private provider?: OpenCodeProvider;

  /** Model name (without provider prefix) */
  private model?: string;

  /** Agent type to use (general, build, plan) */
  private agent: string = 'general';

  /** Output format (default or json) */
  private format: OpenCodeFormat = 'default';

  /** Timeout in milliseconds (0 = no timeout) */
  protected override defaultTimeout = 0;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (
      typeof config.provider === 'string' &&
      ['anthropic', 'openai', 'google', 'xai', 'ollama'].includes(config.provider)
    ) {
      this.provider = config.provider as OpenCodeProvider;
    }

    if (typeof config.model === 'string' && config.model.length > 0) {
      this.model = config.model;
    }

    if (
      typeof config.agent === 'string' &&
      ['general', 'build', 'plan'].includes(config.agent)
    ) {
      this.agent = config.agent;
    }

    if (
      typeof config.format === 'string' &&
      ['default', 'json'].includes(config.format)
    ) {
      this.format = config.format as OpenCodeFormat;
    }

    if (typeof config.timeout === 'number' && config.timeout > 0) {
      this.defaultTimeout = config.timeout;
    }
  }

  /**
   * Detect opencode CLI availability using `which` command.
   * Falls back to testing direct execution if `which` is not available.
   */
  override async detect(): Promise<AgentDetectResult> {
    const command = this.commandPath ?? this.meta.defaultCommand;

    // First, try to find the binary using `which`
    const whichResult = await this.runWhich(command);

    if (!whichResult.found) {
      return {
        available: false,
        error: `OpenCode CLI not found in PATH. Install with: curl -fsSL https://opencode.ai/install | bash`,
      };
    }

    // Verify the binary works by running --version
    const versionResult = await this.runVersion(whichResult.path);

    if (!versionResult.success) {
      return {
        available: false,
        executablePath: whichResult.path,
        error: versionResult.error,
      };
    }

    return {
      available: true,
      version: versionResult.version,
      executablePath: whichResult.path,
    };
  }

  /**
   * Run `which` command to find binary path
   */
  private runWhich(command: string): Promise<{ found: boolean; path: string }> {
    return new Promise((resolve) => {
      const proc = spawn('which', [command], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.on('error', () => {
        resolve({ found: false, path: '' });
      });

      proc.on('close', (code) => {
        if (code === 0 && stdout.trim()) {
          resolve({ found: true, path: stdout.trim() });
        } else {
          resolve({ found: false, path: '' });
        }
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        proc.kill();
        resolve({ found: false, path: '' });
      }, 5000);
    });
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
      {
        id: 'format',
        prompt: 'Output format:',
        type: 'select',
        choices: [
          { value: 'default', label: 'Default', description: 'Formatted text output' },
          { value: 'json', label: 'JSON', description: 'Raw JSON events for parsing' },
        ],
        default: 'default',
        required: false,
        help: 'How OpenCode should format its output',
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

    // Add output format if not default
    if (this.format === 'json') {
      args.push('--format', 'json');
    }

    // Add file context if provided (--file can be used multiple times)
    if (files && files.length > 0) {
      for (const file of files) {
        args.push('--file', file.path);
      }
    }

    // NOTE: Prompt is NOT added here - it's passed via stdin to avoid
    // shell interpretation of special characters (markdown bullets, etc.)

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
   * Override execute to filter opencode metadata from stdout.
   * Wraps the onStdout callback to remove status lines like "|  slashcommand {...}".
   */
  override execute(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): AgentExecutionHandle {
    // Wrap onStdout to filter metadata lines
    const filteredOptions: AgentExecuteOptions = {
      ...options,
      onStdout: options?.onStdout
        ? (data: string) => {
            const filtered = filterOpenCodeMetadata(data);
            if (filtered.trim()) {
              options.onStdout!(filtered);
            }
          }
        : undefined,
    };

    return super.execute(prompt, files, filteredOptions);
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
    // Validate provider
    const provider = answers.provider;
    if (
      provider !== undefined &&
      provider !== '' &&
      !['anthropic', 'openai', 'google', 'xai', 'ollama'].includes(String(provider))
    ) {
      return 'Invalid provider. Must be one of: anthropic, openai, google, xai, ollama';
    }

    // Validate agent type
    const agent = answers.agent;
    if (
      agent !== undefined &&
      agent !== '' &&
      !['general', 'build', 'plan'].includes(String(agent))
    ) {
      return 'Invalid agent type. Must be one of: general, build, plan';
    }

    // Validate format
    const format = answers.format;
    if (
      format !== undefined &&
      format !== '' &&
      !['default', 'json'].includes(String(format))
    ) {
      return 'Invalid format. Must be one of: default, json';
    }

    return null;
  }

  /**
   * Valid providers for the OpenCode agent.
   */
  static readonly VALID_PROVIDERS = ['anthropic', 'openai', 'google', 'xai', 'ollama'] as const;

  /**
   * Validate a model name for the OpenCode agent.
   * Accepts either "provider/model" format or just "model".
   * Validates the provider if specified, but model names are passed through
   * since they vary by provider and change frequently.
   * @param model The model name to validate
   * @returns null if valid, error message if invalid
   */
  override validateModel(model: string): string | null {
    if (model === '' || model === undefined) {
      return null; // Empty is valid (uses default)
    }

    // Check if model is in provider/model format
    if (model.includes('/')) {
      const [provider] = model.split('/');
      if (!OpenCodeAgentPlugin.VALID_PROVIDERS.includes(provider as typeof OpenCodeAgentPlugin.VALID_PROVIDERS[number])) {
        return `Invalid provider "${provider}" in model "${model}". Valid providers: ${OpenCodeAgentPlugin.VALID_PROVIDERS.join(', ')}`;
      }
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
