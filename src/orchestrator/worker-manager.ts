/**
 * ABOUTME: Worker manager for spawning and monitoring ralph-tui processes.
 * Handles worker lifecycle, stdout/stderr monitoring, and git sync.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { IdRange, WorkerState, WorkerStatus, OrchestratorEvent } from './types.js';
import { runProcess } from '../utils/process.js';

export interface WorkerConfig {
  cwd: string;
  headless: boolean;
  workerArgs?: string[];
}

interface ManagedWorker {
  id: string;
  range: IdRange;
  process: ChildProcess;
  state: WorkerState;
}

function formatRange(range: IdRange): string {
  return `${range.from}:${range.to}`;
}

function createWorkerState(id: string, range: IdRange, status: WorkerStatus): WorkerState {
  return { id, range, status, progress: 0 };
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

  async spawnWorker(range: IdRange): Promise<string> {
    const id = `worker-${++this.workerCounter}`;
    const rangeArg = formatRange(range);

    const args = ['run', '--task-range', rangeArg];
    if (this.config.headless) args.push('--headless');
    if (this.config.workerArgs) args.push(...this.config.workerArgs);

    const proc = spawn('ralph-tui', args, {
      cwd: this.config.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const state = createWorkerState(id, range, 'running');
    const worker: ManagedWorker = { id, range, process: proc, state };
    this.workers.set(id, worker);

    this.emitEvent({ type: 'worker:started', workerId: id, range });
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
      const status: WorkerStatus = code === 0 ? 'completed' : 'failed';
      this.updateState(worker, status, code !== 0 ? `Exit code ${code}` : undefined);
      this.workers.delete(id);
    });
  }

  private handleOutput(worker: ManagedWorker, text: string): void {
    const progressMatch = text.match(/progress[:\s]+(\d+)/i);
    if (progressMatch) {
      worker.state.progress = parseInt(progressMatch[1], 10);
    }
    const taskMatch = text.match(/task[:\s]+(US-\d+)/i);
    if (taskMatch) {
      worker.state.currentTaskId = taskMatch[1];
    }
    this.emitEvent({
      type: 'worker:progress',
      workerId: worker.id,
      progress: worker.state.progress,
      currentTaskId: worker.state.currentTaskId,
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
