/**
 * ABOUTME: Gemini CLI agent plugin for Google's gemini command.
 * Integrates with Gemini CLI for AI-assisted coding.
 * Supports: non-interactive mode, JSONL streaming, model selection, yolo mode.
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
 * Gemini CLI agent plugin implementation.
 * Uses the `gemini` CLI to execute AI coding tasks.
 */
export class GeminiAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'gemini',
    name: 'Gemini CLI',
    description: 'Google Gemini CLI for AI-assisted coding',
    version: '1.0.0',
    author: 'Google',
    defaultCommand: 'gemini',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false,
    supportsSubagentTracing: true,
    structuredOutputFormat: 'jsonl',
    skillsPaths: {
      personal: '~/.gemini/skills',
      repo: '.gemini/skills',
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
        error: `Gemini CLI not found in PATH. Install from: https://github.com/google-gemini/gemini-cli`,
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
        resolve({ success: false, error: `Failed to execute: ${error.message}` });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
          resolve({ success: true, version: versionMatch?.[1] });
        } else {
          resolve({ success: false, error: stderr || `Exited with code ${code}` });
        }
      });

      setTimeout(() => {
        proc.kill();
        resolve({ success: false, error: 'Timeout waiting for --version' });
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
          { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Most capable' },
          { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Fast and efficient' },
        ],
        default: '',
        required: false,
        help: 'Gemini model to use',
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
    options?: AgentExecuteOptions
  ): string[] {
    const args: string[] = [];

    // Non-interactive prompt mode
    args.push('-p', prompt);

    // JSONL streaming output
    if (options?.subagentTracing) {
      args.push('--output-format', 'stream-json');
    }

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

  override async validateSetup(answers: Record<string, unknown>): Promise<string | null> {
    const model = answers.model;
    if (model !== undefined && model !== '' && typeof model === 'string') {
      if (!model.startsWith('gemini-')) {
        return 'Invalid model. Gemini models start with "gemini-"';
      }
    }
    return null;
  }

  override validateModel(model: string): string | null {
    if (model === '' || model === undefined) {
      return null;
    }
    if (!model.startsWith('gemini-')) {
      return `Invalid model "${model}". Gemini models start with "gemini-"`;
    }
    return null;
  }
}

const createGeminiAgent: AgentPluginFactory = () => new GeminiAgentPlugin();

export default createGeminiAgent;
