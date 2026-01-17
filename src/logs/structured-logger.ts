/**
 * ABOUTME: Structured logger for headless/CI output mode.
 * Provides consistent log format: [timestamp] [level] [component] message
 * Used by the --no-tui / --headless mode for machine-parseable output.
 */

/**
 * Log levels supported by the structured logger.
 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

/**
 * Log components that categorize log messages.
 */
export type LogComponent =
  | 'progress' // Iteration progress updates
  | 'agent' // Agent output (stdout/stderr)
  | 'engine' // Engine lifecycle events
  | 'tracker' // Tracker operations
  | 'session' // Session management
  | 'system'; // System-level messages

/**
 * Configuration for the structured logger.
 */
export interface StructuredLoggerConfig {
  /** Minimum log level to output (default: INFO) */
  minLevel?: LogLevel;

  /** Include timestamps in output (default: true) */
  showTimestamp?: boolean;

  /** Use ISO8601 format for timestamps (default: false, uses HH:mm:ss) */
  isoTimestamp?: boolean;

  /** Stream to write logs to (default: process.stdout) */
  stream?: NodeJS.WritableStream;

  /** Stream to write error logs to (default: process.stderr) */
  errorStream?: NodeJS.WritableStream;
}

/**
 * Level priority for filtering.
 */
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

/**
 * Format timestamp for log output.
 */
function formatTimestamp(date: Date, iso: boolean): string {
  if (iso) {
    return date.toISOString();
  }

  // HH:mm:ss format
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Structured logger for headless mode.
 * Outputs logs in format: [timestamp] [level] [component] message
 */
export class StructuredLogger {
  private config: Required<StructuredLoggerConfig>;

  constructor(config: StructuredLoggerConfig = {}) {
    this.config = {
      minLevel: config.minLevel ?? 'INFO',
      showTimestamp: config.showTimestamp ?? true,
      isoTimestamp: config.isoTimestamp ?? false,
      stream: config.stream ?? process.stdout,
      errorStream: config.errorStream ?? process.stderr,
    };
  }

  /**
   * Check if a log level should be output.
   */
  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.config.minLevel];
  }

  /**
   * Build the log prefix: [timestamp] [level] [component]
   */
  private buildPrefix(level: LogLevel, component: LogComponent): string {
    const parts: string[] = [];

    if (this.config.showTimestamp) {
      const timestamp = formatTimestamp(new Date(), this.config.isoTimestamp);
      parts.push(`[${timestamp}]`);
    }

    parts.push(`[${level}]`);
    parts.push(`[${component}]`);

    return parts.join(' ');
  }

  /**
   * Write a log message.
   */
  log(level: LogLevel, component: LogComponent, message: string): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const prefix = this.buildPrefix(level, component);
    const line = `${prefix} ${message}\n`;

    // Use errorStream for ERROR and WARN levels
    if (level === 'ERROR' || level === 'WARN') {
      this.config.errorStream.write(line);
    } else {
      this.config.stream.write(line);
    }
  }

  /**
   * Log an INFO message.
   */
  info(component: LogComponent, message: string): void {
    this.log('INFO', component, message);
  }

  /**
   * Log a WARN message.
   */
  warn(component: LogComponent, message: string): void {
    this.log('WARN', component, message);
  }

  /**
   * Log an ERROR message.
   */
  error(component: LogComponent, message: string): void {
    this.log('ERROR', component, message);
  }

  /**
   * Log a DEBUG message.
   */
  debug(component: LogComponent, message: string): void {
    this.log('DEBUG', component, message);
  }

  /**
   * Log agent stdout output with [AGENT] prefix.
   * Agent output is streamed line-by-line with the AGENT component.
   */
  agentOutput(data: string): void {
    // Split into lines and log each one
    const lines = data.split('\n');
    for (const line of lines) {
      // Skip empty lines to reduce noise
      if (line.trim()) {
        this.info('agent', line);
      }
    }
  }

  /**
   * Log agent stderr output with [AGENT] prefix.
   */
  agentError(data: string): void {
    const lines = data.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        this.warn('agent', line);
      }
    }
  }

  /**
   * Log progress update in the specified format.
   * Format: [INFO] [progress] Iteration X/Y: Working on task-id
   */
  progress(
    iteration: number,
    maxIterations: number,
    taskId: string,
    taskTitle: string,
  ): void {
    const iterMax = maxIterations > 0 ? maxIterations.toString() : '∞';
    this.info(
      'progress',
      `Iteration ${iteration}/${iterMax}: Working on ${taskId} - ${taskTitle}`,
    );
  }

  /**
   * Log iteration completion.
   */
  iterationComplete(
    iteration: number,
    taskId: string,
    taskCompleted: boolean,
    durationMs: number,
  ): void {
    const durationSec = Math.round(durationMs / 1000);
    const status = taskCompleted ? 'COMPLETED' : 'in progress';
    this.info(
      'progress',
      `Iteration ${iteration} finished. Task ${taskId}: ${status}. Duration: ${durationSec}s`,
    );
  }

  /**
   * Log iteration failure.
   */
  iterationFailed(
    iteration: number,
    taskId: string,
    error: string,
    action: string,
  ): void {
    this.error(
      'progress',
      `Iteration ${iteration} FAILED on ${taskId}: ${error} (action: ${action})`,
    );
  }

  /**
   * Log iteration retry.
   */
  iterationRetrying(
    iteration: number,
    taskId: string,
    attempt: number,
    maxRetries: number,
    delayMs: number,
  ): void {
    const delaySec = Math.round(delayMs / 1000);
    this.warn(
      'progress',
      `Retrying iteration ${iteration} on ${taskId}: attempt ${attempt}/${maxRetries}, waiting ${delaySec}s`,
    );
  }

  /**
   * Log iteration skip.
   */
  iterationSkipped(iteration: number, taskId: string, reason: string): void {
    this.warn(
      'progress',
      `Skipping ${taskId} in iteration ${iteration}: ${reason}`,
    );
  }

  /**
   * Log engine lifecycle events.
   */
  engineStarted(totalTasks: number): void {
    this.info('engine', `Ralph started. Total tasks: ${totalTasks}`);
  }

  engineStopped(
    reason: string,
    totalIterations: number,
    tasksCompleted: number,
  ): void {
    this.info(
      'engine',
      `Ralph stopped. Reason: ${reason}. Iterations: ${totalIterations}, Tasks completed: ${tasksCompleted}`,
    );
  }

  enginePaused(currentIteration: number): void {
    this.info(
      'engine',
      `Paused at iteration ${currentIteration}. Use "ralph-tui resume" to continue.`,
    );
  }

  engineResumed(fromIteration: number): void {
    this.info('engine', `Resumed from iteration ${fromIteration}`);
  }

  allComplete(totalCompleted: number, totalIterations: number): void {
    this.info(
      'engine',
      `All tasks complete! Total: ${totalCompleted} tasks in ${totalIterations} iterations.`,
    );
  }

  /**
   * Log session events.
   */
  sessionCreated(sessionId: string, agent: string, tracker: string): void {
    this.info(
      'session',
      `Session ${sessionId} created. Agent: ${agent}, Tracker: ${tracker}`,
    );
  }

  sessionResumed(sessionId: string): void {
    this.info('session', `Session ${sessionId} resumed`);
  }

  /**
   * Log task selection.
   */
  taskSelected(taskId: string, taskTitle: string, iteration: number): void {
    this.debug(
      'tracker',
      `Selected task ${taskId} for iteration ${iteration}: ${taskTitle}`,
    );
  }

  /**
   * Log task completion.
   */
  taskCompleted(taskId: string, iteration: number): void {
    this.info('tracker', `Task ${taskId} completed in iteration ${iteration}`);
  }
}

/**
 * Create a structured logger with default config.
 */
export function createStructuredLogger(
  config?: StructuredLoggerConfig,
): StructuredLogger {
  return new StructuredLogger(config);
}
