/**
 * ABOUTME: GitHub Copilot CLI agent plugin for the `copilot` command.
 * Integrates with GitHub Copilot CLI for AI-assisted coding.
 * Supports: streaming output, auto-approve mode, model selection.
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
 * GitHub Copilot CLI agent plugin implementation.
 * Uses the `copilot` CLI to execute AI coding tasks.
 */
export class GithubCopilotAgentPlugin extends BaseAgentPlugin {
    readonly meta: AgentPluginMeta = {
        id: 'github-copilot',
        name: 'GitHub Copilot',
        description: 'GitHub Copilot CLI for AI-assisted coding',
        version: '1.0.0',
        author: 'GitHub',
        defaultCommand: 'copilot',
        supportsStreaming: true,
        supportsInterrupt: true,
        supportsFileContext: false,
        supportsSubagentTracing: false,
        structuredOutputFormat: undefined,
        skillsPaths: {
            personal: '~/.copilot/skills',
            repo: '.github/skills',
        },
    };

    private model?: string;
    private autoApprove = true;
    protected override defaultTimeout = 0;

    override async initialize(config: Record<string, unknown>): Promise<void> {
        await super.initialize(config);

        if (typeof config.model === 'string' && config.model.length > 0) {
            this.model = config.model;
        }

        if (typeof config.autoApprove === 'boolean') {
            this.autoApprove = config.autoApprove;
        }

        if (typeof config.timeout === 'number' && config.timeout > 0) {
            this.defaultTimeout = config.timeout;
        }
    }

    override getSandboxRequirements() {
        return {
            authPaths: ['~/.config/github-copilot', '~/.config/gh', '~/.gitconfig'],
            binaryPaths: [
                '/usr/local/bin',
                '~/.local/bin',
            ],
            runtimePaths: [],
            requiresNetwork: true,
        };
    }

    override async detect(): Promise<AgentDetectResult> {
        const command = this.commandPath ?? this.meta.defaultCommand;
        const findResult = await findCommandPath(command);

        if (!findResult.found) {
            return {
                available: false,
                error: `GitHub Copilot CLI ('copilot') not found in PATH. Install via 'npm install -g @github/copilot' or visit https://gh.io/copilot-install`,
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
                            error: `Unable to parse copilot version output: ${stdout}`,
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
                type: 'text',
                default: '',
                required: false,
                help: 'Model name. Run "/model" in the Copilot CLI to see available models (varies by account). Leave empty for default.',
            },
            {
                id: 'autoApprove',
                prompt: 'Auto-approve file modifications?',
                type: 'boolean',
                default: true,
                required: false,
                help: 'Enable auto-approval for autonomous operation',
            },
        ];
    }

    protected buildArgs(
        _prompt: string,
        _files?: AgentFileContext[],
        _options?: AgentExecuteOptions
    ): string[] {
        const args: string[] = [];

        // Model selection if configured
        if (this.model) {
            args.push('--model', this.model);
        }

        // Auto-approve mode
        if (this.autoApprove) {
            args.push('--yolo');
        }

        // Note: Prompt is passed via stdin (see getStdinInput)

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
        // No specific validation needed for GitHub Copilot
        return null;
    }

    override validateModel(_model: string): string | null {
        // GitHub Copilot accepts various models, no strict validation
        return null;
    }

    /**
     * Get GitHub Copilot-specific suggestions for preflight failures.
     * Provides actionable guidance for common configuration issues.
     */
    protected override getPreflightSuggestion(): string {
        return (
            'Common fixes for GitHub Copilot CLI:\n' +
            '  1. Test copilot directly: copilot --version\n' +
            '  2. Install GitHub CLI: https://github.com/cli/cli\n' +
            '  3. Authenticate with GitHub: gh auth login\n' +
            '  4. Verify GitHub Copilot subscription is active'
        );
    }
}

const createGithubCopilotAgent: AgentPluginFactory = () => new GithubCopilotAgentPlugin();

export default createGithubCopilotAgent;
