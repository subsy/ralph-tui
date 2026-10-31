/**
 * ABOUTME: Ampcode agent plugin for the amp CLI.
 * Integrates with Ampcode AI coding assistant for AI-assisted coding.
 * Supports: execute mode, mode selection, legacy dangerously-allow-all flag,
 * stream-json output, timeout, and graceful interruption.
 */

import { execFile } from 'node:child_process';
import { BaseAgentPlugin, quoteForWindowsShell, shouldUseWindowsShell } from '../base.js';
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

// Completion regexes accept whitespace inside tags, so boundaries must not be whitespace.
const COMPLETION_BOUNDARY = '\0';

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
 * - Configurable mode selection, including custom Amp modes
 * - Stream JSON output for structured responses
 * - Timeout and interruption handling through the shared agent lifecycle
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
  private streamJson = true;

  /** Agent mode; omitted to use the installed CLI's default */
  private mode?: string;

  /** Legacy permission bypass flag; false does not restrict modern Amp's tools */
  private dangerouslyAllowAll = false;

  /** Timeout in milliseconds (0 = no timeout) */
  protected override defaultTimeout = 0;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (typeof config.streamJson === 'boolean') {
      this.streamJson = config.streamJson;
    }

    if (typeof config.mode === 'string' && config.mode.trim()) {
      this.mode = config.mode.trim();
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
    const resolved = await this.resolveCommandPath();

    if (!resolved) {
      return {
        available: false,
        error: `Ampcode CLI not found in PATH. Install from: https://ampcode.com`,
      };
    }
    const command = resolved.executablePath;

    // Verify the binary works by running --version
    const versionResult = await this.runVersion(command);

    if (!versionResult.success) {
      return {
        available: false,
        executablePath: command,
        error: versionResult.error,
      };
    }

    this.commandPath = command;
    return {
      available: true,
      version: versionResult.version,
      executablePath: command,
    };
  }

  override getSandboxRequirements() {
    return {
      authPaths: ['~/.config/amp', '~/.local/share/amp'],
      binaryPaths: ['/usr/local/bin', '~/.local/bin'],
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
      const shell = shouldUseWindowsShell(command);
      const executable = shell ? quoteForWindowsShell(command) : command;
      execFile(executable, ['--version'], { shell, timeout: 5000, killSignal: 'SIGKILL' }, (error, stdout, stderr) => {
        if (error) {
          resolve({
            success: false,
            error: error.killed ? 'Timeout waiting for --version' : stderr || `Failed to execute: ${error.message}`,
          });
          return;
        }

        // Extract version from output
        const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
        resolve({
          success: true,
          version: versionMatch?.[1],
        });
      });
    });
  }

  override getSetupQuestions(): AgentSetupQuestion[] {
    const baseQuestions = super.getSetupQuestions();
    return [
      ...baseQuestions,
      {
        id: 'mode',
        prompt: 'Agent mode:',
        type: 'text',
        default: '',
        required: false,
        help: 'Leave empty for the CLI default. Amp supports low, medium, high, ultra, claude-code, and custom modes; older versions may use other names.',
      },
      {
        id: 'streamJson',
        prompt: 'Use stream JSON output?',
        type: 'boolean',
        default: true,
        required: false,
        help: 'Output in Claude Code-compatible stream JSON format',
      },
      {
        id: 'dangerouslyAllowAll',
        prompt: 'Pass the legacy --dangerously-allow-all flag?',
        type: 'boolean',
        default: false,
        required: false,
        help: 'For older Amp versions only. Modern Amp runs tools without approval by default even when this is false. Use isolation or an Amp policy plugin to restrict tools.',
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

    // Retain the opt-in bypass for Amp versions that support this legacy flag.
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

  override execute(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): AgentExecutionHandle {
    if (!this.streamJson && !options?.subagentTracing) {
      return super.execute(prompt, files, options);
    }

    const parser = AmpcodeAgentPlugin.createStreamingJsonlParser(false);
    let streamedError: string | undefined;
    const emit = (results: JsonlParseResult[]) => {
      for (const result of results) {
        if (result.success) {
          // The base stdout tail can discard an earlier explicit failure.
          if (streamedError === undefined && AmpcodeAgentPlugin.isErrorResult(result.message.raw)) {
            streamedError = AmpcodeAgentPlugin.errorMessage(result.message.raw);
          }
          options?.onJsonlMessage?.(result.message.raw);
        }
        const events = result.success
          ? AmpcodeAgentPlugin.toDisplayEvents(result.message.raw)
          : result.raw.trim() ? [{ type: 'text' as const, content: result.raw }] : [];
        if (events.length) {
          options?.onStdout?.(processAgentEvents(events));
          options?.onStdoutSegments?.(processAgentEventsToSegments(events));
        }
      }
    };

    return super.execute(prompt, files, {
      ...options,
      onStdoutSegments: undefined,
      onStdout: (chunk) => emit(parser.push(chunk)),
      onEnd: (result) => {
        const parsed = AmpcodeAgentPlugin.parseJsonlOutput(result.stdout);
        const failure = parsed.messages.find(({ raw }) => AmpcodeAgentPlugin.isErrorResult(raw));
        const error = streamedError ?? (failure && AmpcodeAgentPlugin.errorMessage(failure.raw));
        // The engine scans stdout for completion: never expose tool input, hidden
        // content, or malformed protocol lines as assistant narrative.
        if (error !== undefined && result.status === 'completed') {
          result.status = 'failed';
          result.error = error;
        }
        result.stdout = result.status === 'completed'
          ? parsed.messages.map(({ raw }) => AmpcodeAgentPlugin.completionText(raw)).join(COMPLETION_BOUNDARY)
          : '';
        try {
          emit(parser.flush());
        } finally {
          options?.onEnd?.(result);
        }
      },
    });
  }

  private static contentBlocks(raw: Record<string, unknown>): Record<string, unknown>[] {
    const message = raw.message;
    if (!message || typeof message !== 'object' || Array.isArray(message)) return [];
    const content = (message as Record<string, unknown>).content;
    return Array.isArray(content)
      ? content.map((block) => block && typeof block === 'object' && !Array.isArray(block) ? block as Record<string, unknown> : {})
      : [];
  }

  private static completionText(raw: Record<string, unknown>): string {
    if (raw.parent_tool_use_id) return '';
    if (raw.type === 'assistant') {
      return AmpcodeAgentPlugin.contentBlocks(raw)
        .map((block) => block.type === 'text' && typeof block.text === 'string' ? block.text : COMPLETION_BOUNDARY)
        .join('');
    }
    if (raw.type === 'result' && raw.is_error !== true && raw.subtype === 'success' && typeof raw.result === 'string') {
      return raw.result;
    }
    return '';
  }

  private static isErrorResult(raw: Record<string, unknown>): boolean {
    return raw.type === 'result' && (raw.is_error === true ||
      typeof raw.subtype === 'string' && (raw.subtype === 'error' || raw.subtype.startsWith('error_')));
  }

  private static errorMessage(raw: Record<string, unknown>): string {
    if (typeof raw.error === 'string') return raw.error;
    return typeof raw.result === 'string' ? raw.result : 'Amp execute failed';
  }

  private static toDisplayEvents(raw: Record<string, unknown>): AgentDisplayEvent[] {
    if (AmpcodeAgentPlugin.isErrorResult(raw)) {
      return [{ type: 'error', message: AmpcodeAgentPlugin.errorMessage(raw) }];
    }
    const events: AgentDisplayEvent[] = [];
    if (raw.type === 'assistant') {
      for (const block of AmpcodeAgentPlugin.contentBlocks(raw)) {
        if (block.type === 'text' && typeof block.text === 'string') {
          events.push({ type: 'text', content: block.text });
        } else if (block.type === 'tool_use' && typeof block.name === 'string') {
          const input = block.input;
          events.push({
            type: 'tool_use',
            name: block.name,
            input: input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : undefined,
          });
        }
      }
    }
    return events;
  }

  override async validateSetup(
    answers: Record<string, unknown>
  ): Promise<string | null> {
    if (answers.mode !== undefined && typeof answers.mode !== 'string') {
      return 'Mode must be a string supported by your installed Amp CLI';
    }

    return null;
  }

  /**
   * Validate a model name for the Ampcode agent.
   */
  override validateModel(_model: string): string | null {
    return _model ? 'Amp selects models via agentOptions.mode, not --model' : null;
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
      const value: unknown = JSON.parse(trimmed);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { success: false, raw: line, error: 'Expected a JSON object' };
      }
      const parsed = value as Record<string, unknown>;

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
      } else if (typeof parsed.session_id === 'string') {
        message.sessionId = parsed.session_id;
      }
      if (parsed.result !== undefined) {
        message.result = parsed.result;
      }

      if (parsed.tool && typeof parsed.tool === 'object' && !Array.isArray(parsed.tool)) {
        const toolObj = parsed.tool as Record<string, unknown>;
        message.tool = {
          name: typeof toolObj.name === 'string' ? toolObj.name : undefined,
          input:
            toolObj.input && typeof toolObj.input === 'object' && !Array.isArray(toolObj.input)
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
  static createStreamingJsonlParser(retainHistory = true): {
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

          if (retainHistory && result.success) {
            messages.push(result.message);
          } else if (retainHistory && !result.success && result.raw.trim()) {
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

          if (retainHistory && result.success) {
            messages.push(result.message);
          } else if (retainHistory && !result.success && result.raw.trim()) {
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
