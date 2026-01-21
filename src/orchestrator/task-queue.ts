/**
 * ABOUTME: JSON-based task queue for decentralized worker coordination.
 * Workers claim tasks, mark them in-progress, and complete them.
 * Uses file locking for atomic queue updates.
 */

import { readFile, writeFile, mkdir, rmdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const QUEUE_FILE = '.ralph-tui/task-queue.json';
const QUEUE_LOCK = '.ralph-tui/queue.lock';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withQueueLock<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = join(cwd, QUEUE_LOCK);
  let attempts = 0;
  const maxRetries = 60;

  // Ensure parent directory exists
  await mkdir(dirname(lockPath), { recursive: true });

  while (attempts < maxRetries) {
    try {
      await mkdir(lockPath, { recursive: false });
      break;
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'EEXIST') {
        attempts++;
        await sleep(100);
      } else {
        throw err;
      }
    }
  }

  if (attempts >= maxRetries) {
    throw new Error('Failed to acquire queue lock');
  }

  try {
    return await fn();
  } finally {
    try {
      await rmdir(lockPath);
    } catch {
      // ignore
    }
  }
}

export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'failed';

export interface QueuedTask {
  id: string;
  title: string;
  status: TaskStatus;
  workerId?: string;
  claimedAt?: string;
  completedAt?: string;
  filesChanged?: string[];
  error?: string;
}

export interface TaskQueue {
  tasks: QueuedTask[];
  updatedAt: string;
}

async function readQueue(cwd: string): Promise<TaskQueue> {
  const filePath = join(cwd, QUEUE_FILE);
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as TaskQueue;
  } catch {
    return { tasks: [], updatedAt: new Date().toISOString() };
  }
}

async function writeQueue(cwd: string, queue: TaskQueue): Promise<void> {
  const filePath = join(cwd, QUEUE_FILE);
  await mkdir(dirname(filePath), { recursive: true });
  queue.updatedAt = new Date().toISOString();
  await writeFile(filePath, JSON.stringify(queue, null, 2), 'utf-8');
}

/**
 * Initialize the task queue from a list of task IDs and titles.
 */
export async function initializeQueue(
  cwd: string,
  tasks: Array<{ id: string; title: string }>
): Promise<void> {
  const queue: TaskQueue = {
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: 'pending' })),
    updatedAt: new Date().toISOString(),
  };
  await writeQueue(cwd, queue);
}

/**
 * Claim the next available pending task.
 * Returns the task if claimed, null if no tasks available.
 */
export async function claimNextTask(
  cwd: string,
  workerId: string
): Promise<QueuedTask | null> {
  return withQueueLock(cwd, async () => {
    const queue = await readQueue(cwd);
    const task = queue.tasks.find((t) => t.status === 'pending');
    if (!task) return null;

    task.status = 'in_progress';
    task.workerId = workerId;
    task.claimedAt = new Date().toISOString();

    await writeQueue(cwd, queue);
    return task;
  });
}

/**
 * Mark a task as completed with the files that were changed.
 */
export async function completeTask(
  cwd: string,
  taskId: string,
  filesChanged: string[]
): Promise<void> {
  return withQueueLock(cwd, async () => {
    const queue = await readQueue(cwd);
    const task = queue.tasks.find((t) => t.id === taskId);
    if (!task) return;

    task.status = 'done';
    task.completedAt = new Date().toISOString();
    task.filesChanged = filesChanged;

    await writeQueue(cwd, queue);
  });
}

/**
 * Mark a task as failed with an error message.
 */
export async function failTask(
  cwd: string,
  taskId: string,
  error: string
): Promise<void> {
  return withQueueLock(cwd, async () => {
    const queue = await readQueue(cwd);
    const task = queue.tasks.find((t) => t.id === taskId);
    if (!task) return;

    task.status = 'failed';
    task.completedAt = new Date().toISOString();
    task.error = error;

    await writeQueue(cwd, queue);
  });
}

/**
 * Release a task back to pending (e.g., if worker died or task needs retry).
 */
export async function releaseTask(cwd: string, taskId: string): Promise<void> {
  return withQueueLock(cwd, async () => {
    const queue = await readQueue(cwd);
    const task = queue.tasks.find((t) => t.id === taskId);
    if (!task) return;

    task.status = 'pending';
    task.workerId = undefined;
    task.claimedAt = undefined;

    await writeQueue(cwd, queue);
  });
}

/**
 * Get queue status summary.
 */
export async function getQueueStatus(cwd: string): Promise<{
  pending: number;
  inProgress: number;
  done: number;
  failed: number;
  total: number;
}> {
  const queue = await readQueue(cwd);
  return {
    pending: queue.tasks.filter((t) => t.status === 'pending').length,
    inProgress: queue.tasks.filter((t) => t.status === 'in_progress').length,
    done: queue.tasks.filter((t) => t.status === 'done').length,
    failed: queue.tasks.filter((t) => t.status === 'failed').length,
    total: queue.tasks.length,
  };
}

/**
 * Check if all tasks are complete (done or failed).
 */
export async function isQueueComplete(cwd: string): Promise<boolean> {
  const status = await getQueueStatus(cwd);
  return status.pending === 0 && status.inProgress === 0;
}
