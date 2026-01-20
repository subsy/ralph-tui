/**
 * ABOUTME: Main orchestrator class for coordinating multi-agent execution.
 * Coordinates analyzer, scheduler, and worker manager to execute PRD tasks.
 */

import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import type { OrchestratorConfig, OrchestratorEvent, Phase, WorkerState } from './types.js';
import { analyzePrd, type AnalyzeOptions, type DependencyGraph } from './analyzer.js';
import { createSchedule } from './scheduler.js';
import { WorkerManager } from './worker-manager.js';
import { parsePrdMarkdown } from '../prd/parser.js';
import type { PrdUserStory } from '../prd/types.js';

interface RunResult {
  completed: number;
  failed: number;
  phases: number;
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
    const phases = createSchedule(graph, this.config);

    return this.executePhases(phases, graph);
  }

  private setupSignalHandler(): void {
    const handler = (): void => {
      this.shutdownRequested = true;
      this.workerManager?.killAll();
      process.removeListener('SIGINT', handler);
    };
    process.on('SIGINT', handler);
  }

  private async executePhases(phases: Phase[], graph: DependencyGraph): Promise<RunResult> {
    let completed = 0;
    let failed = 0;

    for (let i = 0; i < phases.length; i++) {
      if (this.shutdownRequested) break;

      const phase = phases[i];
      if (!phase) continue;

      this.emitEvent({
        type: 'phase:started',
        phaseName: phase.name,
        phaseIndex: i,
        totalPhases: phases.length,
      });

      const result = await this.executePhase(phase);
      completed += result.completed;
      failed += result.failed;

      this.emitEvent({
        type: 'phase:completed',
        phaseName: phase.name,
        phaseIndex: i,
      });
    }

    const totalTasks = countTasks(graph);
    this.emitEvent({
      type: 'orchestration:completed',
      totalTasks,
      completedTasks: completed,
    });

    return { completed, failed, phases: phases.length };
  }

  private async executePhase(phase: Phase): Promise<{ completed: number; failed: number }> {
    const manager = this.createWorkerManager();
    this.workerManager = manager;

    await manager.syncBeforeWork();
    this.forwardWorkerEvents(manager);

    const workerIds: string[] = [];
    for (const group of phase.storyGroups) {
      if (this.shutdownRequested) break;
      const id = await manager.spawnWorker(group.idRange);
      workerIds.push(id);
      if (!phase.parallel) await this.waitForWorker(manager, id);
    }

    if (phase.parallel) {
      await this.waitForAllWorkers(manager, workerIds);
    }

    return this.countResults(manager, workerIds);
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

  private waitForWorker(manager: WorkerManager, id: string): Promise<void> {
    return new Promise((resolve) => {
      const checkDone = (): void => {
        const state = manager.getWorkerState(id);
        if (!state || isTerminal(state.status)) {
          resolve();
        }
      };
      manager.on('worker:completed', checkDone);
      manager.on('worker:failed', checkDone);
      checkDone();
    });
  }

  private waitForAllWorkers(manager: WorkerManager, _ids: string[]): Promise<void> {
    return new Promise((resolve) => {
      const checkAllDone = (): void => {
        const states = manager.getAllWorkerStates();
        const activeCount = states.filter((s) => !isTerminal(s.status)).length;
        if (activeCount === 0) resolve();
      };
      manager.on('worker:completed', checkAllDone);
      manager.on('worker:failed', checkAllDone);
      checkAllDone();
    });
  }

  private countResults(
    manager: WorkerManager,
    ids: string[]
  ): { completed: number; failed: number } {
    let completed = 0;
    let failed = 0;
    for (const id of ids) {
      const state = manager.getWorkerState(id);
      if (state?.status === 'completed') completed++;
      else if (state?.status === 'failed' || state?.status === 'killed') failed++;
    }
    return { completed, failed };
  }

  shutdown(): void {
    this.shutdownRequested = true;
    this.workerManager?.killAll();
  }
}

function isTerminal(status: WorkerState['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'killed';
}

function countTasks(graph: DependencyGraph): number {
  return graph.nodes.size;
}

export { analyzePrd, createSchedule, WorkerManager };
export type { OrchestratorConfig, OrchestratorEvent, Phase, WorkerState, DependencyGraph, AnalyzeOptions };
