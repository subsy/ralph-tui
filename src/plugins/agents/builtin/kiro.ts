/**
 * ABOUTME: Kiro CLI agent plugin for AWS's kiro-cli command.
 * Integrates with Kiro CLI for AI-assisted coding.
 * Supports: non-interactive mode, trust-all-tools for auto-approve, text output.
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
} from '../types.js';

/**
 * Valid Kiro model names.
 * Empty string means use default (Auto routing).
 */
const VALID_KIRO_MODELS = ['', 'claude-sonnet4', 'claude-sonnet4.5', 'claude-haiku4.5', 'claude-opus4.5'] as const;

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
    // Kiro CLI supports skills in ~/.kiro/skills/ (personal) and .kiro/skills/ (repo)
    // Note: Kiro also has "Powers" (~/.kiro/powers/) which are similar but use POWER.md format
    skillsPaths: {
      personal: '~/.kiro/skills',
      repo: '.kiro/skills',
    },
  };

  private trustAllTools = true;
  private agent?: string;
  private model?: string;
  protected override defaultTimeout = 0;

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (typeof config.trustAllTools === 'boolean') {
      this.trustAllTools = config.trustAllTools;
    }

    if (typeof config.agent === 'string' && config.agent.length > 0) {
      this.agent = config.agent;
    }

    if (typeof config.model === 'string') {
      const model = config.model.trim();
      if (model && !this.validateModel(model)) {
        this.model = model;
      }
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
      // Only use shell on Windows where direct spawn may not work
      const useShell = process.platform === 'win32';
      const proc = spawn(useShell ? quoteForWindowsShell(command) : command, ['-V'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: useShell,
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
          if (!versionMatch?.[1]) {
            resolve({
              success: false,
              error: `Unable to parse kiro-cli version output: ${stdout}`,
            });
            return;
          }
          resolve({ success: true, version: versionMatch[1] });
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
      {
        id: 'model',
        prompt: 'Model to use:',
        type: 'select',
        default: '',
        required: false,
        choices: [
          { value: '', label: 'Auto', description: 'Intelligent model routing (recommended)' },
          { value: 'claude-sonnet4', label: 'Claude Sonnet 4.0', description: 'Direct Sonnet 4.0 access' },
          { value: 'claude-sonnet4.5', label: 'Claude Sonnet 4.5', description: 'Best for complex agents and coding' },
          { value: 'claude-haiku4.5', label: 'Claude Haiku 4.5', description: 'Fast and cost-effective' },
          { value: 'claude-opus4.5', label: 'Claude Opus 4.5', description: 'Maximum intelligence (Pro+ only)' },
        ],
        help: 'Kiro model to use (see kiro.dev/docs/cli/chat/model-selection)',
      },
    ];
  }

  protected buildArgs(
    _prompt: string,
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

    // Model selection
    if (this.model) {
      args.push('--model', this.model);
    }

    // Note: Prompt is passed via stdin (see getStdinInput) to avoid
    // Windows shell interpretation issues with special characters.

    return args;
  }

  /**
   * Provide the prompt via stdin instead of command args.
   * This avoids shell interpretation issues with special characters in prompts
   * on Windows where shell: true is required for wrapper script execution.
   */
  protected override getStdinInput(
    prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string {
    return prompt;
  }

  override async validateSetup(_answers: Record<string, unknown>): Promise<string | null> {
    return null;
  }

  override validateModel(model: string): string | null {
    if (model && !VALID_KIRO_MODELS.includes(model as typeof VALID_KIRO_MODELS[number])) {
      return `Invalid model. Must be one of: ${VALID_KIRO_MODELS.filter(m => m).join(', ')} (or empty for Auto)`;
    }
    return null;
  }
}

const createKiroAgent: AgentPluginFactory = () => new KiroAgentPlugin();

export default createKiroAgent;
