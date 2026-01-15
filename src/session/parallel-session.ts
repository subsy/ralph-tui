/**
 * ABOUTME: Session management integration for parallel worktree execution.
 * Provides persistence, resume, and crash recovery for parallel execution state.
 * Integrates with Ralph's existing session management to support pause/resume
 * and orphaned worktree detection on restart.
 */

import { join, dirname } from 'node:path';
import {
  readFile,
  writeFile,
  unlink,
  access,
  constants,
  mkdir,
  readdir,
} from 'node:fs/promises';
import { spawn } from 'node:child_process';
import type { SessionStatus } from './types.js';
import type { ParallelTaskStatus, ParallelExecutorConfig } from '../worktree/parallel-executor-types.js';
import type { GraphTask, ParallelWorkUnit } from '../worktree/task-graph-types.js';
import type { ManagedWorktree, WorktreeStatus } from '../worktree/types.js';
import { checkLock } from './lock.js';

/**
 * Parallel session file path relative to cwd
 */
const PARALLEL_SESSION_FILE = '.ralph-tui/parallel-session.json';

/**
 * Persisted state for a single agent in a parallel execution session
 */
export interface PersistedAgentState {
  /** Agent ID */
  agentId: string;

  /** Task being executed */
  taskId: string;

  /** Task title for display */
  taskTitle: string;

  /** Work unit ID this agent belongs to */
  workUnitId: string;

  /** Worktree ID where this agent is running */
  worktreeId: string;

  /** Worktree path */
  worktreePath: string;

  /** Worktree branch */
  worktreeBranch: string;

  /** Agent status */
  status: ParallelTaskStatus;

  /** When the agent started */
  startedAt: string;

  /** When the agent finished (if done) */
  endedAt?: string;

  /** Error message if failed */
  error?: string;
}

/**
 * Persisted state for a worktree in a parallel execution session
 */
export interface PersistedWorktreeState {
  /** Worktree ID */
  id: string;

  /** Worktree name */
  name: string;

  /** Absolute path to the worktree */
  path: string;

  /** Git branch */
  branch: string;

  /** Current status */
  status: WorktreeStatus;

  /** Associated task ID */
  taskId?: string;

  /** Associated agent ID */
  agentId?: string;

  /** When the worktree was created */
  createdAt: string;

  /** Last activity timestamp */
  lastActivityAt: string;
}

/**
 * Persisted state for a parallel execution session
 */
export interface PersistedParallelSessionState {
  /** Schema version for forward compatibility */
  version: 1;

  /** Unique session identifier */
  sessionId: string;

  /** Current session status */
  status: SessionStatus;

  /** Whether this is a parallel execution session */
  isParallelMode: true;

  /** When the session was started (ISO 8601) */
  startedAt: string;

  /** When the session was last updated (ISO 8601) */
  updatedAt: string;

  /** When the session was paused (if paused) */
  pausedAt?: string;

  /** Whether the session is paused */
  isPaused: boolean;

  /** Executor configuration */
  executorConfig: Partial<ParallelExecutorConfig>;

  /** Work units being executed */
  workUnits: Array<{
    id: string;
    name: string;
    priority: number;
    taskIds: string[];
    status: 'pending' | 'running' | 'completed' | 'failed';
  }>;

  /** All tasks in this execution */
  tasks: Array<{
    id: string;
    title: string;
    status: ParallelTaskStatus;
    workUnitId: string;
  }>;

  /** Active agents state */
  agents: PersistedAgentState[];

  /** Active worktrees state */
  worktrees: PersistedWorktreeState[];

  /** Completed task results (for resume) */
  completedTasks: Array<{
    taskId: string;
    success: boolean;
    durationMs: number;
    completedAt: string;
    error?: string;
  }>;

  /** Working directory */
  cwd: string;

  /** Summary statistics */
  stats: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    cancelledTasks: number;
  };
}

/**
 * Result of orphaned worktree detection
 */
export interface OrphanedWorktreeInfo {
  /** Worktree path */
  path: string;

  /** Worktree branch */
  branch: string;

  /** Task ID if known */
  taskId?: string;

  /** Agent ID if known */
  agentId?: string;

  /** When the worktree was created (if known) */
  createdAt?: string;

  /** Whether this worktree exists on disk */
  existsOnDisk: boolean;

  /** Whether this worktree is tracked in git */
  trackedByGit: boolean;
}

/**
 * Result of parallel session recovery
 */
export interface ParallelSessionRecoveryResult {
  /** Whether recovery was needed */
  recoveryNeeded: boolean;

  /** Whether the session was stale (crashed) */
  wasStale: boolean;

  /** Number of agents that were reset */
  resetAgentCount: number;

  /** Orphaned worktrees found */
  orphanedWorktrees: OrphanedWorktreeInfo[];

  /** Previous session status before recovery */
  previousStatus?: SessionStatus;

  /** Recovered session state (if any) */
  recoveredSession?: PersistedParallelSessionState;
}

/**
 * Get the parallel session file path
 */
function getParallelSessionFilePath(cwd: string): string {
  return join(cwd, PARALLEL_SESSION_FILE);
}

/**
 * Check if a parallel session file exists
 */
export async function hasParallelSession(cwd: string): Promise<boolean> {
  const filePath = getParallelSessionFilePath(cwd);
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load persisted parallel session state
 */
export async function loadParallelSession(
  cwd: string
): Promise<PersistedParallelSessionState | null> {
  const filePath = getParallelSessionFilePath(cwd);

  try {
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content) as PersistedParallelSessionState;

    // Validate schema version
    const version = parsed.version ?? 1;
    if (version !== 1) {
      console.warn(
        `Unknown parallel session file version: ${version}. ` +
          'Session may not load correctly.'
      );
    }

    // Ensure version field is set
    parsed.version = 1;
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Save persisted parallel session state
 */
export async function saveParallelSession(
  state: PersistedParallelSessionState
): Promise<void> {
  const filePath = getParallelSessionFilePath(state.cwd);

  // Ensure directory exists
  await mkdir(dirname(filePath), { recursive: true });

  // Update timestamp
  const updatedState: PersistedParallelSessionState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };

  await writeFile(filePath, JSON.stringify(updatedState, null, 2));
}

/**
 * Delete the persisted parallel session file
 */
export async function deleteParallelSession(cwd: string): Promise<boolean> {
  const filePath = getParallelSessionFilePath(cwd);

  try {
    await unlink(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Create a new parallel session state
 */
export function createParallelSession(options: {
  sessionId: string;
  workUnits: ParallelWorkUnit[];
  executorConfig: Partial<ParallelExecutorConfig>;
  cwd: string;
}): PersistedParallelSessionState {
  const now = new Date().toISOString();
  const allTasks = options.workUnits.flatMap((wu) => wu.tasks);

  return {
    version: 1,
    sessionId: options.sessionId,
    status: 'running',
    isParallelMode: true,
    startedAt: now,
    updatedAt: now,
    isPaused: false,
    executorConfig: options.executorConfig,
    workUnits: options.workUnits.map((wu) => ({
      id: wu.id,
      name: wu.name,
      priority: wu.avgPriority,
      taskIds: wu.tasks.map((t) => t.id),
      status: 'pending' as const,
    })),
    tasks: allTasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: 'pending' as ParallelTaskStatus,
      workUnitId: options.workUnits.find((wu) =>
        wu.tasks.some((wt) => wt.id === t.id)
      )!.id,
    })),
    agents: [],
    worktrees: [],
    completedTasks: [],
    cwd: options.cwd,
    stats: {
      totalTasks: allTasks.length,
      completedTasks: 0,
      failedTasks: 0,
      cancelledTasks: 0,
    },
  };
}

/**
 * Add an agent to the parallel session state
 */
export function addAgentToSession(
  state: PersistedParallelSessionState,
  agent: {
    agentId: string;
    task: GraphTask;
    workUnitId: string;
    worktree: ManagedWorktree;
  }
): PersistedParallelSessionState {
  const agentState: PersistedAgentState = {
    agentId: agent.agentId,
    taskId: agent.task.id,
    taskTitle: agent.task.title,
    workUnitId: agent.workUnitId,
    worktreeId: agent.worktree.id,
    worktreePath: agent.worktree.path,
    worktreeBranch: agent.worktree.branch,
    status: 'running',
    startedAt: new Date().toISOString(),
  };

  const worktreeState: PersistedWorktreeState = {
    id: agent.worktree.id,
    name: agent.worktree.name,
    path: agent.worktree.path,
    branch: agent.worktree.branch,
    status: 'in_use',
    taskId: agent.task.id,
    agentId: agent.agentId,
    createdAt: agent.worktree.createdAt.toISOString(),
    lastActivityAt: new Date().toISOString(),
  };

  // Update task status
  const updatedTasks = state.tasks.map((t) => {
    if (t.id === agent.task.id) {
      return { ...t, status: 'running' as ParallelTaskStatus };
    }
    return t;
  });

  // Update work unit status if needed
  const updatedWorkUnits = state.workUnits.map((wu) => {
    if (wu.id === agent.workUnitId && wu.status === 'pending') {
      return { ...wu, status: 'running' as const };
    }
    return wu;
  });

  // Remove existing entry if present (update case)
  const existingAgentIndex = state.agents.findIndex(
    (a) => a.agentId === agent.agentId
  );
  const agents =
    existingAgentIndex >= 0
      ? [
          ...state.agents.slice(0, existingAgentIndex),
          agentState,
          ...state.agents.slice(existingAgentIndex + 1),
        ]
      : [...state.agents, agentState];

  // Same for worktrees
  const existingWtIndex = state.worktrees.findIndex(
    (w) => w.id === agent.worktree.id
  );
  const worktrees =
    existingWtIndex >= 0
      ? [
          ...state.worktrees.slice(0, existingWtIndex),
          worktreeState,
          ...state.worktrees.slice(existingWtIndex + 1),
        ]
      : [...state.worktrees, worktreeState];

  return {
    ...state,
    agents,
    worktrees,
    tasks: updatedTasks,
    workUnits: updatedWorkUnits,
  };
}

/**
 * Update agent status when task completes
 */
export function completeAgentTask(
  state: PersistedParallelSessionState,
  agentId: string,
  result: {
    success: boolean;
    durationMs: number;
    error?: string;
  }
): PersistedParallelSessionState {
  const agent = state.agents.find((a) => a.agentId === agentId);
  if (!agent) {
    return state;
  }

  const now = new Date().toISOString();
  const newStatus: ParallelTaskStatus = result.success ? 'completed' : 'failed';

  // Update agent
  const updatedAgents = state.agents.map((a) => {
    if (a.agentId === agentId) {
      return {
        ...a,
        status: newStatus,
        endedAt: now,
        error: result.error,
      };
    }
    return a;
  });

  // Update task
  const updatedTasks = state.tasks.map((t) => {
    if (t.id === agent.taskId) {
      return { ...t, status: newStatus };
    }
    return t;
  });

  // Add to completed tasks
  const completedTasks = [
    ...state.completedTasks,
    {
      taskId: agent.taskId,
      success: result.success,
      durationMs: result.durationMs,
      completedAt: now,
      error: result.error,
    },
  ];

  // Update stats
  const stats = {
    ...state.stats,
    completedTasks: result.success
      ? state.stats.completedTasks + 1
      : state.stats.completedTasks,
    failedTasks: !result.success
      ? state.stats.failedTasks + 1
      : state.stats.failedTasks,
  };

  // Check if work unit is complete
  const workUnit = state.workUnits.find((wu) => wu.id === agent.workUnitId);
  let updatedWorkUnits = state.workUnits;
  if (workUnit) {
    const workUnitTaskStatuses = updatedTasks.filter((t) =>
      workUnit.taskIds.includes(t.id)
    );
    const allComplete = workUnitTaskStatuses.every(
      (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
    );
    const anyFailed = workUnitTaskStatuses.some((t) => t.status === 'failed');

    if (allComplete) {
      updatedWorkUnits = state.workUnits.map((wu) => {
        if (wu.id === workUnit.id) {
          return { ...wu, status: anyFailed ? ('failed' as const) : ('completed' as const) };
        }
        return wu;
      });
    }
  }

  return {
    ...state,
    agents: updatedAgents,
    tasks: updatedTasks,
    workUnits: updatedWorkUnits,
    completedTasks,
    stats,
  };
}

/**
 * Remove an agent from the session (after cleanup)
 */
export function removeAgentFromSession(
  state: PersistedParallelSessionState,
  agentId: string
): PersistedParallelSessionState {
  const agent = state.agents.find((a) => a.agentId === agentId);
  if (!agent) {
    return state;
  }

  return {
    ...state,
    agents: state.agents.filter((a) => a.agentId !== agentId),
    worktrees: state.worktrees.filter((w) => w.id !== agent.worktreeId),
  };
}

/**
 * Mark session as paused
 */
export function pauseParallelSession(
  state: PersistedParallelSessionState
): PersistedParallelSessionState {
  return {
    ...state,
    status: 'paused',
    isPaused: true,
    pausedAt: new Date().toISOString(),
  };
}

/**
 * Mark session as resumed
 */
export function resumeParallelSessionState(
  state: PersistedParallelSessionState
): PersistedParallelSessionState {
  return {
    ...state,
    status: 'running',
    isPaused: false,
    pausedAt: undefined,
  };
}

/**
 * Mark session as completed
 */
export function completeParallelSession(
  state: PersistedParallelSessionState
): PersistedParallelSessionState {
  return {
    ...state,
    status: 'completed',
    isPaused: false,
  };
}

/**
 * Mark session as failed
 */
export function failParallelSession(
  state: PersistedParallelSessionState,
  _error?: string
): PersistedParallelSessionState {
  return {
    ...state,
    status: 'failed',
    isPaused: false,
  };
}

/**
 * Check if a parallel session is resumable
 */
export function isParallelSessionResumable(
  state: PersistedParallelSessionState
): boolean {
  return (
    state.status === 'paused' ||
    state.status === 'running' ||
    state.status === 'interrupted'
  );
}

/**
 * Execute a git command and return the result
 */
function execGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error(`Git command failed (exit ${code}): ${stderr || stdout}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Detect orphaned worktrees that exist on disk or in git but aren't tracked by a session.
 * Called on restart to offer recovery options.
 */
export async function detectOrphanedWorktrees(
  cwd: string,
  worktreeDir: string = '.worktrees'
): Promise<OrphanedWorktreeInfo[]> {
  const orphaned: OrphanedWorktreeInfo[] = [];
  const worktreesPath = join(cwd, worktreeDir);

  // Load current session to get tracked worktrees
  const session = await loadParallelSession(cwd);
  const trackedWorktreePaths = new Set(
    session?.worktrees.map((w) => w.path) ?? []
  );

  // Get all worktrees tracked by git
  const gitWorktrees: Map<string, { path: string; branch: string }> = new Map();
  try {
    const { stdout } = await execGit(['worktree', 'list', '--porcelain'], cwd);
    const lines = stdout.split('\n');
    let currentPath: string | null = null;
    let currentBranch: string | null = null;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        currentPath = line.substring(9);
      } else if (line.startsWith('branch ')) {
        currentBranch = line.substring(7).replace('refs/heads/', '');
      } else if (line === '' && currentPath && currentBranch) {
        // Only track worktrees in our worktrees directory
        if (currentPath.startsWith(worktreesPath)) {
          gitWorktrees.set(currentPath, { path: currentPath, branch: currentBranch });
        }
        currentPath = null;
        currentBranch = null;
      }
    }
  } catch {
    // Git command failed, continue with filesystem check
  }

  // Check filesystem for worktree directories
  try {
    const entries = await readdir(worktreesPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const wtPath = join(worktreesPath, entry.name);
      const isTracked = trackedWorktreePaths.has(wtPath);

      if (!isTracked) {
        const gitInfo = gitWorktrees.get(wtPath);
        orphaned.push({
          path: wtPath,
          branch: gitInfo?.branch ?? 'unknown',
          existsOnDisk: true,
          trackedByGit: gitInfo !== undefined,
        });
        gitWorktrees.delete(wtPath); // Mark as processed
      }
    }
  } catch {
    // Directory doesn't exist, no worktrees to check
  }

  // Also check for git-tracked worktrees that aren't in our session
  for (const [wtPath, gitInfo] of gitWorktrees) {
    if (!trackedWorktreePaths.has(wtPath)) {
      // Check if it exists on disk
      let existsOnDisk = false;
      try {
        await access(wtPath, constants.F_OK);
        existsOnDisk = true;
      } catch {
        existsOnDisk = false;
      }

      // Only add if we haven't already added it from filesystem scan
      const alreadyAdded = orphaned.some((o) => o.path === wtPath);
      if (!alreadyAdded) {
        orphaned.push({
          path: wtPath,
          branch: gitInfo.branch,
          existsOnDisk,
          trackedByGit: true,
        });
      }
    }
  }

  return orphaned;
}

/**
 * Detect and recover from a stale parallel session.
 *
 * A session is considered stale if:
 * 1. It has status 'running' (indicating it was active)
 * 2. But the lock file is stale (process no longer running) or missing
 *
 * Recovery actions:
 * 1. Reset running agents to 'cancelled' status
 * 2. Set session status to 'interrupted'
 * 3. Detect orphaned worktrees
 * 4. Save the recovered session
 */
export async function detectAndRecoverStaleParallelSession(
  cwd: string,
  worktreeDir?: string
): Promise<ParallelSessionRecoveryResult> {
  const result: ParallelSessionRecoveryResult = {
    recoveryNeeded: false,
    wasStale: false,
    resetAgentCount: 0,
    orphanedWorktrees: [],
  };

  // Check if parallel session file exists
  const hasSession = await hasParallelSession(cwd);
  if (!hasSession) {
    // Still check for orphaned worktrees even without a session
    result.orphanedWorktrees = await detectOrphanedWorktrees(cwd, worktreeDir);
    result.recoveryNeeded = result.orphanedWorktrees.length > 0;
    return result;
  }

  // Load session
  const session = await loadParallelSession(cwd);
  if (!session) {
    return result;
  }

  // Always check for orphaned worktrees
  result.orphanedWorktrees = await detectOrphanedWorktrees(cwd, worktreeDir);

  // Only recover if status is 'running' - this indicates an ungraceful exit
  if (session.status !== 'running') {
    result.recoveryNeeded = result.orphanedWorktrees.length > 0;
    result.recoveredSession = session;
    return result;
  }

  // Check if lock is stale (process no longer running)
  const lockStatus = await checkLock(cwd);

  // If lock is valid (held by running process), don't recover
  if (lockStatus.isLocked && !lockStatus.isStale) {
    return result;
  }

  // Session is stale - recover it
  result.wasStale = true;
  result.previousStatus = session.status;
  result.recoveryNeeded = true;

  // Count and reset running agents
  const runningAgents = session.agents.filter((a) => a.status === 'running');
  result.resetAgentCount = runningAgents.length;

  // Update agents to cancelled status
  const recoveredAgents = session.agents.map((a) => {
    if (a.status === 'running') {
      return {
        ...a,
        status: 'cancelled' as ParallelTaskStatus,
        endedAt: new Date().toISOString(),
        error: 'Session crashed - agent was interrupted',
      };
    }
    return a;
  });

  // Update tasks that were running
  const recoveredTasks = session.tasks.map((t) => {
    if (t.status === 'running') {
      return { ...t, status: 'pending' as ParallelTaskStatus };
    }
    return t;
  });

  // Update stats for cancelled tasks
  const recoveredStats = {
    ...session.stats,
    cancelledTasks: session.stats.cancelledTasks + result.resetAgentCount,
  };

  // Create recovered session
  const recoveredSession: PersistedParallelSessionState = {
    ...session,
    status: 'interrupted',
    agents: recoveredAgents,
    tasks: recoveredTasks,
    stats: recoveredStats,
    updatedAt: new Date().toISOString(),
  };

  // Save recovered session
  await saveParallelSession(recoveredSession);
  result.recoveredSession = recoveredSession;

  return result;
}

/**
 * Get tasks that can be resumed after recovery.
 * Returns tasks that were pending or cancelled (not completed or failed).
 */
export function getResumableTasks(
  state: PersistedParallelSessionState
): Array<{ id: string; title: string; workUnitId: string }> {
  return state.tasks
    .filter((t) => t.status === 'pending' || t.status === 'cancelled')
    .map((t) => ({
      id: t.id,
      title: t.title,
      workUnitId: t.workUnitId,
    }));
}

/**
 * Get a summary of the parallel session state for display
 */
export function getParallelSessionSummary(state: PersistedParallelSessionState): {
  sessionId: string;
  status: SessionStatus;
  startedAt: string;
  updatedAt: string;
  isPaused: boolean;
  isResumable: boolean;
  stats: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    cancelledTasks: number;
    pendingTasks: number;
    activeAgents: number;
    activeWorktrees: number;
  };
} {
  const activeAgents = state.agents.filter((a) => a.status === 'running').length;
  const pendingTasks = state.tasks.filter((t) => t.status === 'pending').length;

  return {
    sessionId: state.sessionId,
    status: state.status,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    isPaused: state.isPaused,
    isResumable: isParallelSessionResumable(state),
    stats: {
      ...state.stats,
      pendingTasks,
      activeAgents,
      activeWorktrees: state.worktrees.length,
    },
  };
}
