/**
 * ABOUTME: Codex agent plugin for the codex CLI.
 * Integrates with OpenAI's Codex CLI for AI-assisted coding.
 * Supports: exec mode execution, model selection, file context, timeout, graceful interruption,
 * and JSONL output parsing for subagent tracing.
 */

import { spawn } from 'node:child_process';
import { BaseAgentPlugin, findCommandPath } from '../base.js';
import type {
  AgentPluginMeta,
  AgentPluginFactory,
  AgentFileContext,
  AgentExecuteOptions,
  AgentSetupQuestion,
  AgentDetectResult,
} from '../types.js';

/**
 * Represents a parsed JSONL message from Codex output.
 * Codex emits various event types as JSON objects, one per line.
 */
export interface CodexJsonlMessage {
  /** The type of message */
  type?: string;
  /** Message content for text messages */
  message?: string;
  /** Tool use information if applicable */
  tool?: {
    name?: string;
    input?: Record<string, unknown>;
  };
  /** Result data for completion messages */
  result?: unknown;
  /** Cost information if provided */
  cost?: {
    inputTokens?: number;
    outputTokens?: number;
    totalUSD?: number;
  };
  /** Session ID for conversation tracking */
  sessionId?: string;
  /** Raw parsed JSON for custom handling */
  raw: Record<string, unknown>;
}

/**
 * Result of parsing a JSONL line.
 * Success contains the parsed message, failure contains the raw text.
 */
export type JsonlParseResult =
  | { success: true; message: CodexJsonlMessage }
  | { success: false; raw: string; error: string };

/**
 * Codex agent plugin implementation.
 * Uses the `codex` CLI to execute AI coding tasks.
 *
 * Key features:
 * - Auto-detects codex binary using `which`
 * - Executes in exec mode for non-interactive use
 * - Supports --dangerously-bypass-approvals-and-sandbox for autonomous operation
 * - Configurable model selection via -m/--model flag
 * - Timeout handling with graceful SIGINT before SIGTERM
 * - Streaming stdout/stderr capture
 */
export class CodexAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'codex',
    name: 'Codex',
    description: 'OpenAI Codex CLI for AI-assisted coding',
    version: '1.0.0',
    author: 'OpenAI',
    defaultCommand: 'codex',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: true,
    supportsSubagentTracing: true,
    structuredOutputFormat: 'jsonl',
  };

  /** Output mode: text or json */
  private outputMode: 'text' | 'json' = 'text';

  /** Model to use (e.g., 'o3', 'o4-mini', 'gpt-4.1') */
  private model?: string;

  /** Skip approval prompts and sandbox for autonomous operation (requires explicit opt-in) */
  private bypassApprovals = false;

  /** Sandbox mode: read-only, workspace-write, danger-full-access */
  private sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access' = 'workspace-write';

  /** Timeout in milliseconds (0 = no timeout) */
  protected override defaultTimeout = 0;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (
      typeof config.outputMode === 'string' &&
      ['text', 'json'].includes(config.outputMode)
    ) {
      this.outputMode = config.outputMode as 'text' | 'json';
    }

    if (typeof config.model === 'string' && config.model.length > 0) {
      this.model = config.model;
    }

    if (typeof config.bypassApprovals === 'boolean') {
      this.bypassApprovals = config.bypassApprovals;
    }

    if (
      typeof config.sandboxMode === 'string' &&
      ['read-only', 'workspace-write', 'danger-full-access'].includes(config.sandboxMode)
    ) {
      this.sandboxMode = config.sandboxMode as typeof this.sandboxMode;
    }

    if (typeof config.timeout === 'number' && config.timeout > 0) {
      this.defaultTimeout = config.timeout;
    }
  }

  /**
   * Detect codex CLI availability.
   * Uses platform-appropriate command (where on Windows, which on Unix).
   */
  override async detect(): Promise<AgentDetectResult> {
    const command = this.commandPath ?? this.meta.defaultCommand;

    // First, try to find the binary in PATH
    const findResult = await findCommandPath(command);

    if (!findResult.found) {
      return {
        available: false,
        error: `Codex CLI not found in PATH. Install from: https://github.com/openai/codex`,
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
          // Extract version from output (e.g., "codex 0.1.2025012400")
          const versionMatch = stdout.match(/(\d+\.\d+\.\d+|\d+\.\d+\.\d{10})/);
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
        id: 'outputMode',
        prompt: 'Output mode:',
        type: 'select',
        choices: [
          {
            value: 'text',
            label: 'Text',
            description: 'Plain text output (default)',
          },
          { value: 'json', label: 'JSON', description: 'JSONL structured output' },
        ],
        default: 'text',
        required: false,
        help: 'How Codex should output its responses',
      },
      {
        id: 'model',
        prompt: 'Model to use:',
        type: 'text',
        default: '',
        required: false,
        help: 'Model to use (e.g., o3, o4-mini, gpt-4.1). Leave empty for default.',
      },
      {
        id: 'sandboxMode',
        prompt: 'Sandbox mode:',
        type: 'select',
        choices: [
          { value: 'read-only', label: 'Read Only', description: 'Can only read files' },
          { value: 'workspace-write', label: 'Workspace Write', description: 'Can write to workspace (default)' },
          { value: 'danger-full-access', label: 'Full Access', description: 'No sandbox restrictions (dangerous)' },
        ],
        default: 'workspace-write',
        required: false,
        help: 'Sandbox policy for shell command execution',
      },
      {
        id: 'bypassApprovals',
        prompt: 'Bypass approval prompts? (⚠️ enables autonomous operation)',
        type: 'boolean',
        default: false,
        required: false,
        help: 'Enable --dangerously-bypass-approvals-and-sandbox for fully autonomous operation. Only enable if you trust the model output.',
      },
    ];
  }

  protected buildArgs(
    _prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): string[] {
    const args: string[] = [];

    // Use exec subcommand for non-interactive mode
    args.push('exec');

    // Add JSONL output flag if needed for subagent tracing
    if (options?.subagentTracing || this.outputMode === 'json') {
      args.push('--json');
    }

    // Add model if specified
    const modelToUse = this.model;
    if (modelToUse) {
      args.push('-m', modelToUse);
    }

    // Add sandbox mode
    args.push('--sandbox', this.sandboxMode);

    // Bypass approval prompts for autonomous operation
    if (this.bypassApprovals) {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    }

    // Add directory context if files provided
    if (files && files.length > 0) {
      const directories = new Set<string>();

      for (const file of files) {
        // Extract directory from file path for --add-dir
        const lastSlash = file.path.lastIndexOf('/');
        if (lastSlash > 0) {
          directories.add(file.path.substring(0, lastSlash));
        }
      }

      // Add unique directories
      for (const dir of directories) {
        args.push('--add-dir', dir);
      }
    }

    // NOTE: Prompt is NOT added here - it's passed via stdin to avoid
    // shell interpretation of special characters

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

  override async validateSetup(
    answers: Record<string, unknown>
  ): Promise<string | null> {
    // Validate output mode
    const outputMode = answers.outputMode;
    if (
      outputMode !== undefined &&
      outputMode !== '' &&
      !['text', 'json'].includes(String(outputMode))
    ) {
      return 'Invalid output mode. Must be one of: text, json';
    }

    // Validate sandbox mode
    const sandboxMode = answers.sandboxMode;
    if (
      sandboxMode !== undefined &&
      sandboxMode !== '' &&
      !['read-only', 'workspace-write', 'danger-full-access'].includes(String(sandboxMode))
    ) {
      return 'Invalid sandbox mode. Must be one of: read-only, workspace-write, danger-full-access';
    }

    return null;
  }

  /**
   * Validate a model name for the Codex agent.
   * Codex accepts various model names, so we're permissive here.
   * @param model The model name to validate
   * @returns null if valid (always valid for Codex)
   */
  override validateModel(_model: string): string | null {
    // Codex accepts many model names, so we don't restrict
    return null;
  }

  /**
   * Parse a single line of JSONL output from Codex.
   * Attempts to parse as JSON, falls back to raw text on failure.
   *
   * @param line A single line of output (may include newline characters)
   * @returns Parse result with either the parsed message or raw text
   */
  static parseJsonlLine(line: string): JsonlParseResult {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      return { success: false, raw: line, error: 'Empty line' };
    }

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;

      // Build the structured message from parsed JSON
      const message: CodexJsonlMessage = {
        raw: parsed,
      };

      // Extract common fields if present
      if (typeof parsed.type === 'string') {
        message.type = parsed.type;
      }
      if (typeof parsed.message === 'string') {
        message.message = parsed.message;
      }
      if (typeof parsed.sessionId === 'string') {
        message.sessionId = parsed.sessionId;
      }
      if (parsed.result !== undefined) {
        message.result = parsed.result;
      }

      // Extract tool information if present
      if (parsed.tool && typeof parsed.tool === 'object') {
        const toolObj = parsed.tool as Record<string, unknown>;
        message.tool = {
          name: typeof toolObj.name === 'string' ? toolObj.name : undefined,
          input:
            toolObj.input && typeof toolObj.input === 'object'
              ? (toolObj.input as Record<string, unknown>)
              : undefined,
        };
      }

      // Extract cost information if present
      if (parsed.cost && typeof parsed.cost === 'object') {
        const costObj = parsed.cost as Record<string, unknown>;
        message.cost = {
          inputTokens:
            typeof costObj.inputTokens === 'number'
              ? costObj.inputTokens
              : undefined,
          outputTokens:
            typeof costObj.outputTokens === 'number'
              ? costObj.outputTokens
              : undefined,
          totalUSD:
            typeof costObj.totalUSD === 'number' ? costObj.totalUSD : undefined,
        };
      }

      return { success: true, message };
    } catch (err) {
      // JSON parsing failed - return as raw text
      return {
        success: false,
        raw: line,
        error: err instanceof Error ? err.message : 'Parse error',
      };
    }
  }

  /**
   * Parse a complete JSONL output string from Codex.
   * Handles multi-line output, parsing each line independently.
   * Lines that fail to parse are returned as raw text in the fallback array.
   *
   * @param output Complete output string (may contain multiple lines)
   * @returns Object with parsed messages and any raw fallback lines
   */
  static parseJsonlOutput(output: string): {
    messages: CodexJsonlMessage[];
    fallback: string[];
  } {
    const messages: CodexJsonlMessage[] = [];
    const fallback: string[] = [];

    const lines = output.split('\n');

    for (const line of lines) {
      const result = CodexAgentPlugin.parseJsonlLine(line);
      if (result.success) {
        messages.push(result.message);
      } else if (result.raw.trim()) {
        // Only add non-empty lines to fallback
        fallback.push(result.raw);
      }
    }

    return { messages, fallback };
  }

  /**
   * Create a streaming JSONL parser that accumulates partial lines.
   * Use this for processing streaming output where data chunks may
   * split across line boundaries.
   *
   * @returns Parser object with push() method and getState() to retrieve results
   */
  static createStreamingJsonlParser(): {
    push: (chunk: string) => JsonlParseResult[];
    flush: () => JsonlParseResult[];
    getState: () => { messages: CodexJsonlMessage[]; fallback: string[] };
  } {
    let buffer = '';
    const messages: CodexJsonlMessage[] = [];
    const fallback: string[] = [];

    return {
      /**
       * Push a chunk of data to the parser.
       * Returns any complete lines that were parsed.
       */
      push(chunk: string): JsonlParseResult[] {
        buffer += chunk;
        const results: JsonlParseResult[] = [];

        // Process complete lines (ending with newline)
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          const result = CodexAgentPlugin.parseJsonlLine(line);
          results.push(result);

          if (result.success) {
            messages.push(result.message);
          } else if (result.raw.trim()) {
            fallback.push(result.raw);
          }
        }

        return results;
      },

      /**
       * Flush any remaining buffered content.
       * Call this when the stream ends to process any trailing content.
       */
      flush(): JsonlParseResult[] {
        if (!buffer.trim()) {
          buffer = '';
          return [];
        }

        const result = CodexAgentPlugin.parseJsonlLine(buffer);
        buffer = '';

        if (result.success) {
          messages.push(result.message);
        } else if (result.raw.trim()) {
          fallback.push(result.raw);
        }

        return [result];
      },

      /**
       * Get the current accumulated state.
       */
      getState(): { messages: CodexJsonlMessage[]; fallback: string[] } {
        return { messages, fallback };
      },
    };
  }
}

/**
 * Factory function for the Codex agent plugin.
 */
const createCodexAgent: AgentPluginFactory = () => new CodexAgentPlugin();

export default createCodexAgent;
