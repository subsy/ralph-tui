/**
 * ABOUTME: Factory Droid agent plugin implementation.
 * Runs the droid CLI in non-interactive mode for Ralph task execution.
 */

import { platform } from 'node:os';
import { BaseAgentPlugin, type AgentLaunchInvocation } from '../base.js';
import type {
  AgentPluginMeta,
  AgentPluginFactory,
  AgentFileContext,
  AgentExecuteOptions,
  AgentSetupQuestion,
} from '../types.js';
import { buildDroidCommandArgs, getDroidOutputFormat } from './commandBuilder.js';
import { DROID_DEFAULT_COMMAND } from './config.js';
import { DroidAgentConfigSchema, type DroidOutputFormat, type DroidReasoningEffort } from './schema.js';
import { extractAgentTextFromEvents, type AgentDisplayEvent } from '../output-formatting.js';
import {
  parseDroidJsonlLine,
  parseDroidCompletionEvents,
} from './outputParser.js';

export class DroidAgentPlugin extends BaseAgentPlugin {
  private readonly baseMeta: AgentPluginMeta = {
    id: 'droid',
    name: 'Factory Droid',
    description: 'Factory Droid AI coding assistant CLI',
    version: '1.0.0',
    author: 'Factory',
    defaultCommand: DROID_DEFAULT_COMMAND,
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false,
    supportsSubagentTracing: false,
    structuredOutputFormat: 'jsonl',
    skillsPaths: {
      personal: '~/.factory/skills',
      repo: '.factory/skills',
    },
  };

  private model?: string;
  private reasoningEffort?: DroidReasoningEffort;
  private outputFormat: DroidOutputFormat = 'stream-json';
  // Default to true: droid exec cannot show interactive prompts without a TTY
  private skipPermissions = true;
  private enableTracing = true;
  // Subagent tracing is not currently supported for Factory Droid
  private effectiveSupportsSubagentTracing = false;

  /**
   * Returns meta with effectiveSupportsSubagentTracing applied.
   * This allows disabling tracing via config without mutating the base meta.
   */
  override get meta(): AgentPluginMeta {
    return {
      ...this.baseMeta,
      supportsSubagentTracing: this.effectiveSupportsSubagentTracing,
    };
  }

  override getSandboxRequirements() {
    return {
      // Droid may store auth/config in these locations
      authPaths: ['~/.droid', '~/.config/droid', '~/.config/gcloud'],
      binaryPaths: ['/usr/local/bin', '~/.local/bin'],
      runtimePaths: [],
      requiresNetwork: true,
    };
  }

  override async initialize(config: Record<string, unknown>): Promise<void> {
    const parsed = DroidAgentConfigSchema.safeParse({
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      outputFormat: config.outputFormat,
      skipPermissions: config.skipPermissions,
      enableTracing: config.enableTracing,
    });

    if (!parsed.success) {
      throw new Error(`[droid] Invalid agent options: ${parsed.error.message}`);
    }

    await super.initialize(config);

    if (typeof parsed.data.model === 'string' && parsed.data.model.length > 0) {
      this.model = parsed.data.model;
    }

    if (parsed.data.reasoningEffort) {
      this.reasoningEffort = parsed.data.reasoningEffort;
    }

    // skipPermissions can be explicitly set to false via config to disable
    if (parsed.data.skipPermissions === false) {
      this.skipPermissions = false;
      console.warn('[droid] Skip permissions disabled - droid may fail if permission prompts are triggered');
    }

    this.enableTracing = parsed.data.enableTracing;
    this.outputFormat = parsed.data.outputFormat;
    if (!this.enableTracing) {
      this.effectiveSupportsSubagentTracing = false;
    }
  }

  protected buildArgs(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): string[] {
    return this.buildExecutionArgs(prompt, files, options);
  }

  private buildExecutionArgs(
    prompt: string,
    _files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): string[] {
    const cwd = options?.cwd ?? process.cwd();
    return buildDroidCommandArgs({
      prompt,
      cwd,
      model: this.model,
      reasoningEffort: this.reasoningEffort,
      skipPermissions: this.skipPermissions,
      outputFormat: this.outputFormat,
      flags: [...this.defaultFlags, ...(options?.flags ?? [])],
    });
  }

  override getSetupQuestions(): AgentSetupQuestion[] {
    return [
      ...super.getSetupQuestions(),
      {
        id: 'outputFormat',
        prompt: 'Output format:',
        type: 'select',
        choices: [
          { value: 'stream-json', label: 'Streaming JSON (default)' },
          { value: 'json', label: 'JSON' },
          { value: 'text', label: 'Plain text (raw completion scanning)' },
        ],
        default: 'stream-json',
        required: false,
        help: 'Structured output keeps tool and diagnostic text out of completion detection. Independent of enableTracing.',
      },
    ];
  }

  /**
   * Get Droid-specific suggestions for preflight failures.
   * Provides actionable guidance for common configuration issues.
   */
  protected override getPreflightSuggestion(): string {
    return (
      'Common fixes for Factory Droid:\n' +
      '  1. Test Droid directly: droid exec "hello"\n' +
      '  2. Verify your API key is configured\n' +
      '  3. Check Droid is installed: droid --version\n' +
      '  4. Ensure you have access to the Factory platform'
    );
  }

  extractAgentText(stdout: string, options?: AgentExecuteOptions): string | undefined {
    const format = getDroidOutputFormat(this.buildExecutionArgs('', undefined, options).slice(1, -1));
    if (format === 'text') {
      return undefined;
    }
    if (format !== 'stream-json' && format !== 'json') {
      return '';
    }

    const lines = format === 'json' ? [stdout] : stdout.split('\n');
    const results = lines.map((raw) => ({ raw, ...parseDroidJsonlLine(raw) }));
    const events = results.flatMap((result): AgentDisplayEvent[] => {
      if (!result.success) {
        return result.error === 'Empty line' ? [] : [{ type: 'system' }];
      }
      return parseDroidCompletionEvents(result.message, result.raw);
    });
    return extractAgentTextFromEvents(events);
  }

  /** Supply Droid's PTY wrapper while inheriting the base execution lifecycle. */
  protected override buildLaunchInvocation(
    command: string,
    args: string[],
    options?: AgentExecuteOptions
  ): AgentLaunchInvocation {
    // Environment variables to signal non-interactive mode to Ink-based CLIs
    const env = {
      CI: 'true',
      TERM: 'dumb',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      // Disable Ink's input handling entirely
      INK_DISABLE_INPUT: '1',
    };

    // On Linux/macOS, wrap with 'script' to provide a pseudo-TTY for Ink
    // This is needed because droid's Ink UI initializes even in exec mode
    const isWindows = platform() === 'win32';

    // Simple shell escape: wrap in single quotes, escape existing single quotes
    const simpleEscape = (s: string): string => {
      return "'" + s.replace(/'/g, "'\\''") + "'";
    };

    // Full escape using $'...' syntax for strings with newlines/special chars
    const fullEscape = (s: string): string => {
      return "$'" + s
        .replace(/\\/g, '\\\\')     // Backslash first
        .replace(/'/g, "\\'")       // Single quotes
        .replace(/\n/g, '\\n')      // Newlines
        .replace(/\r/g, '\\r')      // Carriage returns
        .replace(/\t/g, '\\t')      // Tabs
        + "'";
    };

    if (isWindows) {
      return { command, args, env, stdin: 'ignore', shell: true };
    } else {
      // Use 'script' to create a pseudo-TTY that satisfies Ink's requirements
      // script -q: quiet mode (no "Script started" messages)
      //
      // The prompt (last arg) may contain newlines, so use fullEscape for it.
      // Other args are simple strings, so use simpleEscape.
      const cmdParts = [command, ...args.slice(0, -1)].map(simpleEscape);
      const promptArg = args.length > 0 ? fullEscape(args[args.length - 1]) : '';
      const droidCmd = promptArg ? [...cmdParts, promptArg].join(' ') : cmdParts.join(' ');
      // Prefix with cd to ensure correct working directory (script's subshell may not respect cwd)
      // Use stty -echo to prevent the pseudo-TTY from echoing input back as output
      const targetCwd = options?.cwd ?? process.cwd();
      const shellCmd = `stty -echo 2>/dev/null; cd ${simpleEscape(targetCwd)} && ${droidCmd}`;

      // macOS and Linux have different 'script' command syntax:
      // - Linux: script -q -c "command" /dev/null
      // - macOS: script -q /dev/null sh -c "command"
      const isMacOS = platform() === 'darwin';
      const scriptArgs = isMacOS
        ? ['-q', '/dev/null', 'sh', '-c', shellCmd]
        : ['-q', '-c', shellCmd, '/dev/null'];

      return { command: 'script', args: scriptArgs, env, stdin: 'ignore' };
    }
  }
}

const createDroidAgent: AgentPluginFactory = () => new DroidAgentPlugin();

export default createDroidAgent;
