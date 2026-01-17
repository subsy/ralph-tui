/**
 * ABOUTME: Process utility functions.
 * Provides helpers for spawning and managing child processes.
 */

import {
  spawn,
  type SpawnOptions,
  type ChildProcess,
} from 'node:child_process';

/**
 * Result of running a process
 */
export interface ProcessResult {
  /** Exit code (null if killed by signal) */
  exitCode: number | null;
  /** Signal that killed the process (if any) */
  signal: string | null;
  /** Stdout output */
  stdout: string;
  /** Stderr output */
  stderr: string;
  /** Whether the process completed successfully (exit code 0) */
  success: boolean;
}

/**
 * Options for running a process
 */
export interface RunProcessOptions {
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Timeout in milliseconds (0 = no timeout) */
  timeout?: number;
  /** Custom spawn options */
  spawnOptions?: SpawnOptions;
}

/**
 * Run a command and collect output
 */
export async function runProcess(
  command: string,
  args: string[] = [],
  options: RunProcessOptions = {},
): Promise<ProcessResult> {
  const { cwd, env, timeout = 0, spawnOptions = {} } = options;

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      ...spawnOptions,
    });

    let stdout = '';
    let stderr = '';
    let killed = false;
    let timeoutHandle: NodeJS.Timeout | undefined;

    // Set up timeout
    if (timeout > 0) {
      timeoutHandle = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
      }, timeout);
    }

    // Collect stdout
    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    // Collect stderr
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Handle errors
    child.on('error', (error) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve({
        exitCode: null,
        signal: null,
        stdout,
        stderr: stderr + error.message,
        success: false,
      });
    });

    // Handle completion
    child.on('close', (exitCode, signal) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve({
        exitCode,
        signal: killed ? 'SIGTERM' : signal,
        stdout,
        stderr,
        success: exitCode === 0,
      });
    });
  });
}

/**
 * Parse a command string into command and arguments
 */
export function parseCommand(commandStr: string): {
  command: string;
  args: string[];
} {
  const parts = commandStr.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];

  // Remove quotes from parts
  const cleanParts = parts.map((part) => {
    if (
      (part.startsWith('"') && part.endsWith('"')) ||
      (part.startsWith("'") && part.endsWith("'"))
    ) {
      return part.slice(1, -1);
    }
    return part;
  });

  const [command, ...args] = cleanParts;
  return { command: command || '', args };
}

/**
 * Build a command string from command and arguments
 */
export function buildCommand(command: string, args: string[]): string {
  const quotedArgs = args.map((arg) => {
    if (arg.includes(' ') || arg.includes('"')) {
      // Escape quotes and wrap in quotes
      return `"${arg.replace(/"/g, '\\"')}"`;
    }
    return arg;
  });

  return [command, ...quotedArgs].join(' ');
}

/**
 * Kill a process tree (process and all descendants)
 */
export async function killProcessTree(
  pid: number,
  signal: NodeJS.Signals = 'SIGTERM',
): Promise<void> {
  // On Unix, we can use process groups
  // This is a simplified version - full implementation would use ps to find children
  try {
    process.kill(-pid, signal);
  } catch {
    // Process group may not exist, try killing just the process
    try {
      process.kill(pid, signal);
    } catch {
      // Process already dead
    }
  }
}

/**
 * Check if a process is running
 */
export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait for a process to exit
 */
export function waitForProcess(
  child: ChildProcess,
): Promise<{ exitCode: number | null; signal: string | null }> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve({ exitCode: child.exitCode, signal: null });
      return;
    }

    child.on('close', (exitCode, signal) => {
      resolve({ exitCode, signal });
    });
  });
}

/**
 * Get environment variable with fallback
 */
export function getEnv(
  name: string,
  defaultValue?: string,
): string | undefined {
  return process.env[name] ?? defaultValue;
}

/**
 * Get required environment variable, throw if missing
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}
