/**
 * ABOUTME: Task Graph Analyzer for identifying parallelizable work units.
 * Integrates with bd/bv CLI tools to analyze task dependencies and group
 * independent tasks for parallel execution across multiple worktrees.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  type GraphTask,
  type TaskGraphMetrics,
  type ParallelWorkUnit,
  type ParallelizationAnalysis,
  type ParallelizationReasoning,
  type TaskGraphAnalyzerConfig,
  type TaskGraphEvent,
  type TaskGraphEventListener,
  type TaskGraphAnalyzerStats,
  type BvPlanOutput,
  type BvInsightsOutput,
  type BvPlanTrack,
  DEFAULT_TASK_GRAPH_ANALYZER_CONFIG,
} from './task-graph-types.js';

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function execCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, timeoutMs);

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        resolve({ stdout, stderr: 'Command timed out', exitCode: 124 });
      } else {
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr: err.message, exitCode: 1 });
    });
  });
}

export class TaskGraphAnalyzer {
  private readonly config: TaskGraphAnalyzerConfig;
  private readonly listeners: Set<TaskGraphEventListener> = new Set();
  private bvAvailable: boolean | null = null;
  private totalAnalyses = 0;
  private totalBvCommands = 0;
  private totalAnalysisTimeMs = 0;
  private totalStatusUpdates = 0;
  private lastAnalysisAt?: Date;
  private lastDataHash?: string;

  constructor(config: Partial<TaskGraphAnalyzerConfig> = {}) {
    this.config = { ...DEFAULT_TASK_GRAPH_ANALYZER_CONFIG, ...config };
  }

  addEventListener(listener: TaskGraphEventListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(listener: TaskGraphEventListener): void {
    this.listeners.delete(listener);
  }

  private emit(event: TaskGraphEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  async checkBvAvailability(): Promise<boolean> {
    if (this.bvAvailable !== null) {
      return this.bvAvailable;
    }

    const result = await execCommand(
      'bv',
      ['--version'],
      this.config.workingDir,
      5000
    );
    this.bvAvailable = result.exitCode === 0;
    return this.bvAvailable;
  }

  async analyze(): Promise<ParallelizationAnalysis> {
    const startTime = performance.now();
    this.emit({ type: 'analysis_started', config: this.config });

    try {
      const bvAvailable = this.config.useBvAnalysis && await this.checkBvAvailability();

      let analysis: ParallelizationAnalysis;
      if (bvAvailable) {
        analysis = await this.analyzeWithBv();
      } else {
        analysis = await this.analyzeWithBd();
      }

      const durationMs = performance.now() - startTime;
      this.totalAnalyses++;
      this.totalAnalysisTimeMs += durationMs;
      this.lastAnalysisAt = new Date();

      this.emit({ type: 'analysis_completed', analysis });
      this.emit({ type: 'parallelization_reasoning', reasoning: analysis.reasoning });

      return analysis;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit({ type: 'analysis_failed', error: err });
      throw err;
    }
  }

  private async analyzeWithBv(): Promise<ParallelizationAnalysis> {
    const [planOutput, insightsOutput] = await Promise.all([
      this.execBvPlan(),
      this.execBvInsights(),
    ]);

    const tasks = this.extractTasksFromPlan(planOutput);
    const workUnits = this.createWorkUnitsFromTracks(planOutput, insightsOutput);

    const actionableTasks = tasks.filter(t => t.blockedBy.length === 0 && t.status === 'open');
    const blockedTasks = tasks.filter(t => t.blockedBy.length > 0 && t.status === 'open');

    const reasoning = this.generateReasoning(workUnits, planOutput, insightsOutput);

    return {
      analyzedAt: new Date(),
      totalTasks: tasks.length,
      actionableTasks: actionableTasks.length,
      blockedTasks: blockedTasks.length,
      workUnits,
      criticalPathTasks: insightsOutput?.CriticalPath ?? planOutput.plan.critical_path ?? [],
      cycles: insightsOutput?.Cycles,
      maxParallelism: Math.min(workUnits.length, this.config.maxParallelUnits),
      reasoning,
      dataHash: planOutput.data_hash,
    };
  }

  private async analyzeWithBd(): Promise<ParallelizationAnalysis> {
    const tasks = await this.fetchTasksFromBd();
    const workUnits = this.createWorkUnitsFromTasks(tasks);

    const actionableTasks = tasks.filter(t => t.blockedBy.length === 0 && t.status === 'open');
    const blockedTasks = tasks.filter(t => t.blockedBy.length > 0 && t.status === 'open');

    const reasoning: ParallelizationReasoning = {
      strategy: 'Basic dependency analysis (bv unavailable)',
      parallelismRationale: `Created ${workUnits.length} work units from ${actionableTasks.length} actionable tasks`,
      workUnitReasons: workUnits.map(wu => ({
        workUnitId: wu.id,
        reason: `Grouped ${wu.tasks.length} independent tasks with no mutual dependencies`,
      })),
      constraints: ['bv graph analysis unavailable - using basic dependency check'],
      recommendations: ['Install bv for advanced graph metrics (PageRank, critical path)'],
    };

    return {
      analyzedAt: new Date(),
      totalTasks: tasks.length,
      actionableTasks: actionableTasks.length,
      blockedTasks: blockedTasks.length,
      workUnits,
      criticalPathTasks: [],
      maxParallelism: Math.min(workUnits.length, this.config.maxParallelUnits),
      reasoning,
    };
  }

  private async execBvPlan(): Promise<BvPlanOutput> {
    const args = ['--robot-plan'];
    if (this.config.labels?.length) {
      args.push('--label', this.config.labels[0]!);
    }

    this.emit({ type: 'bv_command_started', command: 'bv --robot-plan' });
    const startTime = performance.now();

    const result = await execCommand('bv', args, this.config.workingDir, this.config.bvTimeoutMs);
    const durationMs = performance.now() - startTime;
    this.totalBvCommands++;

    if (result.exitCode !== 0) {
      this.emit({ type: 'bv_command_failed', command: 'bv --robot-plan', error: result.stderr });
      throw new Error(`bv --robot-plan failed: ${result.stderr}`);
    }

    this.emit({ type: 'bv_command_completed', command: 'bv --robot-plan', durationMs });

    try {
      return JSON.parse(result.stdout) as BvPlanOutput;
    } catch {
      throw new Error(`Failed to parse bv --robot-plan output: ${result.stdout.slice(0, 200)}`);
    }
  }

  private async execBvInsights(): Promise<BvInsightsOutput | null> {
    const args = ['--robot-insights'];
    if (this.config.labels?.length) {
      args.push('--label', this.config.labels[0]!);
    }

    this.emit({ type: 'bv_command_started', command: 'bv --robot-insights' });
    const startTime = performance.now();

    const result = await execCommand('bv', args, this.config.workingDir, this.config.bvTimeoutMs);
    const durationMs = performance.now() - startTime;
    this.totalBvCommands++;

    if (result.exitCode !== 0) {
      this.emit({ type: 'bv_command_failed', command: 'bv --robot-insights', error: result.stderr });
      return null;
    }

    this.emit({ type: 'bv_command_completed', command: 'bv --robot-insights', durationMs });

    try {
      return JSON.parse(result.stdout) as BvInsightsOutput;
    } catch {
      return null;
    }
  }

  private async fetchTasksFromBd(): Promise<GraphTask[]> {
    const args = ['list', '--json'];
    if (this.config.epicId) {
      args.push('--parent', this.config.epicId);
    }
    if (this.config.labels?.length) {
      args.push('--label', this.config.labels.join(','));
    }

    const result = await execCommand('bd', args, this.config.workingDir, this.config.bvTimeoutMs);

    if (result.exitCode !== 0) {
      throw new Error(`bd list failed: ${result.stderr}`);
    }

    interface BdListItem {
      id: string;
      title: string;
      status: string;
      priority: number;
      labels?: string[];
      issue_type?: string;
      dependencies?: Array<{ id: string; dependency_type: string }>;
      dependents?: Array<{ id: string; dependency_type: string }>;
    }

    const beads = JSON.parse(result.stdout) as BdListItem[];
    return beads.map(bead => ({
      id: bead.id,
      title: bead.title,
      status: this.mapBdStatus(bead.status),
      priority: bead.priority,
      blockedBy: (bead.dependencies ?? [])
        .filter(d => d.dependency_type === 'blocks')
        .map(d => d.id),
      blocks: (bead.dependents ?? [])
        .filter(d => d.dependency_type === 'blocks')
        .map(d => d.id),
      labels: bead.labels,
      type: bead.issue_type,
    }));
  }

  private mapBdStatus(status: string): GraphTask['status'] {
    switch (status) {
      case 'open': return 'open';
      case 'in_progress': return 'in_progress';
      case 'closed': return 'closed';
      case 'cancelled': return 'cancelled';
      default: return 'open';
    }
  }

  private extractTasksFromPlan(planOutput: BvPlanOutput): GraphTask[] {
    const tasks: GraphTask[] = [];
    const seen = new Set<string>();

    for (const track of planOutput.plan.tracks) {
      for (const issue of track.issues) {
        if (seen.has(issue.id)) continue;
        seen.add(issue.id);

        tasks.push({
          id: issue.id,
          title: issue.title,
          status: this.mapBdStatus(issue.status),
          priority: issue.priority,
          blockedBy: issue.blocked_by ?? [],
          blocks: issue.blocks ?? [],
          labels: issue.labels,
          type: issue.type,
        });
      }
    }

    return tasks;
  }

  private createWorkUnitsFromTracks(
    planOutput: BvPlanOutput,
    insightsOutput: BvInsightsOutput | null
  ): ParallelWorkUnit[] {
    const workUnits: ParallelWorkUnit[] = [];
    const tracksToUse = planOutput.plan.tracks.slice(0, this.config.maxParallelUnits);

    for (const track of tracksToUse) {
      const tasks = this.convertTrackToGraphTasks(track, insightsOutput);

      if (tasks.length === 0) continue;

      const limitedTasks = tasks.slice(0, this.config.maxTasksPerUnit);
      const totalUnblocks = limitedTasks.reduce((sum, t) => sum + (t.metrics?.unblockCount ?? 0), 0);
      const avgPriority = limitedTasks.reduce((sum, t) => sum + t.priority, 0) / limitedTasks.length;

      const workUnit: ParallelWorkUnit = {
        id: randomUUID(),
        name: track.name || `Track ${track.track_id}`,
        tasks: limitedTasks,
        track: track.track_id,
        totalUnblocks,
        avgPriority,
        groupingReasons: this.generateTrackGroupingReasons(track, insightsOutput),
      };

      workUnits.push(workUnit);
      this.emit({ type: 'work_unit_created', workUnit });
    }

    return workUnits;
  }

  private convertTrackToGraphTasks(
    track: BvPlanTrack,
    insightsOutput: BvInsightsOutput | null
  ): GraphTask[] {
    const openIssues = track.issues.filter(i => i.status === 'open');

    return openIssues.map(issue => {
      const metrics: TaskGraphMetrics = {
        unblockCount: track.unblocks?.length ?? 0,
        pagerank: insightsOutput?.PageRank?.[issue.id],
        betweenness: insightsOutput?.Betweenness?.[issue.id],
        slack: insightsOutput?.Slack?.[issue.id],
        criticalPathPosition: insightsOutput?.CriticalPath?.indexOf(issue.id),
      };

      return {
        id: issue.id,
        title: issue.title,
        status: this.mapBdStatus(issue.status),
        priority: issue.priority,
        blockedBy: issue.blocked_by ?? [],
        blocks: issue.blocks ?? [],
        labels: issue.labels,
        type: issue.type,
        metrics,
      };
    });
  }

  private generateTrackGroupingReasons(
    track: BvPlanTrack,
    insightsOutput: BvInsightsOutput | null
  ): string[] {
    const reasons: string[] = [];

    reasons.push(`Part of execution track "${track.name || track.track_id}"`);

    if (track.unblocks?.length) {
      reasons.push(`Completing this track unblocks ${track.unblocks.length} downstream tasks`);
    }

    const criticalPathTasks = track.issues.filter(
      i => insightsOutput?.CriticalPath?.includes(i.id)
    );
    if (criticalPathTasks.length > 0) {
      reasons.push(`Contains ${criticalPathTasks.length} critical path task(s)`);
    }

    return reasons;
  }

  private createWorkUnitsFromTasks(tasks: GraphTask[]): ParallelWorkUnit[] {
    const actionable = tasks.filter(t => t.blockedBy.length === 0 && t.status === 'open');
    actionable.sort((a, b) => b.priority - a.priority);

    const workUnits: ParallelWorkUnit[] = [];
    let currentBatch: GraphTask[] = [];

    for (const task of actionable) {
      currentBatch.push(task);

      if (currentBatch.length >= this.config.maxTasksPerUnit) {
        workUnits.push(this.createWorkUnitFromBatch(currentBatch, workUnits.length));
        currentBatch = [];
      }

      if (workUnits.length >= this.config.maxParallelUnits) break;
    }

    if (currentBatch.length >= this.config.minTasksPerUnit && workUnits.length < this.config.maxParallelUnits) {
      workUnits.push(this.createWorkUnitFromBatch(currentBatch, workUnits.length));
    }

    return workUnits;
  }

  private createWorkUnitFromBatch(tasks: GraphTask[], index: number): ParallelWorkUnit {
    const totalUnblocks = tasks.reduce((sum, t) => sum + t.blocks.length, 0);
    const avgPriority = tasks.reduce((sum, t) => sum + t.priority, 0) / tasks.length;

    const workUnit: ParallelWorkUnit = {
      id: randomUUID(),
      name: `Work Unit ${index + 1}`,
      tasks,
      totalUnblocks,
      avgPriority,
      groupingReasons: [
        `Grouped ${tasks.length} independent tasks by priority`,
        `No blocking dependencies between grouped tasks`,
      ],
    };

    this.emit({ type: 'work_unit_created', workUnit });
    return workUnit;
  }

  private generateReasoning(
    workUnits: ParallelWorkUnit[],
    planOutput: BvPlanOutput,
    insightsOutput: BvInsightsOutput | null
  ): ParallelizationReasoning {
    const summary = planOutput.plan.summary;
    const hasCycles = (insightsOutput?.Cycles?.length ?? 0) > 0;

    const constraints: string[] = [];
    if (this.config.maxParallelUnits < summary.parallel_tracks) {
      constraints.push(`Limited to ${this.config.maxParallelUnits} parallel units (config), ${summary.parallel_tracks} available`);
    }
    if (hasCycles) {
      constraints.push(`Dependency cycles detected: ${insightsOutput!.Cycles!.length} cycle(s) may limit parallelization`);
    }

    const recommendations: string[] = [];
    if (summary.highest_impact) {
      recommendations.push(`Prioritize task ${summary.highest_impact} for maximum downstream unblocking`);
    }
    if (summary.critical_path_length > 0) {
      recommendations.push(`Critical path has ${summary.critical_path_length} tasks - focus on these to minimize total time`);
    }

    return {
      strategy: `Graph-aware parallelization using ${workUnits.length} independent execution tracks`,
      parallelismRationale: `bv identified ${summary.parallel_tracks} parallel tracks with ${summary.total_actionable} actionable tasks across ${summary.estimated_phases} phases`,
      workUnitReasons: workUnits.map(wu => ({
        workUnitId: wu.id,
        reason: wu.groupingReasons.join('; '),
        alternativesConsidered: [],
      })),
      constraints,
      recommendations,
    };
  }

  async updateTaskStatus(
    taskId: string,
    newStatus: 'open' | 'in_progress' | 'closed'
  ): Promise<boolean> {
    const bdStatus = newStatus === 'closed' ? 'closed' : newStatus;
    const args = ['update', taskId, '--status', bdStatus];

    const result = await execCommand('bd', args, this.config.workingDir, 10000);

    if (result.exitCode === 0) {
      this.totalStatusUpdates++;
      this.emit({
        type: 'task_status_updated',
        taskId,
        oldStatus: 'unknown',
        newStatus,
      });
      return true;
    }

    return false;
  }

  async syncWithGit(): Promise<boolean> {
    const result = await execCommand('bd', ['sync'], this.config.workingDir, 30000);
    return result.exitCode === 0;
  }

  getStats(): TaskGraphAnalyzerStats {
    return {
      totalAnalyses: this.totalAnalyses,
      bvCommandsExecuted: this.totalBvCommands,
      avgAnalysisTimeMs: this.totalAnalyses > 0 ? this.totalAnalysisTimeMs / this.totalAnalyses : 0,
      statusUpdates: this.totalStatusUpdates,
      lastAnalysisAt: this.lastAnalysisAt,
      cacheHitRate: 0,
    };
  }

  getLastDataHash(): string | undefined {
    return this.lastDataHash;
  }
}
