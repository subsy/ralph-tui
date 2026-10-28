/**
 * ABOUTME: Status command for ralph-tui (headless).
 * Displays information about any existing session for CI/scripts.
 * Supports JSON output with --json flag and proper exit codes.
 */

import {
  hasPersistedSession,
  loadPersistedSession,
  getSessionSummary,
  isSessionResumable,
  checkLock,
} from '../session/index.js';
import type { PersistedSessionState } from '../session/persistence.js';
import type { LockCheckResult } from '../session/lock.js';

/**
 * Overall status of Ralph in the current directory
 */
export type RalphStatus =
  | 'running'    // Active lock held by running process
  | 'paused'     // Session paused, resumable
  | 'completed'  // Session completed successfully
  | 'failed'     // Session failed
  | 'no-session'; // No session file exists

/**
 * Exit codes for CI/scripts
 * - 0: completed (success)
 * - 1: running or paused (in progress)
 * - 2: failed or no-session (error state)
 */
export type StatusExitCode = 0 | 1 | 2;

/**
 * JSON output structure for --json flag
 */
export interface StatusJsonOutput {
  /** Overall status */
  status: RalphStatus;

  /** Session details if a session exists */
  session?: {
    /** Session ID */
    id: string;

    /** Session status from file */
    status: string;

    /** Task progress */
    progress: {
      /** Tasks completed */
      completed: number;
      /** Total tasks */
      total: number;
      /** Percentage complete */
      percent: number;
    };

    /** Iteration progress */
    iteration: {
      /** Current iteration number */
      current: number;
      /** Maximum iterations (0 = unlimited) */
      max: number;
    };

    /** Elapsed time in seconds */
    elapsedSeconds: number;

    /** Active tracker plugin name */
    tracker: string;

    /** Active agent plugin name */
    agent: string;

    /** Model being used (if specified) */
    model?: string;

    /** Epic ID (for beads tracker) */
    epicId?: string;

    /** PRD path (for json tracker) */
    prdPath?: string;

    /** When the session was started (ISO 8601) */
    startedAt: string;

    /** When the session was last updated (ISO 8601) */
    updatedAt: string;

    /** Whether the session can be resumed */
    resumable: boolean;
  };

  /** Lock status */
  lock?: {
    /** Whether a lock is held */
    isLocked: boolean;
    /** Whether the lock is stale (process not running) */
    isStale: boolean;
    /** PID of lock holder */
    pid?: number;
    /** Hostname of lock holder */
    hostname?: string;
  };
}

/**
 * Format duration in human-readable form
 */
function formatDuration(startedAt: string, updatedAt: string): string {
  const start = new Date(startedAt).getTime();
  const end = new Date(updatedAt).getTime();
  const durationMs = end - start;

  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Get elapsed seconds from session timestamps
 */
function getElapsedSeconds(startedAt: string, updatedAt: string): number {
  const start = new Date(startedAt).getTime();
  const end = new Date(updatedAt).getTime();
  return Math.floor((end - start) / 1000);
}

/**
 * Format date for display
 */
function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString();
}

/**
 * Determine the overall Ralph status
 */
function determineStatus(
  session: PersistedSessionState | null,
  lockCheck: LockCheckResult
): RalphStatus {
  // Check if Ralph is actively running (lock held by running process)
  if (lockCheck.isLocked) {
    return 'running';
  }

  // No session file exists
  if (!session) {
    return 'no-session';
  }

  // Session exists - check its status
  switch (session.status) {
    case 'running':
      // Session says running but no lock - crashed or lock is stale
      // Treat as running since session thinks it's running
      return 'running';
    case 'paused':
      return 'paused';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'interrupted':
      // Interrupted is resumable, treat as paused
      return 'paused';
    default:
      return 'no-session';
  }
}

/**
 * Get the exit code for a given status
 */
function getExitCode(status: RalphStatus): StatusExitCode {
  switch (status) {
    case 'completed':
      return 0;
    case 'running':
    case 'paused':
      return 1;
    case 'failed':
    case 'no-session':
      return 2;
  }
}

/**
 * Build JSON output from session and lock data
 */
function buildJsonOutput(
  status: RalphStatus,
  session: PersistedSessionState | null,
  lockCheck: LockCheckResult
): StatusJsonOutput {
  const output: StatusJsonOutput = {
    status,
  };

  // Add session details if available
  if (session) {
    const summary = getSessionSummary(session);
    const progressPercent = summary.totalTasks > 0
      ? Math.round((summary.tasksCompleted / summary.totalTasks) * 100)
      : 0;

    output.session = {
      id: summary.sessionId,
      status: summary.status,
      progress: {
        completed: summary.tasksCompleted,
        total: summary.totalTasks,
        percent: progressPercent,
      },
      iteration: {
        current: summary.currentIteration,
        max: summary.maxIterations,
      },
      elapsedSeconds: getElapsedSeconds(summary.startedAt, summary.updatedAt),
      tracker: summary.trackerPlugin,
      agent: summary.agentPlugin,
      model: session.model,
      epicId: summary.epicId,
      prdPath: summary.prdPath,
      startedAt: summary.startedAt,
      updatedAt: summary.updatedAt,
      resumable: summary.isResumable,
    };
  }

  // Add lock details if available
  if (lockCheck.lock) {
    output.lock = {
      isLocked: lockCheck.isLocked,
      isStale: lockCheck.isStale,
      pid: lockCheck.lock.pid,
      hostname: lockCheck.lock.hostname,
    };
  }

  return output;
}

/**
 * Print human-readable status output
 */
function printHumanStatus(
  status: RalphStatus,
  session: PersistedSessionState | null,
  lockCheck: LockCheckResult
): void {
  // No session
  if (!session && status === 'no-session') {
    console.log('No session found.');
    console.log('');
    console.log('Start a new session with: ralph-tui run');
    return;
  }

  const summary = session ? getSessionSummary(session) : null;
  const resumable = session ? isSessionResumable(session) : false;

  // Display session info
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    Ralph TUI Session Status                    ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  // Status with icon
  const statusIcon = getStatusIcon(status);
  console.log(`  Status:          ${statusIcon} ${status.toUpperCase()}`);

  if (summary) {
    // Session details
    console.log(`  Session ID:      ${summary.sessionId.slice(0, 8)}...`);
    console.log(`  Started:         ${formatDate(summary.startedAt)}`);
    console.log(`  Last Updated:    ${formatDate(summary.updatedAt)}`);
    console.log(`  Elapsed:         ${formatDuration(summary.startedAt, summary.updatedAt)}`);
    console.log('');

    // Progress
    const progressPercent = summary.totalTasks > 0
      ? Math.round((summary.tasksCompleted / summary.totalTasks) * 100)
      : 0;
    const progressBar = createProgressBar(progressPercent, 30);

    console.log('  Progress:');
    console.log(`    ${progressBar} ${progressPercent}%`);
    console.log(`    Tasks: ${summary.tasksCompleted}/${summary.totalTasks} completed`);
    console.log(`    Iteration: ${summary.currentIteration}${summary.maxIterations > 0 ? `/${summary.maxIterations}` : ''}`);
    console.log('');

    // Configuration
    console.log('  Configuration:');
    console.log(`    Agent:         ${summary.agentPlugin}`);
    console.log(`    Tracker:       ${summary.trackerPlugin}`);
    if (session?.model) {
      console.log(`    Model:         ${session.model}`);
    }
    if (summary.epicId) {
      console.log(`    Epic:          ${summary.epicId}`);
    }
    if (summary.prdPath) {
      console.log(`    PRD:           ${summary.prdPath}`);
    }
    console.log('');
  }

  // Lock info if relevant
  if (lockCheck.lock && lockCheck.isLocked) {
    console.log('  Lock:');
    console.log(`    PID:           ${lockCheck.lock.pid}`);
    console.log(`    Host:          ${lockCheck.lock.hostname}`);
    console.log('');
  } else if (lockCheck.lock && lockCheck.isStale) {
    console.log('  ⚠️  Stale lock detected (PID ${lockCheck.lock.pid} not running)');
    console.log('');
  }

  // Iteration history summary
  if (session && session.iterations.length > 0) {
    console.log('  Recent Iterations:');
    const recentIterations = session.iterations.slice(-5);
    for (const iter of recentIterations) {
      const iterStatus = getIterationStatusIcon(iter.status);
      const duration = Math.round(iter.durationMs / 1000);
      console.log(
        `    ${iterStatus} Iteration ${iter.iteration}: ${iter.taskTitle.slice(0, 40)}${iter.taskTitle.length > 40 ? '...' : ''} (${duration}s)`
      );
    }
    if (session.iterations.length > 5) {
      console.log(`    ... and ${session.iterations.length - 5} more`);
    }
    console.log('');
  }

  // Skipped tasks
  if (session && session.skippedTaskIds.length > 0) {
    console.log(`  Skipped Tasks: ${session.skippedTaskIds.length}`);
    console.log('');
  }

  // Actions
  console.log('───────────────────────────────────────────────────────────────');
  if (resumable) {
    console.log('  This session can be resumed.');
    console.log('');
    console.log('  To resume:  ralph-tui resume');
    console.log('  To restart: ralph-tui run --force');
  } else if (status === 'completed') {
    console.log('  This session is complete.');
    console.log('');
    console.log('  To start new: ralph-tui run');
  } else if (status === 'failed') {
    console.log('  This session failed.');
    console.log('');
    console.log('  To restart: ralph-tui run --force');
  } else if (status === 'running') {
    console.log('  Ralph is currently running.');
    console.log('');
    console.log('  To stop:    Use Ctrl+C in the running terminal');
  }
  console.log('───────────────────────────────────────────────────────────────');
  console.log('');
}

/**
 * Get status icon
 */
function getStatusIcon(status: RalphStatus): string {
  switch (status) {
    case 'running':
      return '▶';
    case 'paused':
      return '⏸';
    case 'completed':
      return '✓';
    case 'failed':
      return '✗';
    case 'no-session':
      return '○';
  }
}

/**
 * Get iteration status icon
 */
function getIterationStatusIcon(status: string): string {
  switch (status) {
    case 'completed':
      return '✓';
    case 'failed':
      return '✗';
    case 'interrupted':
      return '⊘';
    case 'skipped':
      return '⊖';
    default:
      return '○';
  }
}

/**
 * Create a progress bar string
 */
function createProgressBar(percent: number, width: number): string {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.round(width)) : 0;
  const normalizedPercent = Number.isFinite(percent)
    ? Math.min(100, Math.max(0, percent))
    : percent === Infinity
      ? 100
      : 0;
  const filledRaw = Math.round((normalizedPercent / 100) * safeWidth);
  const filled = Math.min(safeWidth, Math.max(0, filledRaw));
  const empty = safeWidth - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

export const __test__ = {
  createProgressBar,
};

/**
 * Execute the status command
 */
export async function executeStatusCommand(args: string[]): Promise<void> {
  // Parse arguments
  let cwd = process.cwd();
  let outputJson = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--cwd' && args[i + 1]) {
      cwd = args[i + 1];
      i++; // Skip next arg
    } else if (args[i] === '--json') {
      outputJson = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      printStatusHelp();
      return;
    }
  }

  // Check lock status
  const lockCheck = await checkLock(cwd);

  // Check for session
  const hasSession = await hasPersistedSession(cwd);

  // Load session if exists
  const session = hasSession ? await loadPersistedSession(cwd) : null;

  // Determine overall status
  const status = determineStatus(session, lockCheck);

  // Get exit code
  const exitCode = getExitCode(status);

  // Output based on format
  if (outputJson) {
    const jsonOutput = buildJsonOutput(status, session, lockCheck);
    console.log(JSON.stringify(jsonOutput, null, 2));
  } else {
    printHumanStatus(status, session, lockCheck);
  }

  // Exit with appropriate code
  process.exit(exitCode);
}

/**
 * Print status command help
 */
export function printStatusHelp(): void {
  console.log(`
ralph-tui status - Check session status (headless)

Usage: ralph-tui status [options]

Options:
  --json            Output in JSON format (machine-readable)
  --cwd <path>      Working directory (default: current directory)
  -h, --help        Show this help message

Exit Codes:
  0    Session completed successfully
  1    Session running or paused (in progress)
  2    Session failed or no session exists

Description:
  Shows information about any existing Ralph session including:
  - Current status (running, paused, completed, failed, no-session)
  - Progress (tasks completed, current iteration)
  - Elapsed time
  - Active tracker and agent
  - Configuration (epic/prd)
  - Whether the session can be resumed

  When using --json, the output is a JSON object with structured data
  suitable for CI pipelines and scripts.

Examples:
  ralph-tui status              # Human-readable output
  ralph-tui status --json       # JSON output for scripts
  ralph-tui status --cwd /path  # Check session in specific directory

CI/Script Usage:
  # Check if Ralph is done
  if ralph-tui status --json | jq -e '.status == "completed"' > /dev/null; then
    echo "Ralph completed successfully"
  fi

  # Get task progress
  ralph-tui status --json | jq '.session.progress.percent'
`);
}
