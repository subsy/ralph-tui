/**
 * ABOUTME: Logs command for ralph-tui.
 * List, view, filter, and clean up iteration output logs.
 */

import {
  listIterationLogs,
  getIterationLogByNumber,
  getIterationLogsByTask,
  cleanupIterationLogs,
  hasIterationLogs,
  getIterationLogCount,
  getIterationLogsDiskUsage,
  getIterationsDir,
} from '../logs/index.js';
import type { IterationLogSummary, IterationLog } from '../logs/index.js';

/**
 * Format duration in human-readable form.
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Format date for display.
 */
function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString();
}

/**
 * Format file size in human-readable form.
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Get status icon for iteration status.
 */
function getStatusIcon(status: string): string {
  switch (status) {
    case 'completed':
      return '✓';
    case 'failed':
      return '✗';
    case 'interrupted':
      return '⊘';
    case 'skipped':
      return '⊖';
    case 'running':
      return '▶';
    default:
      return '○';
  }
}

/**
 * Truncate text with ellipsis.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Parse command line arguments for logs command.
 */
export interface LogsArgs {
  /** View specific iteration by number */
  iteration?: number;

  /** View iterations for a specific task */
  taskId?: string;

  /** Clean up old logs */
  clean: boolean;

  /** Number of logs to keep when cleaning */
  keep: number;

  /** Dry run for clean operation */
  dryRun: boolean;

  /** Working directory */
  cwd: string;

  /** Show detailed output */
  verbose: boolean;
}

/**
 * Parse logs command arguments.
 */
export function parseLogsArgs(args: string[]): LogsArgs {
  const result: LogsArgs = {
    clean: false,
    keep: 10,
    dryRun: false,
    cwd: process.cwd(),
    verbose: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--iteration' || arg === '-i') {
      const value = args[i + 1];
      if (value && !value.startsWith('-')) {
        result.iteration = parseInt(value, 10);
        i++;
      }
    } else if (arg === '--task' || arg === '-t') {
      const value = args[i + 1];
      if (value && !value.startsWith('-')) {
        result.taskId = value;
        i++;
      }
    } else if (arg === '--clean') {
      result.clean = true;
    } else if (arg === '--keep') {
      const value = args[i + 1];
      if (value && !value.startsWith('-')) {
        result.keep = parseInt(value, 10);
        i++;
      }
    } else if (arg === '--dry-run') {
      result.dryRun = true;
    } else if (arg === '--cwd') {
      const value = args[i + 1];
      if (value && !value.startsWith('-')) {
        result.cwd = value;
        i++;
      }
    } else if (arg === '--verbose' || arg === '-v') {
      result.verbose = true;
    }
  }

  return result;
}

/**
 * Display a single iteration log in detail.
 */
function displayIterationLog(log: IterationLog, verbose: boolean): void {
  const { metadata, stdout, stderr } = log;

  console.log('');
  console.log(
    '═══════════════════════════════════════════════════════════════',
  );
  console.log(`  Iteration ${metadata.iteration}: ${metadata.taskTitle}`);
  console.log(
    '═══════════════════════════════════════════════════════════════',
  );
  console.log('');

  // Metadata section
  console.log('  Metadata');
  console.log('  ────────');
  console.log(`  Task ID:        ${metadata.taskId}`);
  console.log(
    `  Status:         ${getStatusIcon(metadata.status)} ${metadata.status}`,
  );
  console.log(`  Task Completed: ${metadata.taskCompleted ? 'Yes' : 'No'}`);
  console.log(`  Promise Found:  ${metadata.promiseComplete ? 'Yes' : 'No'}`);
  console.log(`  Started:        ${formatDate(metadata.startedAt)}`);
  console.log(`  Ended:          ${formatDate(metadata.endedAt)}`);
  console.log(`  Duration:       ${formatDuration(metadata.durationMs)}`);

  if (metadata.error) {
    console.log(`  Error:          ${metadata.error}`);
  }

  if (metadata.agentPlugin) {
    console.log(`  Agent:          ${metadata.agentPlugin}`);
  }
  if (metadata.model) {
    console.log(`  Model:          ${metadata.model}`);
  }
  if (metadata.epicId) {
    console.log(`  Epic:           ${metadata.epicId}`);
  }

  console.log('');
  console.log(`  Log File: ${log.filePath}`);
  console.log('');

  // Output section
  console.log('  Agent Output');
  console.log('  ────────────');
  console.log('');

  if (stdout && stdout.trim()) {
    if (verbose) {
      console.log(stdout);
    } else {
      // Show first 50 lines in non-verbose mode
      const lines = stdout.split('\n');
      const preview = lines.slice(0, 50).join('\n');
      console.log(preview);
      if (lines.length > 50) {
        console.log('');
        console.log(
          `  ... (${lines.length - 50} more lines, use --verbose to see all)`,
        );
      }
    }
  } else {
    console.log('  (no stdout output)');
  }

  if (stderr && stderr.trim()) {
    console.log('');
    console.log('  stderr');
    console.log('  ──────');
    console.log('');
    if (verbose) {
      console.log(stderr);
    } else {
      const lines = stderr.split('\n');
      const preview = lines.slice(0, 20).join('\n');
      console.log(preview);
      if (lines.length > 20) {
        console.log('');
        console.log(`  ... (${lines.length - 20} more lines)`);
      }
    }
  }

  console.log('');
  console.log(
    '───────────────────────────────────────────────────────────────',
  );
  console.log('');
}

/**
 * Display a list of iteration log summaries.
 */
function displayLogList(summaries: IterationLogSummary[]): void {
  if (summaries.length === 0) {
    console.log('No iteration logs found.');
    return;
  }

  console.log('');
  console.log(
    '═══════════════════════════════════════════════════════════════',
  );
  console.log(
    '                     Iteration Logs                            ',
  );
  console.log(
    '═══════════════════════════════════════════════════════════════',
  );
  console.log('');

  // Table header
  console.log(
    '  #    Status  Task ID              Title                        Duration',
  );
  console.log(
    '  ─────────────────────────────────────────────────────────────────────────',
  );

  for (const summary of summaries) {
    const icon = getStatusIcon(summary.status);
    const iter = String(summary.iteration).padStart(3, ' ');
    const status = `${icon} ${summary.status.padEnd(10)}`;
    const taskId = truncate(summary.taskId, 18).padEnd(18);
    const title = truncate(summary.taskTitle, 28).padEnd(28);
    const duration = formatDuration(summary.durationMs);

    console.log(`  ${iter}  ${status} ${taskId} ${title} ${duration}`);
  }

  console.log('');
  console.log(`  Total: ${summaries.length} iteration(s)`);
  console.log('');
}

/**
 * Execute the logs command.
 */
export async function executeLogsCommand(args: string[]): Promise<void> {
  const parsedArgs = parseLogsArgs(args);
  const { cwd, iteration, taskId, clean, keep, dryRun, verbose } = parsedArgs;

  // Handle --clean operation
  if (clean) {
    await executeCleanLogs(cwd, keep, dryRun);
    return;
  }

  // Check if any logs exist
  const hasLogs = await hasIterationLogs(cwd);
  if (!hasLogs) {
    console.log('');
    console.log('No iteration logs found.');
    console.log('');
    console.log(`Logs are saved to: ${getIterationsDir(cwd)}`);
    console.log('Run ralph-tui to generate logs.');
    console.log('');
    return;
  }

  // View specific iteration
  if (iteration !== undefined) {
    const log = await getIterationLogByNumber(cwd, iteration);
    if (!log) {
      console.error(`Iteration ${iteration} not found.`);
      process.exit(1);
    }
    displayIterationLog(log, verbose);
    return;
  }

  // View iterations for a specific task
  if (taskId !== undefined) {
    const logs = await getIterationLogsByTask(cwd, taskId);
    if (logs.length === 0) {
      console.log(`No iterations found for task: ${taskId}`);
      return;
    }

    console.log('');
    console.log(`Found ${logs.length} iteration(s) for task: ${taskId}`);
    console.log('');

    for (const log of logs) {
      displayIterationLog(log, verbose);
    }
    return;
  }

  // Default: list all logs
  const summaries = await listIterationLogs(cwd);
  displayLogList(summaries);

  // Show disk usage
  const diskUsage = await getIterationLogsDiskUsage(cwd);
  const count = await getIterationLogCount(cwd);
  console.log(`  Disk usage: ${formatSize(diskUsage)} in ${count} log file(s)`);
  console.log('');
  console.log('  Commands:');
  console.log('    ralph-tui logs --iteration 5        View iteration 5');
  console.log('    ralph-tui logs --task US-005        View logs for task');
  console.log('    ralph-tui logs --clean --keep 10    Clean old logs');
  console.log('');
}

/**
 * Execute the logs clean operation.
 */
async function executeCleanLogs(
  cwd: string,
  keep: number,
  dryRun: boolean,
): Promise<void> {
  const count = await getIterationLogCount(cwd);

  if (count === 0) {
    console.log('No iteration logs to clean.');
    return;
  }

  if (count <= keep) {
    console.log(
      `Only ${count} log(s) found, keeping all (threshold: ${keep}).`,
    );
    return;
  }

  const result = await cleanupIterationLogs(cwd, { keep, dryRun });

  if (dryRun) {
    console.log('');
    console.log('Dry run - no files deleted.');
    console.log('');
    console.log(`Would delete: ${result.deletedCount} log(s)`);
    console.log(`Would keep:   ${result.keptCount} log(s)`);
    console.log('');
    if (result.deletedFiles.length > 0) {
      console.log('Files that would be deleted:');
      for (const file of result.deletedFiles) {
        console.log(`  - ${file}`);
      }
    }
  } else {
    console.log('');
    console.log(`Deleted: ${result.deletedCount} log(s)`);
    console.log(`Kept:    ${result.keptCount} log(s)`);
    console.log('');
  }
}

/**
 * Print logs command help.
 */
export function printLogsHelp(): void {
  console.log(`
ralph-tui logs - View and manage iteration output logs

Usage: ralph-tui logs [options]

Options:
  --iteration, -i <n>   View a specific iteration by number
  --task, -t <id>       View all iterations for a task ID
  --clean               Clean up old logs
  --keep <n>            Number of logs to keep when cleaning (default: 10)
  --dry-run             Show what would be deleted without deleting
  --verbose, -v         Show full output (not truncated)
  --cwd <path>          Working directory (default: current directory)

Description:
  Lists iteration output logs saved during ralph-tui execution.
  Logs are stored in .ralph-tui/iterations/ and include:
  - Timestamp and duration
  - Task ID and title
  - Full agent stdout/stderr
  - Completion status and outcome

Examples:
  ralph-tui logs                        # List all iteration logs
  ralph-tui logs --iteration 5          # View iteration 5 in detail
  ralph-tui logs -i 5                   # Shorthand for above
  ralph-tui logs --task US-005          # View all iterations for US-005
  ralph-tui logs -t US-005              # Shorthand for above
  ralph-tui logs --clean --keep 10      # Delete all but 10 most recent logs
  ralph-tui logs --clean --dry-run      # Preview cleanup without deleting
`);
}
