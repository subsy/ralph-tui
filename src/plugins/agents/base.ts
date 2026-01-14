/**
 * ABOUTME: Abstract base class for agent plugins.
 * Provides common functionality and default implementations that plugins can override.
 * Plugins can extend this class to reduce boilerplate for CLI-based AI agents.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Debug log helper - writes to file to avoid TUI interference */
function debugLog(msg: string): void {
  if (process.env.RALPH_DEBUG) {
    try {
      const logPath = join(tmpdir(), 'ralph-agent-debug.log');
      appendFileSync(logPath, `${new Date().toISOString()} ${msg}\n`);
    } catch {
      // Ignore write errors
    }
  }
}
import { randomUUID } from 'node:crypto';
import type {
  AgentPlugin,
  AgentPluginMeta,
  AgentDetectResult,
  AgentFileContext,
  AgentExecuteOptions,
  AgentExecutionResult,
  AgentExecutionHandle,
  AgentSetupQuestion,
  AgentExecutionStatus,
} from './types.js';

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
}

/**
 * Abstract base class for agent plugins.
 * Provides sensible defaults and utility methods for executing CLI-based agents.
 */
export abstract class BaseAgentPlugin implements AgentPlugin {
  abstract readonly meta: AgentPluginMeta;

  protected config: Record<string, unknown> = {};
  protected ready = false;
  protected commandPath?: string;
  protected defaultFlags: string[] = [];
  protected defaultTimeout = 0; // 0 = no timeout

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
   * Detect if the agent CLI is available.
   * Default implementation tries to run the command with --version.
   * Subclasses can override for custom detection logic.
   */
  async detect(): Promise<AgentDetectResult> {
    const command = this.commandPath ?? this.meta.defaultCommand;

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
            executablePath: command,
          });
        } else {
          resolve({
            available: false,
            error: stderr || `${command} exited with code ${code}`,
          });
        }
      });

      // Timeout after 5 seconds for version check
      setTimeout(() => {
        proc.kill();
        resolve({
          available: false,
          error: `Timeout waiting for ${command} --version`,
        });
      }, 5000);
    });
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

    // Merge environment
    const env = {
      ...process.env,
      ...options?.env,
    };

    // Merge flags
    const allArgs = [...this.defaultFlags, ...(options?.flags ?? []), ...args];

    // Create the promise for completion
    let resolvePromise: (result: AgentExecutionResult) => void;
    let rejectPromise: (error: Error) => void;
    const promise = new Promise<AgentExecutionResult>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    // Spawn the process
    // Note: shell: false to avoid shell interpretation of special characters in args
    // The prompt will be passed via stdin if getStdinInput returns content
    const proc = spawn(command, allArgs, {
      cwd: options?.cwd ?? process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
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
    };

    this.executions.set(executionId, execution);
    this.currentExecutionId = executionId;

    // Notify start callback
    options?.onStart?.(executionId);

    // Handle stdout
    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      execution.stdout += text;
      options?.onStdout?.(text);
    });

    // Handle stderr
    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      execution.stderr += text;
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

    // Return the handle
    return {
      executionId,
      promise,
      interrupt: () => this.interrupt(executionId),
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
   * Clean up resources.
   * Interrupts all running executions.
   */
  async dispose(): Promise<void> {
    this.interruptAll();
    this.ready = false;
  }
}
