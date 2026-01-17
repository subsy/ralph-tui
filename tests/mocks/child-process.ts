/**
 * ABOUTME: Mock implementations for child process spawning.
 * Provides controlled mock for testing agent execution without real processes.
 */

import { EventEmitter } from 'node:events';

/**
 * Configuration for a mock process
 */
export interface MockProcessConfig {
  /** Exit code to return */
  exitCode?: number;
  /** Stdout data to emit (can be string or array for chunks) */
  stdout?: string | string[];
  /** Stderr data to emit */
  stderr?: string | string[];
  /** Delay before emitting each chunk (ms) */
  chunkDelay?: number;
  /** Delay before process exits (ms) */
  exitDelay?: number;
  /** Error to emit (for failed spawn) */
  error?: Error;
  /** Whether process should hang (never exit) */
  hang?: boolean;
}

/**
 * Mock child process that simulates spawn behavior
 */
export class MockChildProcess extends EventEmitter {
  public readonly stdout: EventEmitter;
  public readonly stderr: EventEmitter;
  public readonly stdin: { write: () => void; end: () => void };
  public pid: number;
  public killed = false;
  public exitCode: number | null = null;

  private config: MockProcessConfig;
  private timeouts: NodeJS.Timeout[] = [];

  constructor(config: MockProcessConfig = {}) {
    super();
    this.config = config;
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.stdin = {
      write: () => {},
      end: () => {},
    };
    this.pid = Math.floor(Math.random() * 100000);
  }

  /**
   * Start the mock process simulation
   */
  start(): void {
    // Handle spawn error
    if (this.config.error) {
      setImmediate(() => this.emit('error', this.config.error));
      return;
    }

    // Handle hanging process
    if (this.config.hang) {
      return;
    }

    const chunkDelay = this.config.chunkDelay ?? 10;
    const exitDelay = this.config.exitDelay ?? 50;

    // Emit stdout chunks
    const stdoutChunks = this.normalizeOutput(this.config.stdout);
    stdoutChunks.forEach((chunk, i) => {
      const timeout = setTimeout(
        () => this.stdout.emit('data', chunk),
        chunkDelay * i,
      );
      this.timeouts.push(timeout);
    });

    // Emit stderr chunks
    const stderrChunks = this.normalizeOutput(this.config.stderr);
    stderrChunks.forEach((chunk, i) => {
      const timeout = setTimeout(
        () => this.stderr.emit('data', chunk),
        chunkDelay * i,
      );
      this.timeouts.push(timeout);
    });

    // Emit close after all output
    const totalDelay = Math.max(
      chunkDelay * stdoutChunks.length,
      chunkDelay * stderrChunks.length,
    );

    const exitTimeout = setTimeout(() => {
      this.exitCode = this.config.exitCode ?? 0;
      this.stdout.emit('close');
      this.stderr.emit('close');
      this.emit('close', this.exitCode, null);
      this.emit('exit', this.exitCode, null);
    }, totalDelay + exitDelay);

    this.timeouts.push(exitTimeout);
  }

  /**
   * Kill the mock process
   */
  kill(signal?: string): boolean {
    this.killed = true;
    this.clearTimeouts();
    this.exitCode = signal === 'SIGKILL' ? 137 : 143;
    setImmediate(() => {
      this.stdout.emit('close');
      this.stderr.emit('close');
      this.emit('close', this.exitCode, signal ?? 'SIGTERM');
      this.emit('exit', this.exitCode, signal ?? 'SIGTERM');
    });
    return true;
  }

  private normalizeOutput(output?: string | string[]): string[] {
    if (!output) return [];
    if (typeof output === 'string') return [output];
    return output;
  }

  private clearTimeouts(): void {
    for (const timeout of this.timeouts) {
      clearTimeout(timeout);
    }
    this.timeouts = [];
  }
}

/**
 * Factory for creating mock spawn functions
 */
export class MockSpawnFactory {
  private configs: MockProcessConfig[] = [];
  private callIndex = 0;
  public spawnCalls: Array<{
    command: string;
    args: string[];
    options: unknown;
  }> = [];

  /**
   * Set the configuration for the next spawn call
   */
  setNextConfig(config: MockProcessConfig): void {
    this.configs.push(config);
  }

  /**
   * Set configurations for multiple spawn calls
   */
  setConfigs(configs: MockProcessConfig[]): void {
    this.configs = [...configs];
    this.callIndex = 0;
  }

  /**
   * Reset the factory
   */
  reset(): void {
    this.configs = [];
    this.callIndex = 0;
    this.spawnCalls = [];
  }

  /**
   * Create a mock spawn function
   */
  createSpawn(): (
    command: string,
    args: string[],
    options?: unknown,
  ) => MockChildProcess {
    return (command: string, args: string[], options?: unknown) => {
      this.spawnCalls.push({ command, args, options });

      const config = this.configs[this.callIndex] ?? {};
      this.callIndex++;

      const process = new MockChildProcess(config);
      setImmediate(() => process.start());
      return process;
    };
  }
}

/**
 * Create a simple mock spawn function with a single config
 */
export function createMockSpawn(config: MockProcessConfig = {}) {
  const factory = new MockSpawnFactory();
  factory.setNextConfig(config);
  return factory.createSpawn();
}

/**
 * Create a mock spawn that returns successful completion
 */
export function createSuccessfulSpawn(stdout = 'Success') {
  return createMockSpawn({
    exitCode: 0,
    stdout,
    stderr: '',
  });
}

/**
 * Create a mock spawn that returns failure
 */
export function createFailedSpawn(stderr = 'Error', exitCode = 1) {
  return createMockSpawn({
    exitCode,
    stdout: '',
    stderr,
  });
}

/**
 * Create a mock spawn that times out (hangs)
 */
export function createHangingSpawn() {
  return createMockSpawn({ hang: true });
}

/**
 * Create a mock spawn that fails to start
 */
export function createSpawnError(message = 'spawn ENOENT') {
  return createMockSpawn({
    error: new Error(message),
  });
}
