/**
 * ABOUTME: Antigravity CLI agent plugin for Google's agy command.
 * Integrates with Antigravity CLI for Gemini/Claude/GPT-OSS models.
 * Supports: stream-json output, stdin prompt, model selection, auto-approve permissions.
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

/**
 * Known Antigravity model IDs from `agy models`.
 * Model strings already encode effort (e.g. gemini-3.1-pro-high).
 */
const ANTIGRAVITY_MODELS = [
  'gemini-3.6-flash-high',
  'gemini-3.6-flash-medium',
  'gemini-3.6-flash-low',
  'gemini-3.5-flash-high',
  'gemini-3.5-flash-medium',
  'gemini-3.5-flash-low',
  'gemini-3.1-pro-high',
  'gemini-3.1-pro-low',
  'claude-sonnet-4-6',
  'claude-opus-4-6-thinking',
  'gpt-oss-120b-medium',
] as const;

/**
 * Parse an Antigravity stream-json line into standardized display events.
 *
 * Event shapes (agy --output-format stream-json):
 * - {"event":"init","init":{...}} — session start (skip)
 * - {"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"..."}}
 * - {"event":"step_update","step_update":{"step_type":"tool","state":"ACTIVE"|"DONE","tool_name":"...","tool_info":{...}}}
 * - {"event":"result","result":{"status":"SUCCESS"|"ERROR","response":"...","error":"..."}}
 *
 * @internal Exported for testing only.
 */
export function parseAntigravityJsonLine(jsonLine: string): AgentDisplayEvent[] {
  if (!jsonLine || jsonLine.length === 0) return [];

  try {
    const event = JSON.parse(jsonLine) as Record<string, unknown>;
    const events: AgentDisplayEvent[] = [];
    const eventType = event.event;

    if (eventType === 'step_update') {
      const stepUpdate = event.step_update;
      if (stepUpdate == null || typeof stepUpdate !== 'object' || Array.isArray(stepUpdate)) {
        return [];
      }
      const step = stepUpdate as Record<string, unknown>;
      const stepType = step.step_type;
      const state = step.state;

      if (stepType === 'agent_response') {
        if (typeof step.text_delta === 'string' && step.text_delta.length > 0) {
          events.push({ type: 'text', content: step.text_delta });
        }
      } else if (stepType === 'tool') {
        if (state === 'ACTIVE') {
          const toolName =
            (typeof step.tool_name === 'string' && step.tool_name) ||
            (step.tool_info != null &&
            typeof step.tool_info === 'object' &&
            !Array.isArray(step.tool_info) &&
            typeof (step.tool_info as Record<string, unknown>).name === 'string'
              ? ((step.tool_info as Record<string, unknown>).name as string)
              : 'unknown');
          let toolInput: Record<string, unknown> | undefined;
          if (
            step.tool_info != null &&
            typeof step.tool_info === 'object' &&
            !Array.isArray(step.tool_info)
          ) {
            const info = step.tool_info as Record<string, unknown>;
            if (info.parameters != null && typeof info.parameters === 'object' && !Array.isArray(info.parameters)) {
              toolInput = info.parameters as Record<string, unknown>;
            } else {
              toolInput = info;
            }
          }
          events.push({ type: 'tool_use', name: toolName, input: toolInput });
        } else if (state === 'DONE') {
          events.push({ type: 'tool_result' });
        }
      }
      // Skip: user_input, checkpoint, unknown, and other non-display steps
    } else if (eventType === 'result') {
      const result = event.result;
      if (result != null && typeof result === 'object' && !Array.isArray(result)) {
        const resultObj = result as Record<string, unknown>;
        if (resultObj.status === 'ERROR') {
          const errorMsg =
            extractErrorMessage(resultObj.error) ||
            extractErrorMessage(resultObj.response) ||
            'Unknown error';
          events.push({ type: 'error', message: errorMsg });
        }
      }
    }
    // Skip: init and other non-content events

    return events;
  } catch {
    // Not valid JSON - skip silently
    return [];
  }
}

/**
 * Parse Antigravity stream-json output into display events.
 * @internal Exported for testing only.
 */
export function parseAntigravityOutputToEvents(data: string): AgentDisplayEvent[] {
  const allEvents: AgentDisplayEvent[] = [];
  for (const line of data.split('\n')) {
    const events = parseAntigravityJsonLine(line.trim());
    allEvents.push(...events);
  }
  return allEvents;
}

/**
 * Antigravity CLI agent plugin implementation.
 * Uses the `agy` CLI with stream-json output for non-interactive AI coding tasks.
 * Prompt is delivered via stdin (do not pass --print; that flag consumes the next argument as the prompt).
 */
export class AntigravityAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'antigravity',
    name: 'Antigravity CLI',
    description: "Google's Antigravity CLI (agy) for Gemini, Claude, and GPT-OSS models",
    version: '1.0.0',
    author: 'Google',
    defaultCommand: 'agy',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false,
    supportsSubagentTracing: true,
    structuredOutputFormat: 'jsonl',
    skillsPaths: {
      personal: '~/.gemini/antigravity-cli/skills',
      repo: '.agents/skills',
    },
  };

  private model?: string;
  private skipPermissions = true;
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

  override async detect(): Promise<AgentDetectResult> {
    const command = this.commandPath ?? this.meta.defaultCommand;
    const findResult = await findCommandPath(command);

    if (!findResult.found) {
      return {
        available: false,
        error:
          'Antigravity CLI (agy) not found in PATH. Install the Antigravity CLI and ensure `agy` is available.',
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
          const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
          if (!versionMatch?.[1]) {
            safeResolve({
              success: false,
              error: `Unable to parse agy version output: ${stdout}`,
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
      authPaths: ['~/.gemini'],
      binaryPaths: ['/usr/local/bin', '/opt/homebrew/bin', '~/.local/bin'],
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
        type: 'select',
        choices: [
          { value: '', label: 'Default', description: 'Use CLI configured default' },
          ...ANTIGRAVITY_MODELS.map((model) => ({
            value: model,
            label: model,
            description: model,
          })),
        ],
        default: '',
        required: false,
        help: 'Model ID from `agy models` (effort is part of the model string)',
      },
      {
        id: 'skipPermissions',
        prompt: 'Auto-approve tool permissions?',
        type: 'boolean',
        default: true,
        required: false,
        help: 'Passes --dangerously-skip-permissions for autonomous Ralph TUI runs',
      },
    ];
  }

  protected buildArgs(
    _prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string[] {
    const args: string[] = [];

    // agy runs non-interactively whenever stdin is not a terminal, so the prompt is piped in.
    // Do not pass --print/--prompt: those flags consume the next argument as the prompt.
    args.push('--output-format', 'stream-json');

    if (this.skipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    if (this.model) {
      args.push('--model', this.model);
    }

    return args;
  }

  /**
   * Provide the prompt via stdin.
   * agy reads the prompt from stdin when --print/--prompt is omitted and stdin is not a terminal.
   */
  protected override getStdinInput(
    prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string {
    return prompt;
  }

  /**
   * Override execute to parse Antigravity stream-json output into display events.
   */
  override execute(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): AgentExecutionHandle {
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

      const events = parseAntigravityOutputToEvents(trimmed);
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

              const events = parseAntigravityOutputToEvents(completeData);
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
    if (model === '' || model === undefined) {
      return null;
    }
    // Accept any non-empty model string — `agy models` list drifts over time.
    // Known IDs are offered in setup; custom/newer IDs should still work.
    if (model.trim().length === 0) {
      return null;
    }
    return null;
  }

  override listModels(): string[] {
    return [...ANTIGRAVITY_MODELS];
  }

  protected override getPreflightSuggestion(): string {
    return (
      'Common fixes for Antigravity CLI:\n' +
      '  1. Test agy directly: printf "hello" | agy --output-format text --dangerously-skip-permissions\n' +
      '  2. Check install: agy --version\n' +
      '  3. List models: agy models\n' +
      '  4. Sign in: run agy interactively, then retry (tokens live in the OS keyring)'
    );
  }
}

/**
 * Factory function for the Antigravity CLI agent plugin.
 */
const createAntigravityAgent: AgentPluginFactory = () => new AntigravityAgentPlugin();

export default createAntigravityAgent;
