/**
 * ABOUTME: Factory Droid agent plugin implementation.
 * Runs the droid CLI in non-interactive mode for Ralph task execution.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { platform } from 'node:os';
import { BaseAgentPlugin } from '../base.js';
import type {
  AgentPluginMeta,
  AgentPluginFactory,
  AgentFileContext,
  AgentExecuteOptions,
  AgentExecutionResult,
  AgentExecutionStatus,
} from '../types.js';
import { buildDroidCommandArgs } from './commandBuilder.js';
import { DROID_DEFAULT_COMMAND } from './config.js';
import { DroidAgentConfigSchema, type DroidReasoningEffort } from './schema.js';

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
    supportsSubagentTracing: true,
    structuredOutputFormat: 'jsonl',
  };

  private model?: string;
  private reasoningEffort?: DroidReasoningEffort;
  // Default to true: droid exec cannot show interactive prompts without a TTY
  private skipPermissions = true;
  private enableTracing = true;
  // Track effective subagent tracing support (can be disabled via config)
  private effectiveSupportsSubagentTracing = true;

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
    await super.initialize(config);

    const parsed = DroidAgentConfigSchema.safeParse({
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      skipPermissions: config.skipPermissions,
      enableTracing: config.enableTracing,
    });

    if (!parsed.success) {
      return;
    }

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
    if (!this.enableTracing) {
      this.effectiveSupportsSubagentTracing = false;
    }
  }

  protected buildArgs(
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
      enableTracing: this.enableTracing && options?.subagentTracing === true,
    });
  }

  /**
   * Custom execute that uses 'ignore' for stdin to prevent Ink TTY issues.
   * The droid exec command passes prompt as argument, not stdin, so we don't need stdin.
   * Setting stdin to 'ignore' prevents Ink from trying to set raw mode on a piped stdin.
   */
  override execute(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ) {
    const executionId = randomUUID();
    const command = this.commandPath ?? this.meta.defaultCommand;
    const args = this.buildArgs(prompt, files, options);
    const startedAt = new Date();
    const timeout = options?.timeout ?? this.defaultTimeout;

    // Environment variables to signal non-interactive mode to Ink-based CLIs
    const env = {
      ...process.env,
      ...options?.env,
      CI: 'true',
      TERM: 'dumb',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      // Disable Ink's input handling entirely
      INK_DISABLE_INPUT: '1',
    };

    // IMPORTANT: args[0] is 'exec' subcommand which MUST come first after 'droid'.
    // options.flags (like --model) must come AFTER the subcommand.
    const [subcommand, ...restArgs] = args;
    const allArgs = [subcommand, ...this.defaultFlags, ...(options?.flags ?? []), ...restArgs];

    let resolvePromise: (result: AgentExecutionResult) => void;
    const promise = new Promise<AgentExecutionResult>((resolve) => {
      resolvePromise = resolve;
    });

    // On Linux/macOS, wrap with 'script' to provide a pseudo-TTY for Ink
    // This is needed because droid's Ink UI initializes even in exec mode
    const isWindows = process.platform === 'win32';

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

    let proc;
    if (isWindows) {
      proc = spawn(command, allArgs, {
        cwd: options?.cwd ?? process.cwd(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });
    } else {
      // Use 'script' to create a pseudo-TTY that satisfies Ink's requirements
      // script -q: quiet mode (no "Script started" messages)
      //
      // The prompt (last arg) may contain newlines, so use fullEscape for it.
      // Other args are simple strings, so use simpleEscape.
      const cmdParts = [command, ...allArgs.slice(0, -1)].map(simpleEscape);
      const promptArg = allArgs.length > 0 ? fullEscape(allArgs[allArgs.length - 1]) : '';
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

      proc = spawn('script', scriptArgs, {
        cwd: options?.cwd ?? process.cwd(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }

    // Track execution state
    let stdout = '';
    let stderr = '';
    let interrupted = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    options?.onStart?.(executionId);

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      options?.onStdout?.(text);
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      options?.onStderr?.(text);
    });

    const complete = (status: AgentExecutionStatus, exitCode?: number, error?: string) => {
      if (timeoutId) clearTimeout(timeoutId);
      const endedAt = new Date();
      resolvePromise!({
        executionId,
        status,
        exitCode,
        stdout,
        stderr,
        durationMs: endedAt.getTime() - startedAt.getTime(),
        error,
        interrupted,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
      });
    };

    proc.on('error', (error) => {
      complete('failed', undefined, error.message);
    });

    proc.on('close', (code, signal) => {
      let status: AgentExecutionStatus;
      if (interrupted) {
        status = 'interrupted';
      } else if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        status = timeoutId ? 'timeout' : 'interrupted';
      } else if (code === 0) {
        status = 'completed';
      } else {
        status = 'failed';
      }
      complete(status, code ?? undefined);
    });

    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL');
        }, 5000);
      }, timeout);
    }

    return {
      executionId,
      promise,
      interrupt: () => {
        interrupted = true;
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL');
        }, 5000);
        return true;
      },
      isRunning: () => !proc.killed,
    };
  }
}

const createDroidAgent: AgentPluginFactory = () => new DroidAgentPlugin();

export default createDroidAgent;
