/**
 * ABOUTME: Worker manager for spawning and monitoring ralph-tui processes.
 * Handles worker lifecycle, stdout/stderr monitoring, and git sync.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { WorkerState, WorkerStatus, OrchestratorEvent } from './types.js';
import { runProcess } from '../utils/process.js';
import { withCommitLock } from './commit-lock.js';

export interface WorkerConfig {
  cwd: string;
  headless: boolean;
  workerArgs?: string[];
}

interface ManagedWorker {
  id: string;
  taskId: string;
  process: ChildProcess;
  state: WorkerState;
}

function createWorkerState(id: string, taskId: string, status: WorkerStatus): WorkerState {
  return { id, taskId, status, progress: 0 };
}

async function gitSync(cwd: string): Promise<{ ok: boolean; error?: string }> {
  const result = await runProcess('git', ['pull', '--rebase'], { cwd });
  if (!result.success) return { ok: false, error: result.stderr };
  return { ok: true };
}

export class WorkerManager extends EventEmitter {
  private workers = new Map<string, ManagedWorker>();
  private workerCounter = 0;
  private readonly config: WorkerConfig;

  constructor(config: WorkerConfig) {
    super();
    this.config = config;
  }

  private emitEvent(event: OrchestratorEvent): void {
    super.emit(event.type, event);
  }

  async spawnWorker(taskId: string): Promise<string> {
    const id = `worker-${++this.workerCounter}`;

    const args = ['run', '--task', taskId, '--no-notify', '--no-git-write'];
    if (this.config.headless) args.push('--headless');
    if (this.config.workerArgs) args.push(...this.config.workerArgs);

    const proc = spawn('ralph-tui', args, {
      cwd: this.config.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const state = createWorkerState(id, taskId, 'running');
    const worker: ManagedWorker = { id, taskId, process: proc, state };
    this.workers.set(id, worker);

    this.emitEvent({ type: 'worker:started', workerId: id, taskId });
    this.attachListeners(worker);
    return id;
  }

  private attachListeners(worker: ManagedWorker): void {
    const { process: proc, id } = worker;

    proc.stdout?.on('data', (data: Buffer) => {
      this.handleOutput(worker, data.toString());
    });

    proc.stderr?.on('data', (data: Buffer) => {
      this.handleOutput(worker, data.toString());
    });

    proc.on('error', (err) => {
      this.updateState(worker, 'failed', err.message);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        this.commitChanges(worker).then(
          () => {
            this.updateState(worker, 'completed');
            this.workers.delete(id);
          },
          (err) => {
            this.updateState(worker, 'failed', `Commit failed: ${err}`);
            this.workers.delete(id);
          }
        );
      } else {
        this.updateState(worker, 'failed', `Exit code ${code}`);
        this.workers.delete(id);
      }
    });
  }

  private handleOutput(worker: ManagedWorker, text: string): void {
    const prevProgress = worker.state.progress;

    const progressMatch = text.match(/progress[:\s]+(\d+)/i);
    if (progressMatch) {
      worker.state.progress = parseInt(progressMatch[1], 10);
    }

    if (worker.state.progress !== prevProgress) {
      this.emitEvent({
        type: 'worker:progress',
        workerId: worker.id,
        progress: worker.state.progress,
        taskId: worker.taskId,
      });
    }
  }

  private async commitChanges(worker: ManagedWorker): Promise<void> {
    const { cwd } = this.config;
    const { taskId } = worker;

    await withCommitLock(cwd, async () => {
      // Check if there are changes to commit
      const statusResult = await runProcess('git', ['status', '--porcelain'], { cwd });
      if (!statusResult.success || !statusResult.stdout.trim()) {
        return; // No changes to commit
      }

      // Stage all changes
      const addResult = await runProcess('git', ['add', '-A'], { cwd });
      if (!addResult.success) {
        throw new Error(`git add failed: ${addResult.stderr}`);
      }

      // Commit with task ID in message
      const commitResult = await runProcess(
        'git',
        ['commit', '-m', `feat(${taskId}): complete task ${taskId}`],
        { cwd }
      );
      if (!commitResult.success) {
        throw new Error(`git commit failed: ${commitResult.stderr}`);
      }
    });
  }

  private updateState(worker: ManagedWorker, status: WorkerStatus, error?: string): void {
    worker.state.status = status;
    if (error) worker.state.error = error;

    if (status === 'completed') {
      worker.state.progress = 100;
      this.emitEvent({ type: 'worker:completed', workerId: worker.id });
    } else if (status === 'failed') {
      this.emitEvent({ type: 'worker:failed', workerId: worker.id, error: error ?? 'Unknown error' });
    }
  }

  killWorker(id: string): boolean {
    const worker = this.workers.get(id);
    if (!worker) return false;
    worker.process.kill('SIGTERM');
    this.updateState(worker, 'killed');
    this.workers.delete(id);
    return true;
  }

  getWorkerState(id: string): WorkerState | undefined {
    return this.workers.get(id)?.state;
  }

  getAllWorkerStates(): WorkerState[] {
    return Array.from(this.workers.values()).map((w) => w.state);
  }

  async syncBeforeWork(): Promise<{ ok: boolean; error?: string }> {
    return gitSync(this.config.cwd);
  }

  killAll(): void {
    for (const id of this.workers.keys()) {
      this.killWorker(id);
    }
  }
}
