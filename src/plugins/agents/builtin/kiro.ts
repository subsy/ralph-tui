/**
 * ABOUTME: Kiro CLI agent plugin for AWS's kiro-cli command.
 * Integrates with Kiro CLI for AI-assisted coding.
 * Supports: non-interactive mode, trust-all-tools for auto-approve, text output.
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
 * Kiro CLI agent plugin implementation.
 * Uses `kiro-cli chat --no-interactive` for non-interactive AI coding tasks.
 * Note: Kiro outputs text only (no JSONL), so subagent tracing shows activity indicator only.
 */
export class KiroAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'kiro',
    name: 'Kiro CLI',
    description: 'AWS Kiro CLI for AI-assisted coding',
    version: '1.0.0',
    author: 'AWS',
    defaultCommand: 'kiro-cli',
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false,
    supportsSubagentTracing: false, // Text output only, no structured tracing
    structuredOutputFormat: undefined,
    skillsPaths: {
      personal: '~/.kiro/skills',
      repo: '.kiro',
    },
  };

  private trustAllTools = true;
  private agent?: string;
  protected override defaultTimeout = 0;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (typeof config.trustAllTools === 'boolean') {
      this.trustAllTools = config.trustAllTools;
    }

    if (typeof config.agent === 'string' && config.agent.length > 0) {
      this.agent = config.agent;
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
        error: `Kiro CLI not found in PATH. Install from: https://kiro.dev`,
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
      // Use -V flag (the documented version flag for kiro-cli)
      const proc = spawn(command, ['-V'], {
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
        resolve({ success: false, error: 'Timeout waiting for version' });
      }, 5000);
    });
  }

  override getSetupQuestions(): AgentSetupQuestion[] {
    return [
      ...super.getSetupQuestions(),
      {
        id: 'trustAllTools',
        prompt: 'Trust all tools (auto-approve)?',
        type: 'boolean',
        default: true,
        required: false,
        help: 'Skip tool approval prompts for autonomous operation',
      },
      {
        id: 'agent',
        prompt: 'Agent name (optional):',
        type: 'text',
        default: '',
        required: false,
        help: 'Specific Kiro agent to use (leave empty for default)',
      },
    ];
  }

  protected buildArgs(
    prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string[] {
    const args: string[] = [];

    // Use chat subcommand with non-interactive mode
    args.push('chat', '--no-interactive');

    // Trust all tools for auto-approve
    if (this.trustAllTools) {
      args.push('--trust-all-tools');
    }

    // Agent selection
    if (this.agent) {
      args.push('--agent', this.agent);
    }

    // Prompt goes last
    args.push(prompt);

    return args;
  }

  override async validateSetup(_answers: Record<string, unknown>): Promise<string | null> {
    return null;
  }

  override validateModel(_model: string): string | null {
    // Kiro doesn't expose model selection via CLI
    return null;
  }
}

const createKiroAgent: AgentPluginFactory = () => new KiroAgentPlugin();

export default createKiroAgent;
