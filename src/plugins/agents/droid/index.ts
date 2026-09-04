/**
 * ABOUTME: Factory Droid agent plugin implementation.
 * Runs the droid CLI in non-interactive mode for Ralph task execution.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { platform } from 'node:os';
import {
  BaseAgentPlugin,
  debugLog,
  quoteForWindowsShell,
  STDIO_DRAIN_GRACE_PERIOD_MS,
  STDIO_DRAIN_MAX_WAIT_MS,
} from '../base.js';
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
import { extractAgentTextFromEvents } from '../output-formatting.js';
import {
  createDroidStreamingJsonlParser,
  parseDroidMessageToEvents,
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

  extractAgentText(stdout: string): string | undefined {
    const parser = createDroidStreamingJsonlParser();
    parser.push(stdout);
    parser.flush();
    const messages = parser.getState().messages;
    if (messages.length === 0) return undefined;

    const events = messages.flatMap((message) => parseDroidMessageToEvents(message));
    return extractAgentTextFromEvents(events);
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
      proc = spawn(quoteForWindowsShell(command), allArgs, {
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
    let completed = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let drainFallbackId: ReturnType<typeof setTimeout> | undefined;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let exitAt: number | undefined;

    options?.onStart?.(executionId);

    const clearDrainFallback = (): void => {
      if (drainFallbackId !== undefined) {
        clearTimeout(drainFallbackId);
        drainFallbackId = undefined;
      }
    };

    const deriveExitStatus = (
      code: number | null,
      signal: NodeJS.Signals | null
    ): AgentExecutionStatus => {
      if (interrupted) {
        return 'interrupted';
      }
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        return timeoutId ? 'timeout' : 'interrupted';
      }
      if (code === 0) {
        return 'completed';
      }
      return 'failed';
    };

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      options?.onStdout?.(text);
      if (drainFallbackId !== undefined) {
        scheduleDrainFallback();
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      options?.onStderr?.(text);
      if (drainFallbackId !== undefined) {
        scheduleDrainFallback();
      }
    });

    const complete = (status: AgentExecutionStatus, exitCode?: number, error?: string) => {
      if (completed) {
        return;
      }
      completed = true;
      if (timeoutId) clearTimeout(timeoutId);
      clearDrainFallback();
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

    const scheduleDrainFallback = (): void => {
      if (completed) {
        return;
      }
      clearDrainFallback();
      const remainingBudget = (exitAt ?? Date.now()) + STDIO_DRAIN_MAX_WAIT_MS - Date.now();
      const delay = Math.min(STDIO_DRAIN_GRACE_PERIOD_MS, remainingBudget);
      const finalize = (): void => {
        drainFallbackId = undefined;
        if (completed) {
          return;
        }
        if (process.env.RALPH_DEBUG) {
          debugLog(
            `[DEBUG] Process stdio stayed open after drain: code=${exitCode}, ` +
              `signal=${exitSignal}, execId=${executionId}`
          );
        }
        complete(deriveExitStatus(exitCode, exitSignal), exitCode ?? undefined);
        proc.stdout?.destroy();
        proc.stderr?.destroy();
      };

      if (delay <= 0) {
        finalize();
        return;
      }
      drainFallbackId = setTimeout(finalize, delay);
    };

    proc.on('error', (error) => {
      complete('failed', undefined, error.message);
    });

    proc.on('close', (code, signal) => {
      complete(deriveExitStatus(code, signal), code ?? undefined);
    });

    proc.on('exit', (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      exitAt = Date.now();
      scheduleDrainFallback();
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
