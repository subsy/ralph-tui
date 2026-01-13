/**
 * ABOUTME: Parallel Executor for running multiple tasks concurrently with continue-on-error semantics.
 * Executes tasks across git worktrees, collecting failures and generating detailed failure reports
 * while allowing remaining tasks to continue executing when individual tasks fail.
 */

import { randomUUID } from 'node:crypto';
import type { ManagedWorktree } from './types.js';
import type { ParallelWorkUnit, GraphTask } from './task-graph-types.js';
import { WorktreePoolManager } from './manager.js';
import { Coordinator } from './coordinator.js';
import {
  type ParallelTaskResult,
  type ParallelTaskStatus,
  type TaskExecutionError,
  type TaskFailurePhase,
  type FailureAttribution,
  type FailureSummary,
  type FailedAgentLog,
  type ParallelExecutionFailureReport,
  type ParallelExecutionResult,
  type ParallelExecutorConfig,
  type ParallelExecutorEvent,
  type ParallelExecutorEventListener,
  type ParallelExecutorStats,
  DEFAULT_PARALLEL_EXECUTOR_CONFIG,
} from './parallel-executor-types.js';
import {
  ParallelAgentRunner,
  type ParallelAgentConfig,
} from './parallel-agent-runner.js';
import type { SubagentTraceSummary } from '../plugins/agents/tracing/types.js';

interface TaskExecutionContext {
  task: GraphTask;
  workUnit: ParallelWorkUnit;
  worktree?: ManagedWorktree;
  agentId: string;
  stdout: string;
  stderr: string;
  startedAt: Date;
  abortController: AbortController;
  subagentSummary?: SubagentTraceSummary;
}

export class ParallelExecutor {
  private readonly config: ParallelExecutorConfig;
  private readonly listeners: Set<ParallelExecutorEventListener> = new Set();
  private readonly worktreeManager: WorktreePoolManager;
  private readonly coordinator: Coordinator;
  private readonly agentRunner: ParallelAgentRunner;
  private readonly activeExecutions: Map<string, TaskExecutionContext> = new Map();
  private isShuttingDown = false;
  private stats: ParallelExecutorStats = {
    totalExecutions: 0,
    totalTasksExecuted: 0,
    totalTasksCompleted: 0,
    totalTasksFailed: 0,
    totalTasksCancelled: 0,
    avgTaskDurationMs: 0,
    totalExecutionTimeMs: 0,
    worktreesPreserved: 0,
  };

  constructor(config: Partial<ParallelExecutorConfig> = {}) {
    this.config = { ...DEFAULT_PARALLEL_EXECUTOR_CONFIG, ...config };
    this.worktreeManager = new WorktreePoolManager(this.config.workingDir, {
      maxWorktrees: this.config.maxConcurrency,
      worktreeDir: '.worktrees',
    });
    this.coordinator = new Coordinator();
    this.agentRunner = new ParallelAgentRunner();
  }

  addEventListener(listener: ParallelExecutorEventListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(listener: ParallelExecutorEventListener): void {
    this.listeners.delete(listener);
  }

  private emit(event: ParallelExecutorEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  async initialize(): Promise<void> {
    await this.worktreeManager.initialize();
    await this.agentRunner.initialize();
    this.coordinator.start();
  }

  async execute(workUnits: ParallelWorkUnit[]): Promise<ParallelExecutionResult> {
    const startedAt = new Date();
    this.isShuttingDown = false;
    this.stats.totalExecutions++;

    this.emit({ type: 'execution_started', workUnits, config: this.config });

    const allTasks = workUnits.flatMap(wu => wu.tasks.map(task => ({ task, workUnit: wu })));
    const results: ParallelTaskResult[] = [];
    const taskQueue = [...allTasks];
    const runningPromises: Map<string, Promise<ParallelTaskResult>> = new Map();

    while (taskQueue.length > 0 || runningPromises.size > 0) {
      if (this.isShuttingDown) {
        for (const [taskId] of runningPromises) {
          const ctx = this.activeExecutions.get(taskId);
          if (ctx) {
            ctx.abortController.abort();
          }
        }
        break;
      }

      while (
        runningPromises.size < this.config.maxConcurrency &&
        taskQueue.length > 0 &&
        !this.isShuttingDown
      ) {
        const item = taskQueue.shift()!;
        const promise = this.executeTask(item.task, item.workUnit);
        runningPromises.set(item.task.id, promise);
      }

      if (runningPromises.size === 0) break;

      const completedResult = await Promise.race(
        Array.from(runningPromises.entries()).map(async ([id, p]) => ({ id, result: await p }))
      );

      runningPromises.delete(completedResult.id);
      results.push(completedResult.result);

      if (completedResult.result.status === 'failed') {
        this.emit({
          type: 'task_failed',
          result: completedResult.result,
          continueExecution: this.config.continueOnError,
        });

        if (!this.config.continueOnError) {
          this.isShuttingDown = true;
        }
      } else if (completedResult.result.status === 'completed') {
        this.emit({ type: 'task_completed', result: completedResult.result });
      }
    }

    for (const [taskId] of runningPromises) {
      const ctx = this.activeExecutions.get(taskId);
      if (ctx) {
        ctx.abortController.abort();
        results.push(this.createCancelledResult(ctx, 'Execution shutdown'));
      }
    }

    const endedAt = new Date();
    const durationMs = endedAt.getTime() - startedAt.getTime();

    const completedTasks = results.filter(r => r.status === 'completed').length;
    const failedTasks = results.filter(r => r.status === 'failed').length;
    const cancelledTasks = results.filter(r => r.status === 'cancelled').length;

    this.updateStats(results, durationMs);

    let failureReport: ParallelExecutionFailureReport | undefined;
    if (failedTasks > 0 && this.config.generateDetailedReports) {
      failureReport = this.generateFailureReport(results, workUnits, durationMs);
      this.emit({ type: 'failure_report_generated', report: failureReport });
    }

    const executionResult: ParallelExecutionResult = {
      success: failedTasks === 0,
      totalTasks: results.length,
      completedTasks,
      failedTasks,
      cancelledTasks,
      results,
      failureReport,
      startedAt,
      endedAt,
      durationMs,
    };

    this.emit({ type: 'execution_completed', result: executionResult });

    return executionResult;
  }

  private async executeTask(task: GraphTask, workUnit: ParallelWorkUnit): Promise<ParallelTaskResult> {
    const startedAt = new Date();
    const agentId = `agent-${randomUUID().slice(0, 8)}`;
    const abortController = new AbortController();

    const ctx: TaskExecutionContext = {
      task,
      workUnit,
      agentId,
      stdout: '',
      stderr: '',
      startedAt,
      abortController,
    };

    this.activeExecutions.set(task.id, ctx);
    this.stats.totalTasksExecuted++;

    try {
      const worktreeResult = await this.worktreeManager.acquire({
        baseName: `task-${task.id}`,
        taskId: task.id,
        agentId,
      });

      if (!worktreeResult.success) {
        throw this.createExecutionError(
          `Failed to acquire worktree: ${worktreeResult.reason}`,
          'worktree_acquisition'
        );
      }

      ctx.worktree = worktreeResult.worktree;
      this.coordinator.registerAgent(agentId, `Agent for ${task.title}`, worktreeResult.worktree.id, task.id);

      this.emit({
        type: 'task_started',
        task,
        worktree: worktreeResult.worktree,
        agentId,
      });

      const agentResult = await this.runAgentInWorktree(ctx);

      const endedAt = new Date();
      const durationMs = endedAt.getTime() - startedAt.getTime();

      if (!this.config.preserveFailedWorktrees || agentResult.success) {
        await this.worktreeManager.release(worktreeResult.worktree.id);
      } else if (agentResult.error) {
        this.emit({
          type: 'worktree_preserved',
          worktreeId: worktreeResult.worktree.id,
          path: worktreeResult.worktree.path,
          taskId: task.id,
          error: agentResult.error.message,
        });
        this.stats.worktreesPreserved++;
      }

      this.coordinator.unregisterAgent(agentId);
      this.activeExecutions.delete(task.id);

      const status: ParallelTaskStatus = agentResult.success ? 'completed' : 'failed';
      if (agentResult.success) {
        this.stats.totalTasksCompleted++;
      } else {
        this.stats.totalTasksFailed++;
      }

      return {
        task,
        status,
        worktree: worktreeResult.worktree,
        startedAt,
        endedAt,
        durationMs,
        stdout: ctx.stdout,
        stderr: ctx.stderr,
        exitCode: agentResult.exitCode,
        error: agentResult.error,
        subagentSummary: agentResult.subagentSummary,
      };
    } catch (error) {
      const endedAt = new Date();
      const durationMs = endedAt.getTime() - startedAt.getTime();

      const executionError = this.toExecutionError(error);
      this.stats.totalTasksFailed++;

      if (ctx.worktree && this.config.preserveFailedWorktrees) {
        this.emit({
          type: 'worktree_preserved',
          worktreeId: ctx.worktree.id,
          path: ctx.worktree.path,
          taskId: task.id,
          error: executionError.message,
        });
        this.stats.worktreesPreserved++;
      }

      this.coordinator.unregisterAgent(agentId);
      this.activeExecutions.delete(task.id);

      return {
        task,
        status: 'failed',
        worktree: ctx.worktree,
        startedAt,
        endedAt,
        durationMs,
        stdout: ctx.stdout,
        stderr: ctx.stderr,
        error: executionError,
      };
    }
  }

  private async runAgentInWorktree(
    ctx: TaskExecutionContext
  ): Promise<{ success: boolean; exitCode?: number; error?: TaskExecutionError; subagentSummary?: SubagentTraceSummary }> {
    const { signal } = ctx.abortController;

    if (!ctx.worktree) {
      return {
        success: false,
        error: this.createExecutionError('No worktree available', 'worktree_acquisition'),
      };
    }

    const agentConfig: ParallelAgentConfig = {
      agentId: this.config.agentId,
      model: this.config.agentModel,
      enableSubagentTracing: this.config.enableSubagentTracing,
      options: this.config.agentOptions,
      timeout: this.config.taskTimeoutMs,
    };

    const prompt = this.buildPromptForTask(ctx.task);

    try {
      const result = await this.agentRunner.run({
        prompt,
        task: ctx.task,
        worktree: ctx.worktree,
        agentConfig,
        onStdout: (chunk) => {
          ctx.stdout += chunk;
          if (ctx.stdout.length > this.config.maxOutputSizeBytes) {
            ctx.stdout = ctx.stdout.slice(-this.config.maxOutputSizeBytes);
          }
          this.emit({
            type: 'task_output',
            taskId: ctx.task.id,
            agentId: ctx.agentId,
            stream: 'stdout',
            chunk,
          });
        },
        onStderr: (chunk) => {
          ctx.stderr += chunk;
          if (ctx.stderr.length > this.config.maxOutputSizeBytes) {
            ctx.stderr = ctx.stderr.slice(-this.config.maxOutputSizeBytes);
          }
          this.emit({
            type: 'task_output',
            taskId: ctx.task.id,
            agentId: ctx.agentId,
            stream: 'stderr',
            chunk,
          });
        },
        onSubagentEvent: (event) => {
          this.emit({
            type: 'subagent_event',
            taskId: ctx.task.id,
            agentId: ctx.agentId,
            event,
          });
        },
        signal,
        maxOutputSizeBytes: this.config.maxOutputSizeBytes,
      });

      if (result.success) {
        return {
          success: true,
          exitCode: result.exitCode,
          subagentSummary: result.subagentSummary,
        };
      } else {
        return {
          success: false,
          exitCode: result.exitCode,
          error: this.createExecutionError(
            result.error ?? `Agent exited with code ${result.exitCode}`,
            'agent_execution'
          ),
          subagentSummary: result.subagentSummary,
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: this.createExecutionError(message, 'agent_spawn'),
      };
    }
  }

  private buildPromptForTask(task: GraphTask): string {
    const lines: string[] = [];
    lines.push(`## Task: ${task.title}`);
    lines.push('');
    lines.push(`**Task ID**: ${task.id}`);
    lines.push(`**Priority**: ${task.priority}`);
    if (task.type) {
      lines.push(`**Type**: ${task.type}`);
    }
    if (task.labels && task.labels.length > 0) {
      lines.push(`**Labels**: ${task.labels.join(', ')}`);
    }
    lines.push('');
    lines.push('When finished, signal completion with:');
    lines.push('<promise>COMPLETE</promise>');
    return lines.join('\n');
  }

  private createCancelledResult(ctx: TaskExecutionContext, reason: string): ParallelTaskResult {
    const endedAt = new Date();
    this.stats.totalTasksCancelled++;
    this.emit({ type: 'task_cancelled', task: ctx.task, reason });

    return {
      task: ctx.task,
      status: 'cancelled',
      worktree: ctx.worktree,
      startedAt: ctx.startedAt,
      endedAt,
      durationMs: endedAt.getTime() - ctx.startedAt.getTime(),
      stdout: ctx.stdout,
      stderr: ctx.stderr,
      error: this.createExecutionError(reason, 'unknown'),
    };
  }

  private createExecutionError(message: string, phase: TaskFailurePhase): TaskExecutionError {
    return {
      message,
      phase,
      occurredAt: new Date(),
    };
  }

  private toExecutionError(error: unknown): TaskExecutionError {
    if (error instanceof Error) {
      return {
        message: error.message,
        stack: error.stack,
        phase: 'unknown',
        occurredAt: new Date(),
      };
    }
    return {
      message: String(error),
      phase: 'unknown',
      occurredAt: new Date(),
    };
  }

  private generateFailureReport(
    results: ParallelTaskResult[],
    workUnits: ParallelWorkUnit[],
    totalDurationMs: number
  ): ParallelExecutionFailureReport {
    const failedResults = results.filter(r => r.status === 'failed');
    const completedCount = results.filter(r => r.status === 'completed').length;
    const cancelledCount = results.filter(r => r.status === 'cancelled').length;

    const summary: FailureSummary = {
      totalTasks: results.length,
      completedTasks: completedCount,
      failedTasks: failedResults.length,
      cancelledTasks: cancelledCount,
      totalDurationMs,
      successRate: results.length > 0 ? (completedCount / results.length) * 100 : 0,
      hasBlockingFailures: failedResults.length > 0,
    };

    const failures: FailureAttribution[] = failedResults.map(result => {
      const workUnit = workUnits.find(wu => wu.tasks.some(t => t.id === result.task.id));
      const ctx = this.activeExecutions.get(result.task.id);
      
      return {
        taskId: result.task.id,
        taskTitle: result.task.title,
        agentId: ctx?.agentId ?? 'unknown',
        agentName: ctx?.agentId,
        worktreeId: result.worktree?.id ?? 'unknown',
        worktreePath: result.worktree?.path ?? 'unknown',
        workUnitId: workUnit?.id ?? 'unknown',
        workUnitName: workUnit?.name ?? 'unknown',
        error: result.error ?? { message: 'Unknown error', phase: 'unknown', occurredAt: new Date() },
        durationMs: result.durationMs ?? 0,
      };
    });

    const failedAgentLogs: FailedAgentLog[] = failedResults.map(result => {
      const attribution = failures.find(f => f.taskId === result.task.id)!;
      return {
        attribution,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        exitCode: result.exitCode,
      };
    });

    const preservedWorktrees = failedResults
      .filter(r => r.worktree && this.config.preserveFailedWorktrees)
      .map(r => ({
        worktreeId: r.worktree!.id,
        path: r.worktree!.path,
        branch: r.worktree!.branch,
        taskId: r.task.id,
        errorMessage: r.error?.message ?? 'Unknown error',
      }));

    const formattedReport = this.formatReport(summary, failures, failedAgentLogs, preservedWorktrees);

    return {
      id: randomUUID(),
      generatedAt: new Date(),
      summary,
      failures,
      failedAgentLogs,
      workUnits,
      preservedWorktrees,
      formattedReport,
    };
  }

  private formatReport(
    summary: FailureSummary,
    failures: FailureAttribution[],
    logs: FailedAgentLog[],
    preservedWorktrees: Array<{ worktreeId: string; path: string; branch: string; taskId: string; errorMessage: string }>
  ): string {
    const lines: string[] = [];

    lines.push('# Parallel Execution Failure Report');
    lines.push('');
    lines.push('## Summary');
    lines.push(`- **Total Tasks**: ${summary.totalTasks}`);
    lines.push(`- **Completed**: ${summary.completedTasks}`);
    lines.push(`- **Failed**: ${summary.failedTasks}`);
    lines.push(`- **Cancelled**: ${summary.cancelledTasks}`);
    lines.push(`- **Success Rate**: ${summary.successRate.toFixed(1)}%`);
    lines.push(`- **Total Duration**: ${(summary.totalDurationMs / 1000).toFixed(2)}s`);
    lines.push('');

    if (failures.length > 0) {
      lines.push('## Failure Details');
      lines.push('');
      for (const failure of failures) {
        lines.push(`### Task: ${failure.taskTitle}`);
        lines.push(`- **Task ID**: ${failure.taskId}`);
        lines.push(`- **Agent ID**: ${failure.agentId}`);
        lines.push(`- **Work Unit**: ${failure.workUnitName}`);
        lines.push(`- **Worktree Path**: ${failure.worktreePath}`);
        lines.push(`- **Error Phase**: ${failure.error.phase}`);
        lines.push(`- **Error Message**: ${failure.error.message}`);
        lines.push(`- **Duration Before Failure**: ${failure.durationMs}ms`);
        lines.push('');
      }
    }

    if (preservedWorktrees.length > 0) {
      lines.push('## Preserved Worktrees for Debugging');
      lines.push('');
      for (const wt of preservedWorktrees) {
        lines.push(`- **${wt.taskId}**: \`${wt.path}\` (branch: \`${wt.branch}\`)`);
        lines.push(`  Error: ${wt.errorMessage}`);
      }
      lines.push('');
    }

    if (logs.length > 0) {
      lines.push('## Detailed Logs Per Failed Agent');
      lines.push('');
      for (const log of logs) {
        lines.push(`### Agent: ${log.attribution.agentId}`);
        lines.push(`Task: ${log.attribution.taskTitle}`);
        if (log.exitCode !== undefined) {
          lines.push(`Exit Code: ${log.exitCode}`);
        }
        if (log.stderr) {
          lines.push('');
          lines.push('**stderr:**');
          lines.push('```');
          lines.push(log.stderr.slice(0, 2000));
          if (log.stderr.length > 2000) {
            lines.push('... (truncated)');
          }
          lines.push('```');
        }
        if (log.stdout) {
          lines.push('');
          lines.push('**stdout (last 500 chars):**');
          lines.push('```');
          lines.push(log.stdout.slice(-500));
          lines.push('```');
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private updateStats(results: ParallelTaskResult[], durationMs: number): void {
    this.stats.totalExecutionTimeMs += durationMs;

    const totalDurationFromTasks = results
      .filter(r => r.durationMs !== undefined)
      .reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
    
    const tasksWithDuration = results.filter(r => r.durationMs !== undefined).length;
    if (tasksWithDuration > 0) {
      const prevTotal = this.stats.avgTaskDurationMs * (this.stats.totalTasksExecuted - results.length);
      this.stats.avgTaskDurationMs = (prevTotal + totalDurationFromTasks) / this.stats.totalTasksExecuted;
    }

    this.stats.lastExecutionAt = new Date();
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    for (const [, ctx] of this.activeExecutions) {
      ctx.abortController.abort();
    }

    this.coordinator.stop();
  }

  getStats(): ParallelExecutorStats {
    return { ...this.stats };
  }

  async dispose(): Promise<void> {
    await this.shutdown();
    await this.worktreeManager.cleanupAll({ force: true });
    await this.agentRunner.dispose();
  }
}
