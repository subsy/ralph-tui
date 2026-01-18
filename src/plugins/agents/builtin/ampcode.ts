/**
 * ABOUTME: Ampcode agent plugin for the amp CLI.
 * Integrates with Ampcode AI coding assistant for AI-assisted coding.
 * Supports: execute mode, model selection, dangerously-allow-all mode,
 * stream-json output, timeout, and graceful interruption.
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
 * Represents a parsed JSONL message from Ampcode output.
 * Ampcode emits Claude Code-compatible stream JSON format.
 */
export interface AmpcodeJsonlMessage {
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
  /** Session ID for conversation tracking */
  sessionId?: string;
  /** Raw parsed JSON for custom handling */
  raw: Record<string, unknown>;
}

/**
 * Result of parsing a JSONL line.
 */
export type JsonlParseResult =
  | { success: true; message: AmpcodeJsonlMessage }
  | { success: false; raw: string; error: string };

/**
 * Ampcode agent plugin implementation.
 * Uses the `amp` CLI to execute AI coding tasks.
 *
 * Key features:
 * - Auto-detects amp binary using `which`
 * - Executes in execute mode (-x) for non-interactive use
 * - Supports --dangerously-allow-all for autonomous operation
 * - Configurable mode selection (free, rush, smart)
 * - Stream JSON output for structured responses
 * - Timeout handling with graceful SIGINT before SIGTERM
 * - Streaming stdout/stderr capture
 */
export class AmpcodeAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'ampcode',
    name: 'Ampcode',
    description: 'Ampcode AI coding assistant CLI',
    version: '1.0.0',
    author: 'Amp',
    defaultCommand: 'amp',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false, // amp doesn't have explicit file context flags
    supportsSubagentTracing: true,
    structuredOutputFormat: 'jsonl',
  };

  /** Output mode: text or stream-json */
  private streamJson = false;

  /** Agent mode: free, rush, smart */
  private mode?: string;

  /** Allow all tool executions without confirmation (default: false for security) */
  private dangerouslyAllowAll = false;

  /** Timeout in milliseconds (0 = no timeout) */
  protected override defaultTimeout = 0;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (typeof config.streamJson === 'boolean') {
      this.streamJson = config.streamJson;
    }

    if (
      typeof config.mode === 'string' &&
      ['free', 'rush', 'smart'].includes(config.mode)
    ) {
      this.mode = config.mode;
    }

    if (typeof config.dangerouslyAllowAll === 'boolean') {
      this.dangerouslyAllowAll = config.dangerouslyAllowAll;
    }

    if (typeof config.timeout === 'number' && config.timeout > 0) {
      this.defaultTimeout = config.timeout;
    }
  }

  /**
   * Detect amp CLI availability.
   */
  override async detect(): Promise<AgentDetectResult> {
    const command = this.commandPath ?? this.meta.defaultCommand;

    const findResult = await findCommandPath(command);

    if (!findResult.found) {
      return {
        available: false,
        error: `Ampcode CLI not found in PATH. Install from: https://ampcode.com`,
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
          // Extract version from output
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
        id: 'mode',
        prompt: 'Agent mode:',
        type: 'select',
        choices: [
          { value: 'smart', label: 'Smart', description: 'Balanced mode (default)' },
          { value: 'free', label: 'Free', description: 'More creative, less constrained' },
          { value: 'rush', label: 'Rush', description: 'Faster, more direct responses' },
        ],
        default: 'smart',
        required: false,
        help: 'Controls the model, system prompt, and tool selection',
      },
      {
        id: 'streamJson',
        prompt: 'Use stream JSON output?',
        type: 'boolean',
        default: false,
        required: false,
        help: 'Output in Claude Code-compatible stream JSON format',
      },
      {
        id: 'dangerouslyAllowAll',
        prompt: '⚠️  Allow all tool executions without confirmation (autonomous mode)?',
        type: 'boolean',
        default: false,
        required: false,
        help: 'Enable --dangerously-allow-all for autonomous operation. Warning: This bypasses all safety prompts.',
      },
    ];
  }

  protected buildArgs(
    _prompt: string,
    _files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): string[] {
    const args: string[] = [];

    // Use execute mode for non-interactive
    args.push('--execute');

    // Add stream-json output if needed for subagent tracing
    if (options?.subagentTracing || this.streamJson) {
      args.push('--stream-json');
    }

    // Add mode if specified
    if (this.mode) {
      args.push('--mode', this.mode);
    }

    // Allow all tool executions for autonomous operation
    if (this.dangerouslyAllowAll) {
      args.push('--dangerously-allow-all');
    }

    // Disable notifications in execute mode
    args.push('--no-notifications');

    // NOTE: Prompt is NOT added here - it's passed via stdin

    return args;
  }

  /**
   * Provide the prompt via stdin instead of command args.
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
    // Validate mode
    const mode = answers.mode;
    if (
      mode !== undefined &&
      mode !== '' &&
      !['free', 'rush', 'smart'].includes(String(mode))
    ) {
      return 'Invalid mode. Must be one of: free, rush, smart';
    }

    return null;
  }

  /**
   * Validate a model name for the Ampcode agent.
   */
  override validateModel(_model: string): string | null {
    // Ampcode handles model selection via mode, not explicit model names
    return null;
  }

  /**
   * Parse a single line of JSONL output from Ampcode.
   */
  static parseJsonlLine(line: string): JsonlParseResult {
    const trimmed = line.trim();

    if (!trimmed) {
      return { success: false, raw: line, error: 'Empty line' };
    }

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;

      const message: AmpcodeJsonlMessage = {
        raw: parsed,
      };

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

      return { success: true, message };
    } catch (err) {
      return {
        success: false,
        raw: line,
        error: err instanceof Error ? err.message : 'Parse error',
      };
    }
  }

  /**
   * Parse complete JSONL output from Ampcode.
   */
  static parseJsonlOutput(output: string): {
    messages: AmpcodeJsonlMessage[];
    fallback: string[];
  } {
    const messages: AmpcodeJsonlMessage[] = [];
    const fallback: string[] = [];

    const lines = output.split('\n');

    for (const line of lines) {
      const result = AmpcodeAgentPlugin.parseJsonlLine(line);
      if (result.success) {
        messages.push(result.message);
      } else if (result.raw.trim()) {
        fallback.push(result.raw);
      }
    }

    return { messages, fallback };
  }

  /**
   * Create a streaming JSONL parser.
   */
  static createStreamingJsonlParser(): {
    push: (chunk: string) => JsonlParseResult[];
    flush: () => JsonlParseResult[];
    getState: () => { messages: AmpcodeJsonlMessage[]; fallback: string[] };
  } {
    let buffer = '';
    const messages: AmpcodeJsonlMessage[] = [];
    const fallback: string[] = [];

    return {
      push(chunk: string): JsonlParseResult[] {
        buffer += chunk;
        const results: JsonlParseResult[] = [];

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          const result = AmpcodeAgentPlugin.parseJsonlLine(line);
          results.push(result);

          if (result.success) {
            messages.push(result.message);
          } else if (result.raw.trim()) {
            fallback.push(result.raw);
          }
        }

        return results;
      },

      flush(): JsonlParseResult[] {
        if (!buffer.trim()) {
          buffer = '';
          return [];
        }

        const result = AmpcodeAgentPlugin.parseJsonlLine(buffer);
        buffer = '';

        if (result.success) {
          messages.push(result.message);
        } else if (result.raw.trim()) {
          fallback.push(result.raw);
        }

        return [result];
      },

      getState(): { messages: AmpcodeJsonlMessage[]; fallback: string[] } {
        return { messages, fallback };
      },
    };
  }
}

/**
 * Factory function for the Ampcode agent plugin.
 */
const createAmpcodeAgent: AgentPluginFactory = () => new AmpcodeAgentPlugin();

export default createAmpcodeAgent;
