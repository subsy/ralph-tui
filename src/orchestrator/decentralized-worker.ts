/**
 * ABOUTME: Decentralized worker for parallel task execution.
 * Claims tasks from queue, runs agent, then commits with lock.
 * Multiple workers self-coordinate via queue and commit locks.
 */

import { spawn } from 'node:child_process';
import { claimNextTask, completeTask, failTask } from './task-queue.js';
import { withCommitLock } from './commit-lock.js';
import { runProcess } from '../utils/process.js';

export interface WorkerConfig {
  cwd: string;
  workerId: string;
  maxTasks?: number;
}

export interface WorkerResult {
  tasksCompleted: number;
  tasksFailed: number;
}

/**
 * Run the worker loop: claim task, execute, commit, repeat.
 */
export async function runWorker(config: WorkerConfig): Promise<WorkerResult> {
  const { cwd, workerId, maxTasks } = config;
  let tasksCompleted = 0;
  let tasksFailed = 0;

  while (true) {
    if (maxTasks !== undefined && tasksCompleted + tasksFailed >= maxTasks) {
      break;
    }

    // Claim task (queue lock held briefly)
    const task = await claimNextTask(cwd, workerId);
    if (!task) {
      break;
    }

    console.log(`[${workerId}] Claimed ${task.id}: ${task.title}`);

    try {
      // Run agent - edits files, no git (parallel with other workers)
      const agentSuccess = await runAgentForTask(cwd, task.id);

      if (!agentSuccess) {
        await failTask(cwd, task.id, 'Agent execution failed');
        tasksFailed++;
        continue;
      }

      // Get changed files before commit
      const changedFiles = await getChangedFiles(cwd);

      if (changedFiles.length === 0) {
        console.log(`[${workerId}] No changes for ${task.id}`);
        await completeTask(cwd, task.id, []);
        tasksCompleted++;
        continue;
      }

      // Commit with lock (serialized)
      const commitSuccess = await commitChanges(cwd, task.id, task.title, changedFiles);

      if (commitSuccess) {
        await completeTask(cwd, task.id, changedFiles);
        tasksCompleted++;
        console.log(`[${workerId}] Completed ${task.id}`);
      } else {
        await failTask(cwd, task.id, 'Commit failed');
        tasksFailed++;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[${workerId}] Error on ${task.id}: ${msg}`);
      await failTask(cwd, task.id, msg);
      tasksFailed++;
    }
  }

  return { tasksCompleted, tasksFailed };
}

async function runAgentForTask(cwd: string, taskId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const args = ['run', '--task', taskId, '--headless', '--no-git-write'];

    const proc = spawn('ralph-tui', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

async function getChangedFiles(cwd: string): Promise<string[]> {
  const result = await runProcess('git', ['status', '--porcelain'], { cwd });
  if (!result.success) return [];

  return result.stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.slice(3).trim());
}

async function commitChanges(
  cwd: string,
  taskId: string,
  title: string,
  files: string[]
): Promise<boolean> {
  return withCommitLock(cwd, async () => {
    const addResult = await runProcess('git', ['add', ...files], { cwd });
    if (!addResult.success) {
      console.error('git add failed:', addResult.stderr);
      return false;
    }

    const message = `feat: ${taskId} - ${title}`;
    const commitResult = await runProcess('git', ['commit', '-m', message], { cwd });
    if (!commitResult.success) {
      console.error('git commit failed:', commitResult.stderr);
      return false;
    }

    return true;
  });
}
