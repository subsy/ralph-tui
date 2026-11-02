/**
 * ABOUTME: Parallel session state persistence for crash recovery.
 * Stores the task graph snapshot, current progress, and worktree states
 * so that a crashed parallel session can resume intelligently.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ParallelSessionState, TaskGraphAnalysis } from './types.js';
import { writeJsonAtomic } from '../session/atomic-write.js';

/** File name for persisted parallel session state */
const SESSION_FILE = '.ralph-tui/parallel-session.json';

/**
 * Options for creating a parallel session.
 */
export interface CreateParallelSessionOptions {
  sessionId: string;
  taskGraph: TaskGraphAnalysis;
  sessionStartTag: string;
  /** Session branch name (e.g., "ralph-session/a4d1aae7") */
  sessionBranch?: string;
  /** Original branch before session branch was created */
  originalBranch?: string;
}

/**
 * Create a new parallel session state.
 */
export function createParallelSession(
  sessionId: string,
  taskGraph: TaskGraphAnalysis,
  sessionStartTag: string,
  options?: { sessionBranch?: string; originalBranch?: string }
): ParallelSessionState {
  const now = new Date().toISOString();
  return {
    sessionId,
    taskGraph,
    lastCompletedGroupIndex: -1,
    mergedTaskIds: [],
    failedTaskIds: [],
    requeuedTaskIds: [],
    sessionStartTag,
    startedAt: now,
    lastUpdatedAt: now,
    sessionBranch: options?.sessionBranch,
    originalBranch: options?.originalBranch,
  };
}

/**
 * Save parallel session state to disk.
 */
export async function saveParallelSession(
  cwd: string,
  state: ParallelSessionState
): Promise<void> {
  const filePath = path.join(cwd, SESSION_FILE);

  // Convert Map to array for JSON serialization
  const serializable = {
    ...state,
    taskGraph: serializeTaskGraph(state.taskGraph),
  };

  await writeJsonAtomic(filePath, serializable);
}

/**
 * Load parallel session state from disk.
 * @returns The session state, or null if no session exists
 */
export async function loadParallelSession(
  cwd: string
): Promise<ParallelSessionState | null> {
  const filePath = path.join(cwd, SESSION_FILE);

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    return {
      ...parsed,
      taskGraph: deserializeTaskGraph(parsed.taskGraph),
    };
  } catch {
    return null;
  }
}

/**
 * Delete parallel session state from disk.
 */
export async function deleteParallelSession(cwd: string): Promise<void> {
  const filePath = path.join(cwd, SESSION_FILE);
  try {
    fs.unlinkSync(filePath);
  } catch {
    // File may not exist
  }
}

/**
 * Check if a parallel session exists on disk.
 */
export async function hasParallelSession(cwd: string): Promise<boolean> {
  const filePath = path.join(cwd, SESSION_FILE);
  return fs.existsSync(filePath);
}

/**
 * Update session state with session branch information.
 * Called when a session branch is created for parallel execution.
 */
export function updateSessionWithBranch(
  state: ParallelSessionState,
  sessionBranch: string,
  originalBranch: string
): ParallelSessionState {
  return {
    ...state,
    sessionBranch,
    originalBranch,
    lastUpdatedAt: new Date().toISOString(),
  };
}

/**
 * Update session state after a group completes.
 */
export function updateSessionAfterGroup(
  state: ParallelSessionState,
  groupIndex: number,
  mergedTaskIds: string[],
  failedTaskIds: string[]
): ParallelSessionState {
  return {
    ...state,
    lastCompletedGroupIndex: groupIndex,
    mergedTaskIds: [...state.mergedTaskIds, ...mergedTaskIds],
    failedTaskIds: [...state.failedTaskIds, ...failedTaskIds],
    lastUpdatedAt: new Date().toISOString(),
  };
}

/**
 * Update session state after a task is re-queued due to merge conflict.
 */
export function markTaskRequeued(
  state: ParallelSessionState,
  taskId: string
): ParallelSessionState {
  return {
    ...state,
    requeuedTaskIds: [...state.requeuedTaskIds, taskId],
    lastUpdatedAt: new Date().toISOString(),
  };
}

/**
 * Check for orphaned worktrees from a crashed session.
 * Scans the worktree directory for any remaining worktrees.
 *
 * @returns List of worktree paths that exist on disk
 */
export function findOrphanedWorktrees(
  cwd: string,
  worktreeDir: string = '.ralph-tui/worktrees'
): string[] {
  const basePath = path.resolve(cwd, worktreeDir);

  if (!fs.existsSync(basePath)) {
    return [];
  }

  try {
    const entries = fs.readdirSync(basePath, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => path.join(basePath, e.name));
  } catch {
    return [];
  }
}

/**
 * Clean up orphaned worktrees from a crashed session.
 * Removes worktrees and their branches.
 */
export function cleanupOrphanedWorktrees(
  cwd: string,
  worktreeDir: string = '.ralph-tui/worktrees'
): { cleaned: number; errors: string[] } {
  const orphans = findOrphanedWorktrees(cwd, worktreeDir);
  const errors: string[] = [];
  let cleaned = 0;

  for (const worktreePath of orphans) {
    try {
      // Try git worktree remove first (use execFileSync to prevent command injection)
      execFileSync('git', ['-C', cwd, 'worktree', 'remove', '--force', worktreePath], {
        encoding: 'utf-8',
        timeout: 10000,
      });
      cleaned++;
    } catch {
      // Manual cleanup fallback
      try {
        fs.rmSync(worktreePath, { recursive: true, force: true });
        execFileSync('git', ['-C', cwd, 'worktree', 'prune'], {
          encoding: 'utf-8',
          timeout: 10000,
        });
        cleaned++;
      } catch (err) {
        errors.push(`Failed to clean up ${worktreePath}: ${err}`);
      }
    }
  }

  // Clean up ralph-parallel/* branches
  try {
    const branches = execFileSync(
      'git',
      ['-C', cwd, 'branch', '--list', 'ralph-parallel/*'],
      { encoding: 'utf-8', timeout: 10000 }
    );
    for (const branch of branches.split('\n')) {
      const name = branch.trim().replace(/^\*\s*/, '');
      if (name) {
        try {
          execFileSync('git', ['-C', cwd, 'branch', '-D', name], {
            encoding: 'utf-8',
            timeout: 10000,
          });
        } catch {
          // Branch may be in use or already deleted
        }
      }
    }
  } catch {
    // No branches to clean
  }

  return { cleaned, errors };
}

/**
 * Serialize a TaskGraphAnalysis for JSON storage.
 * Converts the Map to an array of entries.
 */
function serializeTaskGraph(
  graph: TaskGraphAnalysis
): Record<string, unknown> {
  return {
    ...graph,
    nodes: [...graph.nodes.entries()],
  };
}

/**
 * Deserialize a TaskGraphAnalysis from JSON storage.
 */
function deserializeTaskGraph(
  data: Record<string, unknown>
): TaskGraphAnalysis {
  const entries = data.nodes as [string, unknown][];
  return {
    ...data,
    nodes: new Map(entries),
  } as TaskGraphAnalysis;
}
