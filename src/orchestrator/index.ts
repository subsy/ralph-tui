/**
 * ABOUTME: DAG-based orchestrator for multi-agent parallel execution.
 * Starts tasks as soon as their dependencies complete, maximizing parallelism.
 */

import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import type { OrchestratorConfig, OrchestratorEvent, WorkerState } from './types.js';
import { analyzePrd, type AnalyzeOptions, type DependencyGraph, type StoryNode } from './analyzer.js';
import { WorkerManager } from './worker-manager.js';
import { parsePrdMarkdown } from '../prd/parser.js';
import type { PrdUserStory } from '../prd/types.js';

interface RunResult {
  completed: number;
  failed: number;
}

async function loadStories(prdPath: string): Promise<PrdUserStory[]> {
  const content = await readFile(prdPath, 'utf-8');
  if (prdPath.endsWith('.json')) {
    const data = JSON.parse(content) as { userStories: PrdUserStory[] };
    return data.userStories;
  }
  const parsed = parsePrdMarkdown(content);
  return parsed.userStories;
}

export class Orchestrator extends EventEmitter {
  private readonly config: OrchestratorConfig;
  private workerManager: WorkerManager | null = null;
  private shutdownRequested = false;

  constructor(config: OrchestratorConfig) {
    super();
    this.config = config;
  }

  private emitEvent(event: OrchestratorEvent): void {
    super.emit(event.type, event);
  }

  async run(analyzeOptions?: AnalyzeOptions): Promise<RunResult> {
    this.setupSignalHandler();
    const stories = await loadStories(this.config.prdPath);
    const graph = await analyzePrd(stories, analyzeOptions);

    return this.executeDag(graph);
  }

  private setupSignalHandler(): void {
    const handler = (): void => {
      this.shutdownRequested = true;
      this.workerManager?.killAll();
      process.removeListener('SIGINT', handler);
    };
    process.on('SIGINT', handler);
  }

  private async executeDag(graph: DependencyGraph): Promise<RunResult> {
    const manager = this.createWorkerManager();
    this.workerManager = manager;

    await manager.syncBeforeWork();
    this.forwardWorkerEvents(manager);

    const completed = new Set<string>();
    const failed = new Set<string>();
    const running = new Map<string, string>(); // workerId -> taskId
    const pending = new Set<string>(graph.nodes.keys());

    const getReady = (): string[] => {
      const ready: string[] = [];
      for (const taskId of pending) {
        const node = graph.nodes.get(taskId);
        if (!node) continue;
        const deps = getAllDeps(node);
        if (deps.every((d) => completed.has(d))) {
          ready.push(taskId);
        }
      }
      return ready;
    };

    const startTask = async (taskId: string): Promise<string> => {
      pending.delete(taskId);
      const workerId = await manager.spawnWorker(taskId);
      running.set(workerId, taskId);
      return workerId;
    };

    const runningCount = (): number => running.size;
    const maxConcurrent = this.config.maxWorkers ?? Infinity;

    return new Promise((resolve) => {
      const scheduleReady = async (): Promise<void> => {
        if (this.shutdownRequested) return;

        const ready = getReady();
        for (const taskId of ready) {
          if (runningCount() >= maxConcurrent) break;
          await startTask(taskId);
        }

        if (pending.size === 0 && running.size === 0) {
          this.emitEvent({
            type: 'orchestration:completed',
            totalTasks: graph.nodes.size,
            completedTasks: completed.size,
          });
          resolve({ completed: completed.size, failed: failed.size });
        }
      };

      const handleWorkerDone = (workerId: string, success: boolean): void => {
        const taskId = running.get(workerId);
        if (!taskId) return;

        running.delete(workerId);
        if (success) {
          completed.add(taskId);
        } else {
          failed.add(taskId);
        }

        scheduleReady();
      };

      manager.on('worker:completed', (event: OrchestratorEvent) => {
        if (event.type === 'worker:completed') {
          handleWorkerDone(event.workerId, true);
        }
      });

      manager.on('worker:failed', (event: OrchestratorEvent) => {
        if (event.type === 'worker:failed') {
          handleWorkerDone(event.workerId, false);
        }
      });

      // Start initial ready tasks
      scheduleReady();
    });
  }

  private createWorkerManager(): WorkerManager {
    return new WorkerManager({
      cwd: this.config.cwd,
      headless: this.config.headless,
      workerArgs: this.config.workerArgs,
    });
  }

  private forwardWorkerEvents(manager: WorkerManager): void {
    const eventTypes = ['worker:started', 'worker:progress', 'worker:completed', 'worker:failed'];
    for (const eventType of eventTypes) {
      manager.on(eventType, (event: OrchestratorEvent) => this.emitEvent(event));
    }
  }

  shutdown(): void {
    this.shutdownRequested = true;
    this.workerManager?.killAll();
  }
}

function getAllDeps(node: StoryNode): string[] {
  return [...new Set([...node.explicitDeps, ...node.implicitDeps])];
}

export { analyzePrd, WorkerManager };
export type { OrchestratorConfig, OrchestratorEvent, WorkerState, DependencyGraph, AnalyzeOptions };
