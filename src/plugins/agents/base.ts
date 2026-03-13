/**
 * ABOUTME: Abstract base class for agent plugins.
 * Provides common functionality and default implementations that plugins can override.
 * Plugins can extend this class to reduce boilerplate for CLI-based AI agents.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, appendFileSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { isAbsolute, join } from 'node:path';

/** Debug log helper - writes to file to avoid TUI interference */
function debugLog(msg: string): void {
  // Always log during debugging phase (TODO: restore RALPH_DEBUG check later)
  try {
    const logPath = join(tmpdir(), 'ralph-agent-debug.log');
    appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
  } catch {
    // Ignore write errors
  }
}

/**
 * Find a command's path using the platform-appropriate utility.
 * Uses `where` on Windows and `which` on Unix-like systems.
 * @param command The command name to find
 * @returns Promise with found status and path
 */
export function findCommandPath(
  command: string
): Promise<{ found: boolean; path: string }> {
  return new Promise((resolve) => {
    const isWindows = platform() === 'win32';
    const trimmedCommand = command.trim();
    const normalizedCommand = trimmedCommand.startsWith('"') && trimmedCommand.endsWith('"')
      ? trimmedCommand.slice(1, -1)
      : trimmedCommand;

    const isPathLikeCommand =
      isAbsolute(normalizedCommand) ||
      normalizedCommand.includes('/') ||
      normalizedCommand.includes('\\');

    if (isPathLikeCommand) {
      try {
        accessSync(normalizedCommand);
        return resolve({
          found: true,
          path: normalizedCommand,
        });
      } catch {
        return resolve({ found: false, path: '' });
      }
    }

    const whichCmd = isWindows ? 'where' : 'which';

    const proc = spawn(whichCmd, [command], {
      stdio: ['ignore', 'pipe', 'pipe'],
      // On Windows, 'where' needs shell for proper PATH resolution
      shell: isWindows,
    });

    let stdout = '';

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.on('error', () => {
      resolve({ found: false, path: '' });
    });

    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        // On Windows, 'where' may return multiple paths (one per line)
        // Take the first one
        const firstPath = stdout.trim().split(/\r?\n/)[0] ?? '';
        resolve({ found: true, path: firstPath.trim() });
      } else {
        resolve({ found: false, path: '' });
      }
    });

    // Timeout after 15 seconds
    setTimeout(() => {
      proc.kill();
      resolve({ found: false, path: '' });
    }, 15000);
  });
}

/**
 * Quote a command path for Windows shell execution.
 * When spawn is used with shell: true on Windows, paths containing spaces
 * must be wrapped in double quotes to prevent cmd.exe from splitting them
 * at the space (e.g., "C:\Program Files\..." would be parsed as "C:\Program").
 * Returns the path unchanged if it has no spaces or is already quoted.
 * Callers should only use this when shell: true is set on Windows.
 */
export function quoteForWindowsShell(commandPath: string): string {
  if (!commandPath.includes(' ')) return commandPath;
  // Already quoted
  if (commandPath.startsWith('"') && commandPath.endsWith('"')) return commandPath;
  return `"${commandPath}"`;
}

import { randomUUID } from 'node:crypto';
import type {
  AgentPlugin,
  AgentPluginMeta,
  AgentDetectResult,
  AgentPreflightResult,
  AgentFileContext,
  AgentExecuteOptions,
  AgentExecutionResult,
  AgentExecutionHandle,
  AgentSetupQuestion,
  AgentExecutionStatus,
  AgentSandboxRequirements,
} from './types.js';
import { SandboxWrapper, detectSandboxMode } from '../../sandbox/index.js';
import type { SandboxConfig } from '../../sandbox/types.js';
import { appendWithCharLimit as appendWithSharedCharLimit } from '../../utils/buffer-limits.js';

type ResolvedCommand = {
  command: string;
  executablePath: string;
};

/**
 * Internal representation of a running execution.
 */
interface RunningExecution {
  executionId: string;
  process: ChildProcess;
  startedAt: Date;
  stdout: string;
  stderr: string;
  interrupted: boolean;
  resolve: (result: AgentExecutionResult) => void;
  reject: (error: Error) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
  options?: AgentExecuteOptions;
}

/**
 * Default environment variable exclusion patterns.
 * These patterns are always excluded from agent subprocesses to prevent accidental
 * API key leakage (e.g., from .env files auto-loaded by Bun) which can cause
 * unexpected billing. Use the envPassthrough config option to explicitly allow
 * specific variables matching these patterns through to the agent.
 */
export const DEFAULT_ENV_EXCLUDE_PATTERNS: readonly string[] = [
  '*_API_KEY',
  '*_SECRET_KEY',
  '*_SECRET',
];

/**
 * Maximum number of characters kept in memory per execution stream.
 * This prevents unbounded growth when agents emit large outputs.
 */
const MAX_EXECUTION_STREAM_CHARS = 2_000_000;

/**
 * Prefix added when stream output is truncated in memory.
 */
const STREAM_TRUNCATED_PREFIX = '[...agent output truncated in memory...]\n';

/**
 * Append chunk data while enforcing an in-memory size cap.
 * Keeps the most recent content (tail) to preserve completion markers near the end.
 */
function appendWithCharLimit(
  current: string,
  chunk: string,
  maxChars: number,
  prefix = STREAM_TRUNCATED_PREFIX
): string {
  return appendWithSharedCharLimit(current, chunk, maxChars, prefix);
}

/**
 * Test-only exports for internal helpers.
 * Do not use from production code.
 */
export const __test__ = {
  appendWithCharLimit,
};

/**
 * Abstract base class for agent plugins.
 * Provides sensible defaults and utility methods for executing CLI-based agents.
 */
/**
 * Check if a string matches a glob pattern.
 * Supports * (match any characters) and ? (match single character).
 */
function globMatch(pattern: string, str: string): boolean {
  // Escape regex special characters except * and ?
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // Convert glob wildcards to regex
  const regex = new RegExp(
    '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
  );
  return regex.test(str);
}

/**
 * Filter environment variables by excluding those matching patterns,
 * with an optional passthrough list that overrides exclusions.
 * @param env Environment variables object
 * @param excludePatterns Patterns to exclude (exact names or glob patterns)
 * @param passthroughPatterns Patterns to allow through despite matching exclusions
 * @returns Filtered environment object
 */
function filterEnvByExcludeWithPassthrough(
  env: NodeJS.ProcessEnv,
  excludePatterns: string[],
  passthroughPatterns: string[]
): NodeJS.ProcessEnv {
  if (!excludePatterns || excludePatterns.length === 0) {
    return env;
  }

  const filtered: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    const matchesExclude = excludePatterns.some((pattern) =>
      globMatch(pattern, key)
    );
    if (!matchesExclude) {
      filtered[key] = value;
    } else if (
      passthroughPatterns.length > 0 &&
      passthroughPatterns.some((pattern) => globMatch(pattern, key))
    ) {
      // Passthrough overrides exclusion
      filtered[key] = value;
    }
  }
  return filtered;
}

/**
 * Report of environment variables detected as matching exclusion patterns.
 */
export interface EnvExclusionReport {
  /** Variables that are blocked from reaching the agent process */
  blocked: string[];
  /** Variables that match exclusion patterns but are allowed via passthrough */
  allowed: string[];
}

/**
 * Detect environment variables matching default exclusion patterns and categorize them.
 * Scans the current process.env for vars that would be blocked by default patterns,
 * then splits them into blocked vs allowed (via passthrough).
 *
 * @param env Environment variables to scan (defaults to process.env)
 * @param passthroughPatterns Patterns that override exclusions
 * @param additionalExclude Extra exclusion patterns beyond defaults
 * @returns Report with blocked and allowed variable names
 */
export function getEnvExclusionReport(
  env: NodeJS.ProcessEnv = process.env,
  passthroughPatterns: string[] = [],
  additionalExclude: string[] = []
): EnvExclusionReport {
  const excludePatterns = [...DEFAULT_ENV_EXCLUDE_PATTERNS, ...additionalExclude];
  const blocked: string[] = [];
  const allowed: string[] = [];

  for (const key of Object.keys(env)) {
    const matchesExclude = excludePatterns.some((pattern) =>
      globMatch(pattern, key)
    );
    if (!matchesExclude) {
      continue;
    }

    const matchesPassthrough =
      passthroughPatterns.length > 0 &&
      passthroughPatterns.some((pattern) => globMatch(pattern, key));

    if (matchesPassthrough) {
      allowed.push(key);
    } else {
      blocked.push(key);
    }
  }

  return { blocked: blocked.sort(), allowed: allowed.sort() };
}

/**
 * Format an env exclusion report as human-readable lines for console output.
 * Always returns output so users can see which patterns are active.
 *
 * @param report The exclusion report to format
 * @returns Array of formatted lines
 */
export function formatEnvExclusionReport(report: EnvExclusionReport): string[] {
  const lines: string[] = [];

  if (report.blocked.length === 0 && report.allowed.length === 0) {
    lines.push(
      `Env filter: no vars matched exclusion patterns (${DEFAULT_ENV_EXCLUDE_PATTERNS.join(', ')})`
    );
    return lines;
  }

  lines.push('Env filter:');

  if (report.blocked.length > 0) {
    lines.push(`  Blocked:     ${report.blocked.join(', ')}`);
  }

  if (report.allowed.length > 0) {
    lines.push(`  Passthrough: ${report.allowed.join(', ')}`);
  }

  return lines;
}

export abstract class BaseAgentPlugin implements AgentPlugin {
  abstract readonly meta: AgentPluginMeta;

  protected config: Record<string, unknown> = {};
  protected ready = false;
  protected commandPath?: string;
  protected defaultFlags: string[] = [];
  protected defaultTimeout = 0; // 0 = no timeout
  protected envExclude: string[] = []; // User-configured environment variables to exclude
  protected envPassthrough: string[] = []; // Vars to pass through despite matching defaults

  /** Map of running executions by ID */
  private executions: Map<string, RunningExecution> = new Map();

  /** Current execution (most recent) */
  private currentExecutionId?: string;

  /**
   * Initialize the plugin with configuration.
   * Subclasses should call super.initialize(config) and then perform their own setup.
   */
  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = config;

    // Extract common config options
    if (typeof config.command === 'string') {
      this.commandPath = config.command;
    }

    if (Array.isArray(config.defaultFlags)) {
      this.defaultFlags = config.defaultFlags.filter(
        (f): f is string => typeof f === 'string'
      );
    }

    if (typeof config.timeout === 'number' && config.timeout > 0) {
      this.defaultTimeout = config.timeout;
    }

    if (Array.isArray(config.envExclude)) {
      this.envExclude = config.envExclude.filter(
        (p): p is string => typeof p === 'string' && p.length > 0
      );
    }

    if (Array.isArray(config.envPassthrough)) {
      this.envPassthrough = config.envPassthrough.filter(
        (p): p is string => typeof p === 'string' && p.length > 0
      );
    }

    this.ready = true;
  }

  /**
   * Check if the plugin is ready.
   * Subclasses can override to add additional readiness checks.
   */
  async isReady(): Promise<boolean> {
    return this.ready;
  }

  /**
   * Get a report of environment variables that are blocked vs allowed for this agent.
   * Useful for diagnostics and informing users about which keys from .env files
   * are being filtered.
   */
  getExclusionReport(): EnvExclusionReport {
    return getEnvExclusionReport(process.env, this.envPassthrough, this.envExclude);
  }

  /**
   * Build the ordered command candidate list for auto-detection.
   * The configured command path always has highest priority and is not included here.
   */
  protected getCommandCandidates(): string[] {
    return [
      this.meta.defaultCommand,
      ...(this.meta.commandAliases ?? []),
    ]
      .map((command) => command.trim())
      .filter((command): command is string => command.length > 0);
  }

  /**
   * Format a human-readable list of acceptable command names.
   */
  protected getExpectedCommandNames(): string {
    const candidates = this.getCommandCandidates();
    if (candidates.length === 0) {
      return 'no configured command';
    }

    return candidates.map((command) => `\`${command}\``).join(', ');
  }

  /**
   * Resolve a command path by checking explicit override first, then command candidates.
   * Returns the first discovered command path.
   */
  protected async resolveCommandPath(): Promise<ResolvedCommand | null> {
    if (this.commandPath) {
      const trimmedCommand = this.commandPath.trim();
      if (!trimmedCommand) {
        this.commandPath = undefined;
      } else {
        const findResult = await findCommandPath(trimmedCommand);
        if (!findResult.found) {
          return null;
        }

        return {
          command: trimmedCommand,
          executablePath: findResult.path,
        };
      }
    }

    const candidates = this.getCommandCandidates();
    const resolvedCommands = new Set<string>();
    const uniqueCandidates = candidates.filter((command) => {
      if (resolvedCommands.has(command)) {
        return false;
      }
      resolvedCommands.add(command);
      return true;
    });

    for (const command of uniqueCandidates) {
      const findResult = await findCommandPath(command);
      if (findResult.found) {
        this.commandPath = findResult.path;
        return {
          command,
          executablePath: findResult.path,
        };
      }
    }

    return null;
  }

  /**
   * Build the standard error text for command resolution failures.
   * Override in plugin implementations to include install-specific links.
   */
  protected getCommandNotFoundMessage(): string {
    return `${this.meta.name} not found in PATH. Expected one of ${this.getExpectedCommandNames()}`;
  }

  /**
   * Detect if the agent CLI is available.
   * Default implementation tries to run the command with --version.
   * Subclasses can override for custom detection logic.
   */
  async detect(): Promise<AgentDetectResult> {
    const resolvedCommand = await this.resolveCommandPath();

    if (!resolvedCommand) {
      return {
        available: false,
        error: this.getCommandNotFoundMessage(),
      };
    }

    const command = resolvedCommand.command;
    const commandPath = resolvedCommand.executablePath;

    return new Promise((resolve) => {
      const isWindows = platform() === 'win32';
      const spawnCmd = isWindows ? quoteForWindowsShell(commandPath) : commandPath;
      const proc = spawn(spawnCmd, ['--version'], {
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
        resolve({
          available: false,
          error: `Failed to execute ${command}: ${error.message}`,
        });
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // Try to extract version from output
          const versionMatch = stdout.match(/(\d+\.\d+\.\d+)/);
          resolve({
            available: true,
            version: versionMatch?.[1],
            executablePath: commandPath,
          });
        } else {
          resolve({
            available: false,
            error: stderr || `${commandPath} exited with code ${code}`,
          });
        }
      });

      // Timeout after 15 seconds for version check
      setTimeout(() => {
        proc.kill();
        resolve({
          available: false,
          error: `Timeout waiting for ${commandPath} --version`,
        });
      }, 15000);
    });
  }

  getSandboxRequirements(): AgentSandboxRequirements {
    return {
      authPaths: [],
      binaryPaths: [],
      runtimePaths: [],
      requiresNetwork: false,
    };
  }

  /**
   * Build the command arguments for execution.
   * Subclasses should override to construct their specific CLI arguments.
   * @param prompt The prompt to send to the agent
   * @param files Optional file context
   * @param options Execution options
   * @returns Array of command-line arguments
   */
  protected abstract buildArgs(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): string[];

  /**
   * Get input to write to stdin after spawning the process.
   * Override in subclasses to provide stdin input (e.g., prompt content).
   * Returning undefined means no stdin input will be written.
   * @param prompt The prompt to send to the agent
   * @param files Optional file context
   * @param options Execution options
   * @returns String to write to stdin, or undefined for no stdin input
   */
  protected getStdinInput(
    _prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string | undefined {
    return undefined;
  }

  /**
   * Execute the agent with a prompt.
   * Uses spawn to run the CLI and capture output.
   */
  execute(
    prompt: string,
    files?: AgentFileContext[],
    options?: AgentExecuteOptions
  ): AgentExecutionHandle {
    const executionId = randomUUID();
    const command = this.commandPath ?? this.meta.defaultCommand;
    const args = this.buildArgs(prompt, files, options);
    const startedAt = new Date();
    const timeout = options?.timeout ?? this.defaultTimeout;

    // Merge environment: apply default + user exclusions, then re-include passthrough vars
    const effectiveExclude = [...DEFAULT_ENV_EXCLUDE_PATTERNS, ...this.envExclude];
    const baseEnv = filterEnvByExcludeWithPassthrough(
      process.env,
      effectiveExclude,
      this.envPassthrough
    );
    const env = {
      ...baseEnv,
      ...options?.env,
    };

    // Merge flags
    const allArgs = [...this.defaultFlags, ...(options?.flags ?? []), ...args];

    // Debug: log the command being executed
    debugLog(`[AGENT] Spawning ${command} with args: ${JSON.stringify(allArgs.slice(0, 10))}... cwd=${options?.cwd}`);

    // Create the promise for completion
    let resolvePromise: (result: AgentExecutionResult) => void;
    let rejectPromise: (error: Error) => void;
    const promise = new Promise<AgentExecutionResult>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    let pendingInterrupt = false;

    const startProcess = (spawnCommand: string, spawnArgs: string[]): void => {
      // Spawn the process
      // Note: On Windows, we need shell: true to execute wrapper scripts (.cmd, .bat, .ps1)
      // On Unix, shell: false avoids shell interpretation of special characters in args
      // The prompt will be passed via stdin if getStdinInput returns content
      const isWindows = platform() === 'win32';
      const quotedCommand = isWindows ? quoteForWindowsShell(spawnCommand) : spawnCommand;
      const proc = spawn(quotedCommand, spawnArgs, {
        cwd: options?.cwd ?? process.cwd(),
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: isWindows,
      });

      // Write to stdin if subclass provides input (e.g., prompt content)
      const stdinInput = this.getStdinInput(prompt, files, options);
      if (stdinInput !== undefined && proc.stdin) {
        proc.stdin.write(stdinInput);
        proc.stdin.end();
      } else if (proc.stdin) {
        // Close stdin if no input to prevent hanging
        proc.stdin.end();
      }

      // Create running execution entry
      const execution: RunningExecution = {
        executionId,
        process: proc,
        startedAt,
        stdout: '',
        stderr: '',
        interrupted: false,
        resolve: resolvePromise!,
        reject: rejectPromise!,
        options,
      };

      this.executions.set(executionId, execution);
      this.currentExecutionId = executionId;

      // Notify start callback
      options?.onStart?.(executionId);

      // Handle stdout
      proc.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        execution.stdout = appendWithCharLimit(
          execution.stdout,
          text,
          MAX_EXECUTION_STREAM_CHARS
        );
        options?.onStdout?.(text);
      });

      // Handle stderr
      proc.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        execution.stderr = appendWithCharLimit(
          execution.stderr,
          text,
          MAX_EXECUTION_STREAM_CHARS
        );
        options?.onStderr?.(text);
      });

      // Handle process error
      proc.on('error', (error) => {
        this.completeExecution(executionId, 'failed', undefined, error.message);
      });

      // Handle process exit
      proc.on('close', (code, signal) => {
        // Debug: log close event
        if (process.env.RALPH_DEBUG) {
          debugLog(`[DEBUG] Process close: code=${code}, signal=${signal}, execId=${executionId}`);
        }

        // Determine status
        let status: AgentExecutionStatus;
        if (execution.interrupted) {
          status = 'interrupted';
        } else if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          status = execution.timeoutId ? 'timeout' : 'interrupted';
        } else if (code === 0) {
          status = 'completed';
        } else {
          status = 'failed';
        }

        this.completeExecution(executionId, status, code ?? undefined);
      });

      // Backup: also listen for 'exit' event in case 'close' doesn't fire
      proc.on('exit', (code, signal) => {
        if (process.env.RALPH_DEBUG) {
          debugLog(`[DEBUG] Process exit: code=${code}, signal=${signal}, execId=${executionId}`);
        }
        // Note: We don't call completeExecution here to avoid double-completion
        // 'close' should fire after 'exit' once stdio streams are closed
      });

      // Set up timeout if specified
      if (timeout > 0) {
        execution.timeoutId = setTimeout(() => {
          if (this.executions.has(executionId)) {
            proc.kill('SIGTERM');
            // Give it 5 seconds to terminate gracefully
            setTimeout(() => {
              if (this.executions.has(executionId)) {
                proc.kill('SIGKILL');
              }
            }, 5000);
          }
        }, timeout);
      }

      if (pendingInterrupt) {
        this.interrupt(executionId);
      }
    };

    const resolveSandboxConfig = async (): Promise<SandboxConfig | undefined> => {
      const sandboxConfig = options?.sandbox;
      if (!sandboxConfig?.enabled) {
        return undefined;
      }

      const mode = sandboxConfig.mode ?? 'auto';
      const resolvedMode = mode === 'auto' ? await detectSandboxMode() : mode;
      return {
        ...sandboxConfig,
        mode: resolvedMode,
      };
    };

    void resolveSandboxConfig()
      .then(async (sandboxConfig) => {
        let spawnCommand = command;
        let spawnArgs = allArgs;

        if (!this.commandPath) {
          const resolvedCommand = await this.resolveCommandPath();
          if (!resolvedCommand) {
            const failedCommandError = this.getCommandNotFoundMessage();
            const endedAt = new Date();
            const result = {
              executionId,
              status: 'failed' as const,
              exitCode: undefined,
              stdout: '',
              stderr: failedCommandError,
              durationMs: endedAt.getTime() - startedAt.getTime(),
              error: failedCommandError,
              interrupted: false,
              startedAt: startedAt.toISOString(),
              endedAt: endedAt.toISOString(),
            };

            if (options?.onEnd) {
              try {
                options.onEnd(result);
              } catch (err) {
                if (process.env.RALPH_DEBUG) {
                  debugLog(`[DEBUG] onEnd hook threw error: ${err instanceof Error ? err.message : String(err)}`);
                }
              }
            }

            resolvePromise!(result);
            return;
          }

          spawnCommand = resolvedCommand.executablePath;
        }

        if (sandboxConfig) {
          const wrapper = new SandboxWrapper(
            sandboxConfig,
            this.getSandboxRequirements()
          );
          const wrapped = wrapper.wrapCommand(spawnCommand, allArgs, {
            cwd: options?.cwd,
          });
          spawnCommand = wrapped.command;
          spawnArgs = wrapped.args;
        }

        startProcess(spawnCommand, spawnArgs);
      })
      .catch((error: Error) => {
        const endedAt = new Date();
        const result = {
          executionId,
          status: 'failed' as const,
          exitCode: undefined,
          stdout: '',
          stderr: error.message,
          durationMs: endedAt.getTime() - startedAt.getTime(),
          error: error.message,
          interrupted: false,
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
        };

        // Call onEnd lifecycle hook before resolving (same pattern as completeExecution)
        if (options?.onEnd) {
          try {
            options.onEnd(result);
          } catch (err) {
            if (process.env.RALPH_DEBUG) {
              debugLog(`[DEBUG] onEnd hook threw error: ${err instanceof Error ? err.message : String(err)}`);
            }
            // Swallow error - always proceed to resolve
          }
        }

        resolvePromise!(result);
      });

    // Return the handle
    return {
      executionId,
      promise,
      interrupt: () => {
        if (this.executions.has(executionId)) {
          return this.interrupt(executionId);
        }
        pendingInterrupt = true;
        return true;
      },
      isRunning: () => this.executions.has(executionId),
    };
  }

  /**
   * Complete an execution and resolve its promise.
   */
  private completeExecution(
    executionId: string,
    status: AgentExecutionStatus,
    exitCode?: number,
    error?: string
  ): void {
    const execution = this.executions.get(executionId);
    if (!execution) {
      if (process.env.RALPH_DEBUG) {
        debugLog(`[DEBUG] completeExecution: execution not found for ${executionId}`);
      }
      return;
    }

    if (process.env.RALPH_DEBUG) {
      debugLog(`[DEBUG] completeExecution: status=${status}, exitCode=${exitCode}, execId=${executionId}`);
    }

    // Clear timeout if set
    if (execution.timeoutId) {
      clearTimeout(execution.timeoutId);
    }

    const endedAt = new Date();
    const durationMs = endedAt.getTime() - execution.startedAt.getTime();

    const result: AgentExecutionResult = {
      executionId,
      status,
      exitCode,
      stdout: execution.stdout,
      stderr: execution.stderr,
      durationMs,
      error,
      interrupted: execution.interrupted,
      startedAt: execution.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
    };

    // Remove from tracking
    this.executions.delete(executionId);
    if (this.currentExecutionId === executionId) {
      this.currentExecutionId = undefined;
    }

    // Call onEnd lifecycle hook before resolving
    // This allows plugins to flush buffers or perform cleanup
    // Wrap in try/catch so exceptions don't prevent resolution
    if (execution.options?.onEnd) {
      try {
        execution.options.onEnd(result);
      } catch (err) {
        if (process.env.RALPH_DEBUG) {
          debugLog(`[DEBUG] onEnd hook threw error: ${err instanceof Error ? err.message : String(err)}`);
        }
        // Swallow error - always proceed to resolve
      }
    }

    // Resolve the promise
    if (process.env.RALPH_DEBUG) {
      debugLog(`[DEBUG] Resolving promise for ${executionId}, stdout length=${result.stdout.length}`);
    }
    execution.resolve(result);
  }

  /**
   * Interrupt a running execution by ID.
   */
  interrupt(executionId: string): boolean {
    const execution = this.executions.get(executionId);
    if (!execution) {
      return false;
    }

    execution.interrupted = true;
    execution.process.kill('SIGTERM');

    // Force kill after 5 seconds if still running
    setTimeout(() => {
      if (this.executions.has(executionId)) {
        execution.process.kill('SIGKILL');
      }
    }, 5000);

    return true;
  }

  /**
   * Interrupt all running executions.
   */
  interruptAll(): void {
    for (const executionId of this.executions.keys()) {
      this.interrupt(executionId);
    }
  }

  /**
   * Get the current (most recent) execution handle.
   */
  getCurrentExecution(): AgentExecutionHandle | undefined {
    if (!this.currentExecutionId) {
      return undefined;
    }

    const execution = this.executions.get(this.currentExecutionId);
    if (!execution) {
      return undefined;
    }

    const executionId = this.currentExecutionId;
    return {
      executionId,
      promise: new Promise((resolve, reject) => {
        execution.resolve = resolve;
        execution.reject = reject;
      }),
      interrupt: () => this.interrupt(executionId),
      isRunning: () => this.executions.has(executionId),
    };
  }

  /**
   * Get setup questions for configuring this plugin.
   * Subclasses should override to provide their specific questions.
   */
  getSetupQuestions(): AgentSetupQuestion[] {
    return [
      {
        id: 'command',
        prompt: 'Path to agent executable:',
        type: 'path',
        default: this.meta.defaultCommand,
        required: false,
        help: `Path to the ${this.meta.name} executable (leave empty to use PATH)`,
      },
      {
        id: 'timeout',
        prompt: 'Default execution timeout (seconds):',
        type: 'text',
        default: '0',
        required: false,
        pattern: '^\\d+$',
        help: 'Maximum execution time in seconds (0 = no timeout)',
      },
    ];
  }

  /**
   * Validate setup answers.
   * Default implementation accepts all answers.
   * Subclasses should override for validation.
   */
  async validateSetup(
    _answers: Record<string, unknown>
  ): Promise<string | null> {
    return null;
  }

  /**
   * Validate a model name for this agent.
   * Default implementation accepts any model (returns null).
   * Subclasses should override for agent-specific validation.
   */
  validateModel(_model: string): string | null {
    return null;
  }

  /**
   * Run a preflight check to verify the agent is fully operational.
   * Default implementation runs a minimal test prompt and checks for any response.
   * Subclasses can override for agent-specific preflight logic.
   *
   * @param options Optional configuration for the preflight check
   * @returns Preflight result with success status and any error/suggestion
   */
  async preflight(
    options?: { timeout?: number }
  ): Promise<AgentPreflightResult> {
    const startTime = Date.now();
    const timeout = options?.timeout ?? 15000; // Default 15 second timeout

    try {
      // First ensure detect passes
      const detection = await this.detect();
      if (!detection.available) {
        return {
          success: false,
          error: detection.error ?? 'Agent not available',
          suggestion: `Make sure ${this.meta.name} is installed and accessible`,
          durationMs: Date.now() - startTime,
        };
      }

      // Run a minimal test prompt
      const testPrompt = 'Respond with exactly: PREFLIGHT_OK';
      let stdoutCapture = '';
      let stderrCapture = '';

      const handle = this.execute(testPrompt, [], {
        timeout,
        onStdout: (data: string) => {
          stdoutCapture += data;
        },
        onStderr: (data: string) => {
          stderrCapture += data;
        },
      });

      const result = await handle.promise;
      const durationMs = Date.now() - startTime;

      // Check if we got any meaningful response
      if (result.status === 'completed' && stdoutCapture.length > 0) {
        return {
          success: true,
          durationMs,
          stdout: stdoutCapture,
        };
      }

      // Build detailed error message for failures
      const buildErrorDetails = (baseError: string): string => {
        const details: string[] = [baseError];
        if (result.exitCode !== undefined && result.exitCode !== 0) {
          details.push(`exit code ${result.exitCode}`);
        }
        if (stderrCapture.trim()) {
          // Truncate stderr if too long, but include first meaningful part
          const truncatedStderr = stderrCapture.trim().slice(0, 500);
          details.push(`stderr: ${truncatedStderr}`);
        }
        return details.join(' - ');
      };

      if (result.status === 'timeout') {
        return {
          success: false,
          error: buildErrorDetails('Agent timed out without responding'),
          suggestion: this.getPreflightSuggestion(),
          durationMs,
          exitCode: result.exitCode,
          stderr: stderrCapture,
          stdout: stdoutCapture,
        };
      }

      if (result.status === 'failed') {
        return {
          success: false,
          error: buildErrorDetails(result.error ?? 'Agent execution failed'),
          suggestion: this.getPreflightSuggestion(),
          durationMs,
          exitCode: result.exitCode,
          stderr: stderrCapture,
          stdout: stdoutCapture,
        };
      }

      return {
        success: false,
        error: buildErrorDetails('Agent did not produce any output'),
        suggestion: this.getPreflightSuggestion(),
        durationMs,
        exitCode: result.exitCode,
        stderr: stderrCapture,
        stdout: stdoutCapture,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        suggestion: this.getPreflightSuggestion(),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Get agent-specific suggestions for preflight failures.
   * Subclasses should override to provide helpful guidance.
   */
  protected getPreflightSuggestion(): string {
    return `Verify ${this.meta.name} is properly configured and can respond to prompts`;
  }

  /**
   * Clean up resources.
   * Interrupts all running executions.
   */
  async dispose(): Promise<void> {
    this.interruptAll();
    this.ready = false;
  }
}
