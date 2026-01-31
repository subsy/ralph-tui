/**
 * ABOUTME: iFlow CLI agent plugin for iflow command.
 * Integrates with iFlow CLI for AI-assisted coding.
 * Supports: non-interactive mode, JSONL streaming, model selection, yolo mode.
 */

import { spawn } from 'node:child_process';
import { BaseAgentPlugin, findCommandPath, quoteForWindowsShell } from '../base.js';
import { processAgentEventsToSegments } from '../output-formatting.js';
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
 * iFlow CLI agent plugin implementation.
 * Uses the `iflow` CLI to execute AI coding tasks.
 */
export class IflowAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'iflow',
    name: 'iFlow CLI',
    description: 'iFlow CLI for AI-assisted coding',
    version: '1.0.0',
    author: 'iFlow',
    defaultCommand: 'iflow',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false,
    supportsSubagentTracing: true,
    skillsPaths: {
      personal: '~/.iflow/skills',
      repo: '.iflow/skills',
    },
  };

  private model?: string;
  private yoloMode = true;
  protected override defaultTimeout = 0;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (typeof config.model === 'string' && config.model.length > 0) {
      this.model = config.model;
    }

    if (typeof config.yoloMode === 'boolean') {
      this.yoloMode = config.yoloMode;
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
        error: `iFlow CLI not found in PATH`,
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
              error: `Unable to parse iflow version output: ${stdout}`,
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
      }, 5000);
    });
  }

  override getSetupQuestions(): AgentSetupQuestion[] {
    return [
      ...super.getSetupQuestions(),
      {
        id: 'model',
        prompt: 'Model to use:',
        type: 'select',
        choices: [
          { value: '', label: 'Default', description: 'Use configured default model' },
          { value: 'glm-4.7', label: 'GLM-4.7', description: 'Recommended' },
          { value: 'iflow-rome-30ba3b', label: 'iFlow-ROME-30BA3B', description: 'Preview' },
          { value: 'deepseek-v3.2', label: 'DeepSeek-V3.2', description: 'DeepSeek model' },
          { value: 'qwen3-coder-plus', label: 'Qwen3-Coder-Plus', description: 'Qwen coding model' },
          { value: 'kimi-k2-thinking', label: 'Kimi-K2-Thinking', description: 'Kimi thinking model' },
          { value: 'minimax-m2.1', label: 'MiniMax-M2.1', description: 'MiniMax model' },
          { value: 'kimi-k2-0905', label: 'Kimi-K2-0905', description: 'Kimi K2 0905' },
        ],
        default: '',
        required: false,
        help: 'iFlow model to use',
      },
      {
        id: 'yoloMode',
        prompt: 'Enable YOLO mode (auto-approve)?',
        type: 'boolean',
        default: true,
        required: false,
        help: 'Skip approval prompts for autonomous operation',
      },
    ];
  }

  /**
   * Parse iFlow output into standardized display events.
   * Extracts tool calls from text output using pattern matching.
   *
   * Supported patterns:
   * - Tool call: "I'll use read_file to read the file"
   * - Tool call: "Using write_file to create..."
   * - Execution info: <Execution Info> tags with tool details
   */
  private parseIflowOutputToEvents(data: string): import('../output-formatting.js').AgentDisplayEvent[] {
    const events: import('../output-formatting.js').AgentDisplayEvent[] = [];
    const lines = data.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines
      if (!trimmed) continue;

      // Try to detect tool calls from common patterns
      const toolPatterns = [
        /I'?ll use (\w+) to/i,
        /Using (\w+) to/i,
        /Now using (\w+)/i,
        /Calling (\w+)/i,
        /Execute (\w+)/i,
        /Run (\w+)/i,
      ];

      let matched = false;
      for (const pattern of toolPatterns) {
        const match = trimmed.match(pattern);
        if (match) {
          const toolName = match[1];
          // Common iFlow tools
          const knownTools = [
            'read_file', 'write_file', 'replace', 'glob', 'search_file_content',
            'list_directory', 'run_shell_command', 'web_fetch', 'web_search',
            'ask_user_question', 'image_read', 'take_snapshot', 'click',
            'fill', 'navigate_page', 'evaluate_script',
          ];

          if (knownTools.includes(toolName)) {
            // Extract tool input from the line
            const input = this.extractToolInput(trimmed, toolName);
            events.push({
              type: 'tool_use',
              name: toolName,
              input,
            });
            matched = true;
            break;
          }
        }
      }

      // If not a tool call, treat as text
      if (!matched) {
        events.push({ type: 'text', content: line + '\n' });
      }
    }

    return events;
  }

  /**
   * Extract tool input from a line containing tool call description.
   */
  private extractToolInput(line: string, toolName: string): Record<string, unknown> {
    const input: Record<string, unknown> = {};

    // Extract file path patterns
    const pathMatch = line.match(/['"`]([^'"`]+(?:\/[^'"`]*)*)['"`]/g);
    if (pathMatch) {
      const paths = pathMatch.map(p => p.replace(/['"`]/g, ''));
      if (paths.length === 1) {
        input.file_path = paths[0];
        input.path = paths[0];
      } else if (paths.length > 1) {
        input.paths = paths;
      }
    }

    // Extract command patterns (for run_shell_command)
    if (toolName === 'run_shell_command') {
      const cmdMatch = line.match(/command[:\s]+(['"`]?)([^'"`\n]+)\1/);
      if (cmdMatch) {
        input.command = cmdMatch[2];
      }
      const descMatch = line.match(/description[:\s]+(['"`]?)([^'"`\n]+)\1/);
      if (descMatch) {
        input.description = descMatch[2];
      }
    }

    // Extract search patterns
    if (toolName === 'search_file_content' || toolName === 'glob') {
      const patternMatch = line.match(/pattern[:\s]+(['"`]?)([^'"`\n]+)\1/);
      if (patternMatch) {
        input.pattern = patternMatch[2];
      }
    }

    // Extract query patterns
    if (toolName === 'web_search') {
      const queryMatch = line.match(/query[:\s]+(['"`]?)([^'"`\n]+)\1/);
      if (queryMatch) {
        input.query = queryMatch[2];
      }
    }

    // Extract URL patterns
    if (toolName === 'web_fetch' || toolName === 'navigate_page') {
      const urlMatch = line.match(/url[:\s]+(['"`]?)(https?:\/\/[^'"`\s]+)\1/);
      if (urlMatch) {
        input.url = urlMatch[2];
      }
    }

    return input;
  }

  protected buildArgs(
    _prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string[] {
    const args: string[] = [];

    // Prompt will be passed via stdin, not as command line argument

    // Model selection
    if (this.model) {
      args.push('-m', this.model);
    }

    // Auto-approve mode
    if (this.yoloMode) {
      args.push('--yolo');
    }

    return args;
  }

  /**
   * Override getStdinInput to pass the prompt via stdin.
   */
  protected override getStdinInput(
    prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string {
    return prompt;
  }

  /**
   * Override execute to parse iFlow output for structured display.
   * Wraps the onStdout/onStdoutSegments callbacks to format tool calls.
   */
  override execute(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): AgentExecutionHandle {
    const parsedOptions: AgentExecuteOptions = {
      ...options,
      // Wrap onStdout to parse and emit structured events
      onStdout: (data: string) => {
        // Parse output into display events
        const events = this.parseIflowOutputToEvents(data);

        // Call TUI-native segments callback for colored output
        if (options?.onStdoutSegments) {
          const segments = processAgentEventsToSegments(events);
          if (segments.length > 0) {
            options.onStdoutSegments(segments);
          }
        }

        // Also call legacy string callback for backward compatibility
        if (options?.onStdout) {
          // For legacy callback, pass original data to avoid double-parsing
          options.onStdout(data);
        }
      },
    };

    return super.execute(prompt, files, parsedOptions);
  }

  override async validateSetup(answers: Record<string, unknown>): Promise<string | null> {
    const model = answers.model;
    if (model !== undefined && model !== '' && typeof model === 'string') {
      const validModels = [
        'glm-4.7',
        'iflow-rome-30ba3b',
        'deepseek-v3.2',
        'qwen3-coder-plus',
        'kimi-k2-thinking',
        'minimax-m2.1',
        'kimi-k2-0905',
      ];
      if (!validModels.includes(model)) {
        return `Invalid model. Valid models: ${validModels.join(', ')}`;
      }
    }
    return null;
  }

  override validateModel(model: string): string | null {
    if (model === '' || model === undefined) {
      return null;
    }
    const validModels = [
      'glm-4.7',
      'iflow-rome-30ba3b',
      'deepseek-v3.2',
      'qwen3-coder-plus',
      'kimi-k2-thinking',
      'minimax-m2.1',
      'kimi-k2-0905',
    ];
    if (!validModels.includes(model)) {
      return `Invalid model "${model}". Valid models: ${validModels.join(', ')}`;
    }
    return null;
  }
}

const createIflowAgent: AgentPluginFactory = () => new IflowAgentPlugin();

export default createIflowAgent;
