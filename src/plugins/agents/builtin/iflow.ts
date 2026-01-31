/**
 * ABOUTME: iFlow CLI agent plugin for iflow command.
 * Integrates with iFlow CLI for AI-assisted coding.
 * Supports: non-interactive mode, JSONL streaming, model selection, yolo mode.
 */

import { spawn } from 'node:child_process';
import { BaseAgentPlugin, findCommandPath, quoteForWindowsShell } from '../base.js';
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
    supportsSubagentTracing: false,
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

  protected buildArgs(
    prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string[] {
    const args: string[] = [];

    // Use -p/--prompt parameter to pass the prompt
    args.push('-p', prompt);

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
   * Override execute to handle iFlow's plain text output.
   * iFlow outputs plain text with JSON execution info wrapped in <Execution Info> tags.
   */
  override execute(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): AgentExecutionHandle {
    return super.execute(prompt, files, options);
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
