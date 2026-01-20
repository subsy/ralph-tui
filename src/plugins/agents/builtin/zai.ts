/**
 * ABOUTME: Zai agent plugin for the Zai CLI.
 * Integrates with Zai AI for coding assistance.
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
 * Parse Zai stream-json output into standardized display events.
 * Zai (Claude Code) outputs JSON lines when using --output-format stream-json --verbose
 *
 * Event types:
 * - {"type":"assistant","message":{...}} - Assistant response with content
 * - {"type":"result",...} - Final result with result field
 * - {"type":"system","subtype":"init",...} - Initialization (skip for display)
 * - {"type":"tool_use",...} - Tool being called (show name and details)
 * - {"type":"tool_result",...} - Tool result (check for errors)
 */
function parseZaiOutputToEvents(data: string): AgentDisplayEvent[] {
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
          // Final result - check for errors first
          if (event.subtype === 'error' || event.is_error || event.error) {
            const errorMsg = event.error || event.result || 'Unknown error';
            allEvents.push({ type: 'error', message: String(errorMsg) });
          } else if (event.result && typeof event.result === 'string') {
            // Include result text only if not an error (avoid duplicate)
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
 * Zai agent plugin implementation.
 * Uses the `zai` CLI for AI coding tasks.
 */
export class ZaiAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'zai',
    name: 'zai',
    description: 'Zai AI coding assistant',
    version: '1.0.0',
    author: 'Zai',
    defaultCommand: 'zai',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: true,
    supportsSubagentTracing: true,
    structuredOutputFormat: 'jsonl',
    skillsPaths: {
      personal: '~/.cc-mirror/zai/config/skills',
      repo: '.zai/skills',
    },
  };

  /** Model to use */
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
   * Detect zai CLI availability.
   */
  override async detect(): Promise<AgentDetectResult> {
    const command = this.commandPath ?? this.meta.defaultCommand;

    const findResult = await findCommandPath(command);

    if (!findResult.found) {
      return {
        available: false,
        error: `Zai CLI not found in PATH. Install from https://github.com/anthropics/claude-code`,
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

    return {
      available: true,
      version: versionResult.version,
      executablePath: findResult.path,
    };
  }

  override getSandboxRequirements() {
    return {
      authPaths: ['~/.cc-mirror/zai/config', '~/.zai', '~/.config/zai'],
      binaryPaths: ['/usr/local/bin', '~/.local/bin'],
      runtimePaths: ['~/.bun', '~/.nvm'],
      requiresNetwork: true,
    };
  }

  /**
   * Run --version to verify binary
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
          const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
          resolve({
            success: true,
            version: versionMatch?.[1] || 'unknown',
          });
        } else {
          resolve({
            success: false,
            error: stderr || `Exited with code ${code}`,
          });
        }
      });

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
        type: 'text',
        default: '',
        required: false,
        help: 'Zai model to use (if applicable)',
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
    // zai is a wrapper for Claude Code
    // -p for non-interactive output
    // --output-format stream-json for structured JSON output
    // --verbose is required for stream-json format
    const args: string[] = ['-p', '--output-format', 'stream-json', '--verbose'];

    if (this.model) {
      args.push('--model', this.model);
    }

    if (this.skipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

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

    return args;
  }

  protected override getStdinInput(
    prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string {
    return prompt;
  }

  /**
   * Override execute to parse zai stream-json output.
   * Wraps the onStdout/onStdoutSegments callbacks to parse JSONL events and extract displayable content.
   * Also forwards raw JSONL messages to onJsonlMessage for subagent tracing.
   */
  override execute(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): AgentExecutionHandle {
    // Wrap callbacks to parse JSON events
    const parsedOptions: AgentExecuteOptions = {
      ...options,
      onStdout: (options?.onStdout || options?.onStdoutSegments || options?.onJsonlMessage)
        ? (data: string) => {
            // Parse raw JSONL lines and forward to onJsonlMessage for subagent tracing
            if (options?.onJsonlMessage) {
              for (const line of data.split('\n')) {
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
            const events = parseZaiOutputToEvents(data);
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
    };

    return super.execute(prompt, files, parsedOptions);
  }

  override async validateSetup(
    _answers: Record<string, unknown>
  ): Promise<string | null> {
    return null;
  }

  override validateModel(_model: string): string | null {
    return null;
  }

  protected override getPreflightSuggestion(): string {
    return (
      'Common fixes for Zai:\n' +
      '  1. Test Zai directly: zai "hello"\n' +
      '  2. Verify Zai is installed: zai --version\n' +
      '  3. Check your Zai configuration in ~/.config/zai'
    );
  }
}

/**
 * Factory function for the Zai agent plugin.
 */
const createZaiAgent: AgentPluginFactory = () => new ZaiAgentPlugin();

export default createZaiAgent;
