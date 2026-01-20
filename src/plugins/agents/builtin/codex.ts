/**
 * ABOUTME: Codex CLI agent plugin for OpenAI's codex command.
 * Integrates with Codex CLI for AI-assisted coding.
 * Supports: non-interactive exec mode, JSONL streaming, full-auto mode, sandbox modes.
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
 * Codex CLI agent plugin implementation.
 * Uses the `codex exec` command for non-interactive AI coding tasks.
 */
export class CodexAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'codex',
    name: 'Codex CLI',
    description: 'OpenAI Codex CLI for AI-assisted coding',
    version: '1.0.0',
    author: 'OpenAI',
    defaultCommand: 'codex',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false,
    supportsSubagentTracing: true,
    structuredOutputFormat: 'jsonl',
    skillsPaths: {
      personal: '~/.codex/skills',
      repo: '.codex/skills',
    },
  };

  private model?: string;
  private fullAuto = true;
  private sandbox: 'read-only' | 'workspace-write' | 'danger-full-access' = 'workspace-write';
  protected override defaultTimeout = 0;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (typeof config.model === 'string' && config.model.length > 0) {
      this.model = config.model;
    }

    if (typeof config.fullAuto === 'boolean') {
      this.fullAuto = config.fullAuto;
    }

    if (typeof config.sandbox === 'string' &&
        ['read-only', 'workspace-write', 'danger-full-access'].includes(config.sandbox)) {
      this.sandbox = config.sandbox as typeof this.sandbox;
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
        error: `Codex CLI not found in PATH. Install from: https://github.com/openai/codex`,
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
        type: 'text',
        default: '',
        required: false,
        help: 'OpenAI model to use (leave empty for default)',
      },
      {
        id: 'fullAuto',
        prompt: 'Enable full-auto mode?',
        type: 'boolean',
        default: true,
        required: false,
        help: 'Auto-approve all actions for autonomous operation',
      },
      {
        id: 'sandbox',
        prompt: 'Sandbox mode:',
        type: 'select',
        choices: [
          { value: 'read-only', label: 'Read Only', description: 'No file modifications' },
          { value: 'workspace-write', label: 'Workspace Write', description: 'Can modify workspace files' },
          { value: 'danger-full-access', label: 'Full Access', description: 'Full system access (dangerous)' },
        ],
        default: 'workspace-write',
        required: false,
        help: 'Sandbox restrictions for file access',
      },
    ];
  }

  protected buildArgs(
    prompt: string,
    _files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): string[] {
    const args: string[] = [];

    // Use exec subcommand for non-interactive mode
    args.push('exec');

    // Full-auto mode
    if (this.fullAuto) {
      args.push('--full-auto');
    }

    // JSONL output
    if (options?.subagentTracing) {
      args.push('--json');
    }

    // Model selection
    if (this.model) {
      args.push('--model', this.model);
    }

    // Sandbox mode
    args.push('--sandbox', this.sandbox);

    // Prompt goes last
    args.push(prompt);

    return args;
  }

  override async validateSetup(_answers: Record<string, unknown>): Promise<string | null> {
    return null;
  }

  override validateModel(_model: string): string | null {
    // Codex accepts various OpenAI models, no strict validation
    return null;
  }
}

const createCodexAgent: AgentPluginFactory = () => new CodexAgentPlugin();

export default createCodexAgent;
