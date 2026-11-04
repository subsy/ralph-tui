/**
 * ABOUTME: Shared Claude Code runtime integration for cc-mirror provider wrappers.
 * Keeps execution, stdin delivery, and JSONL parsing aligned with the Claude agent.
 */

import { ClaudeAgentPlugin } from './claude.js';
import type { AgentSetupQuestion } from '../types.js';

export abstract class CcMirrorAgentPlugin extends ClaudeAgentPlugin {
  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize({ printMode: 'stream', ...config });
  }

  protected override getCommandNotFoundMessage(): string {
    return `${this.meta.name} wrapper not found in PATH. Set up cc-mirror: npx cc-mirror quick --provider ${this.meta.id}. See https://github.com/numman-ali/cc-mirror`;
  }

  override getSandboxRequirements() {
    const variant = `~/.cc-mirror/${this.meta.id}`;
    return {
      authPaths: [`${variant}/config`],
      binaryPaths: ['/usr/local/bin', '~/.local/bin', '~/.cc-mirror/bin', `${variant}/native`, `${variant}/npm`, `${variant}/tweakcc`],
      runtimePaths: ['~/.bun', '~/.nvm'],
      requiresNetwork: true,
    };
  }

  override getSetupQuestions(): AgentSetupQuestion[] {
    return super.getSetupQuestions().map((question) => {
      if (question.id === 'model') {
        return {
          id: 'model',
          prompt: 'Model alias or provider model ID (optional):',
          type: 'text',
          default: '',
          required: false,
          help: 'Leave empty for the cc-mirror default, use sonnet/opus/haiku for configured slots, or enter a provider model ID.',
        };
      }
      if (question.id === 'printMode') {
        return { ...question, default: 'stream', help: `How the ${this.meta.name} wrapper should output responses` };
      }
      return question;
    });
  }

  override async validateSetup(answers: Record<string, unknown>): Promise<string | null> {
    const error = await super.validateSetup({ ...answers, model: undefined });
    if (error) return error;
    if (answers.model === undefined) return null;
    if (typeof answers.model !== 'string') return 'Model must be a string';
    return this.validateModel(answers.model);
  }

  override validateModel(model: string): string | null {
    if (model === '' || model.trim().length > 0) return null;
    return 'Model must not contain only whitespace';
  }

  protected override getPreflightSuggestion(): string {
    return `Test the wrapper directly: ${this.meta.defaultCommand} --print "hello". Check provider credentials and model mappings with npx cc-mirror doctor. See https://github.com/numman-ali/cc-mirror`;
  }
}
