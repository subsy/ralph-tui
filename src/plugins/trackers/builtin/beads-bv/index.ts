/**
 * ABOUTME: Beads + Beads Viewer (bv) tracker plugin for smart task selection.
 * Uses bv's graph-aware algorithms (PageRank, critical path) for optimal task ordering.
 * Extends the base Beads tracker with intelligent task prioritization via bv.
 * Falls back to standard beads behavior when bv is unavailable.
 */

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { BeadsTrackerPlugin } from '../beads/index.js';
import { BEADS_BV_TEMPLATE } from '../../../../templates/builtin.js';
import type {
  TrackerPluginMeta,
  TrackerPluginFactory,
  TrackerTask,
  TrackerTaskStatus,
  TaskPriority,
  TaskFilter,
  TaskCompletionResult,
  SetupQuestion,
} from '../../types.js';

/**
 * Recommendation from bv --robot-triage output.
 */
interface BvRecommendation {
  id: string;
  title: string;
  type?: string;
  status: string;
  priority: number;
  labels?: string[];
  score: number;
  breakdown?: Record<string, number | string | Record<string, unknown>>;
  action?: string;
  reasons: string[];
  unblocks?: number;
  blocked_by?: string[];
}

/**
 * Output from bv --robot-next when an actionable task exists.
 * Unlike --robot-triage recommendations, --robot-next is guaranteed
 * to return only an unblocked task.
 */
interface BvRobotNextTask {
  generated_at: string;
  data_hash: string;
  output_format: string;
  id: string;
  title: string;
  score: number;
  reasons: string[];
  unblocks: number;
  claim_command: string;
  show_command: string;
}

/**
 * Output from bv --robot-next when no actionable items are available.
 */
interface BvRobotNextEmpty {
  generated_at: string;
  data_hash: string;
  output_format: string;
  message: string;
}

/**
 * Discriminated union for bv --robot-next output.
 * Use `'message' in output` to narrow between the two shapes.
 */
type BvRobotNextOutput = BvRobotNextTask | BvRobotNextEmpty;

/**
 * Top pick from bv quick_ref section.
 */
interface BvTopPick {
  id: string;
  title: string;
  score: number;
  reasons: string[];
  unblocks: number;
}

/**
 * Structure of bv --robot-triage JSON output.
 */
interface BvTriageOutput {
  generated_at: string;
  data_hash: string;
  triage: {
    meta: {
      version: string;
      generated_at: string;
      phase2_ready: boolean;
      issue_count: number;
      compute_time_ms: number;
    };
    quick_ref: {
      open_count: number;
      actionable_count: number;
      blocked_count: number;
      in_progress_count: number;
      top_picks: BvTopPick[];
    };
    recommendations: BvRecommendation[];
    quick_wins?: BvRecommendation[];
    blockers_to_clear?: BvRecommendation[];
  };
}

/**
 * Result of detect() operation including bv availability.
 */
interface DetectResult {
  available: boolean;
  beadsDir?: string;
  bdPath?: string;
  bdVersion?: string;
  bvPath?: string;
  bvAvailable: boolean;
  error?: string;
}

/**
 * Task reasoning information from bv analysis.
 * Provides insights into why a task was selected.
 */
export interface TaskReasoning {
  /** Task ID this reasoning applies to */
  taskId: string;
  /** Composite score from bv (0-1 scale) */
  score: number;
  /** Human-readable reasons for selection */
  reasons: string[];
  /** Number of tasks this unblocks when completed */
  unblocks: number;
  /** Detailed score breakdown (optional) */
  breakdown?: {
    pagerank?: number;
    betweenness?: number;
    blockerRatio?: number;
    staleness?: number;
    priorityBoost?: number;
    timeToImpact?: number;
    urgency?: number;
    risk?: number;
  };
}


/**
 * Execute a bv command and return the output.
 */
async function execBv(
  args: string[],
  cwd?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn('bv', args, {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on('error', (err) => {
      stderr += err.message;
      resolve({ stdout, stderr, exitCode: 1 });
    });
  });
}

/**
 * Execute a bd command and return the output.
 */
async function execBd(
  args: string[],
  cwd?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn('bd', args, {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on('error', (err) => {
      stderr += err.message;
      resolve({ stdout, stderr, exitCode: 1 });
    });
  });
}



/**
 * Beads + bv tracker plugin implementation.
 * Uses bv robot flags for dependency-aware task selection.
 * Falls back to standard beads behavior when bv is unavailable.
 */
export class BeadsBvTrackerPlugin extends BeadsTrackerPlugin {
  override readonly meta: TrackerPluginMeta = {
    id: 'beads-bv',
    name: 'Beads + Beads Viewer (Smart Mode)',
    description:
      'Smart task selection using bv graph analysis (PageRank, critical path)',
    version: '1.0.0',
    supportsBidirectionalSync: true,
    supportsHierarchy: true,
    supportsDependencies: true,
  };

  private bvAvailable = false;
  private lastTriageOutput: BvTriageOutput | null = null;
  private taskReasoningCache: Map<string, TaskReasoning> = new Map();

  override async initialize(config: Record<string, unknown>): Promise<void> {
    // Initialize base beads plugin
    await super.initialize(config);

    // Check if bv is available
    const detection = await this.detect();
    this.bvAvailable = detection.bvAvailable;
    this.ready = detection.available;
  }

  /**
   * Detect if beads and bv are available in the current environment.
   * Checks for .beads/ directory, bd binary, and bv binary.
   */
  override async detect(): Promise<DetectResult> {
    // First check beads availability via parent class
    const workingDir = this.getWorkingDir();
    const beadsDir = join(workingDir, this.getBeadsDir());
    try {
      await access(beadsDir, constants.R_OK);
    } catch {
      return {
        available: false,
        bvAvailable: false,
        error: `Beads directory not found: ${beadsDir}`,
      };
    }

    // Check for bd binary
    const bdResult = await execBd(['--version'], workingDir);
    if (bdResult.exitCode !== 0) {
      return {
        available: false,
        bvAvailable: false,
        error: `bd binary not available: ${bdResult.stderr}`,
      };
    }

    const bdVersionMatch = bdResult.stdout.match(/bd version (\S+)/);
    const bdVersion = bdVersionMatch ? bdVersionMatch[1] : 'unknown';

    // Check for bv binary
    const bvResult = await execBv(['--version'], workingDir);
    const bvAvailable = bvResult.exitCode === 0;

    return {
      available: true,
      beadsDir,
      bdPath: 'bd',
      bdVersion,
      bvPath: bvAvailable ? 'bv' : undefined,
      bvAvailable,
    };
  }

  override getSetupQuestions(): SetupQuestion[] {
    // Include parent questions (no bv-specific config needed)
    return super.getSetupQuestions();
  }

  override async validateSetup(
    answers: Record<string, unknown>
  ): Promise<string | null> {
    // First validate beads setup
    const beadsValidation = await super.validateSetup(answers);
    if (beadsValidation) {
      return beadsValidation;
    }

    // Check bv availability (warning, not error - we can fall back)
    const detection = await this.detect();
    if (!detection.bvAvailable) {
      // Not an error - just a warning that will use fallback
      console.warn(
        'Warning: bv binary not found. Smart task selection will fall back to basic beads behavior.'
      );
    }

    return null;
  }

  /**
   * Get the next task using bv's smart algorithms.
   * Uses bv --robot-next which returns only the single best *unblocked* task.
   * Falls back to base beads behavior if bv is unavailable.
   *
   * Note: --robot-next is used instead of --robot-triage because triage
   * recommendations include blocked tasks ranked by score. A blocked task
   * with high graph importance (e.g., a review bead that unblocks many
   * downstream tasks) can outscore actionable tasks, causing ralph-tui to
   * select tasks whose dependencies haven't been completed yet.
   * See: https://github.com/subsy/ralph-tui/issues/327
   */
  override async getNextTask(
    filter?: TaskFilter
  ): Promise<TrackerTask | undefined> {
    // If bv is not available, fall back to base beads behavior
    if (!this.bvAvailable) {
      return super.getNextTask(filter);
    }

    try {
      // Use --robot-next for task selection: guaranteed to return only
      // an unblocked task, unlike --robot-triage which includes blocked
      // tasks in its recommendations array.
      const args = ['--robot-next'];

      // Apply label filter if configured
      const labels = this.getLabels();
      if (filter?.labels && filter.labels.length > 0) {
        args.push('--label', filter.labels[0]!);
      } else if (labels.length > 0) {
        args.push('--label', labels[0]!);
      }

      const { stdout, exitCode, stderr } = await execBv(args, this.getWorkingDir());

      if (exitCode !== 0) {
        console.error('bv --robot-next failed:', stderr);
        // Fall back to base beads behavior
        return super.getNextTask(filter);
      }

      // Parse bv output
      let nextOutput: BvRobotNextOutput;
      try {
        nextOutput = JSON.parse(stdout) as BvRobotNextOutput;
      } catch (err) {
        console.error('Failed to parse bv output:', err);
        return super.getNextTask(filter);
      }

      // --robot-next returns { message: "No actionable items available" }
      // when nothing is unblocked. The discriminated union narrows the
      // type: after this guard, TypeScript knows nextOutput is BvRobotNextTask.
      if ('message' in nextOutput) {
        return super.getNextTask(filter);
      }

      // Verify the selected task belongs to the epic if epicId is set
      const epicId = this.getEpicId();
      if (filter?.parentId || epicId) {
        const parentId = filter?.parentId ?? epicId;
        const epicChildren = await this.getEpicChildrenIds(parentId);
        if (!epicChildren.includes(nextOutput.id)) {
          // bv's top pick isn't in our epic — fall back to base beads
          // which filters by epic natively
          return super.getNextTask(filter);
        }
      }

      // Refresh triage data in background for metadata enrichment
      // (getTasks, cacheTaskReasoning, getTriageStats still use triage data)
      void this.refreshTriage();

      // Get full task details from bd for complete information
      const fullTask = await this.getTask(nextOutput.id);
      if (fullTask) {
        // Augment with bv metadata from --robot-next
        fullTask.metadata = {
          ...fullTask.metadata,
          bvScore: nextOutput.score,
          bvReasons: nextOutput.reasons,
          bvUnblocks: nextOutput.unblocks,
        };
        return fullTask;
      }

      // Fallback: construct task from --robot-next output
      // (--robot-next doesn't include priority, default to P2)
      return {
        id: nextOutput.id,
        title: nextOutput.title,
        status: 'open' as TrackerTaskStatus,
        priority: 2 as TaskPriority,
        metadata: {
          bvScore: nextOutput.score,
          bvReasons: nextOutput.reasons,
          bvUnblocks: nextOutput.unblocks,
        },
      };
    } catch (err) {
      console.error('Error in getNextTask:', err);
      return super.getNextTask(filter);
    }
  }

  /**
   * Get all tasks, optionally augmented with bv scoring data.
   * Uses bd list for the base data and adds bv recommendations if available.
   */
  override async getTasks(filter?: TaskFilter): Promise<TrackerTask[]> {
    // Get tasks from base beads plugin
    const tasks = await super.getTasks(filter);

    // If bv is available, augment with scoring data
    if (this.bvAvailable && this.lastTriageOutput) {
      const recommendationMap = new Map<string, BvRecommendation>();
      for (const rec of this.lastTriageOutput.triage.recommendations) {
        recommendationMap.set(rec.id, rec);
      }

      for (const task of tasks) {
        const rec = recommendationMap.get(task.id);
        if (rec) {
          task.metadata = {
            ...task.metadata,
            bvScore: rec.score,
            bvReasons: rec.reasons,
            bvUnblocks: rec.unblocks,
          };
        }
      }
    }

    return tasks;
  }

  /**
   * Get the reasoning for why a task was selected by bv.
   * Returns cached reasoning from the last triage operation.
   */
  getTaskReasoning(taskId: string): TaskReasoning | undefined {
    return this.taskReasoningCache.get(taskId);
  }

  /**
   * Get reasoning for all cached tasks.
   */
  getAllTaskReasoning(): Map<string, TaskReasoning> {
    return new Map(this.taskReasoningCache);
  }

  /**
   * Force refresh of bv triage data.
   * Useful when tasks have changed and you want fresh recommendations.
   */
  async refreshTriage(): Promise<void> {
    if (!this.bvAvailable) {
      return;
    }

    const args = ['--robot-triage'];
    const labels = this.getLabels();
    if (labels.length > 0) {
      args.push('--label', labels[0]!);
    }

    const { stdout, exitCode } = await execBv(args, this.getWorkingDir());

    if (exitCode === 0) {
      try {
        this.lastTriageOutput = JSON.parse(stdout) as BvTriageOutput;
        this.cacheTaskReasoning(this.lastTriageOutput);
      } catch {
        // Ignore parse errors
      }
    }
  }

  /**
   * Check if bv is available for smart task selection.
   */
  isBvAvailable(): boolean {
    return this.bvAvailable;
  }

  /**
   * Get quick reference stats from last triage.
   */
  getTriageStats():
    | {
        openCount: number;
        actionableCount: number;
        blockedCount: number;
        inProgressCount: number;
      }
    | undefined {
    if (!this.lastTriageOutput) {
      return undefined;
    }

    const qr = this.lastTriageOutput.triage.quick_ref;
    return {
      openCount: qr.open_count,
      actionableCount: qr.actionable_count,
      blockedCount: qr.blocked_count,
      inProgressCount: qr.in_progress_count,
    };
  }

  /**
   * Override completeTask to refresh triage data after completion.
   */
  override async completeTask(
    id: string,
    reason?: string
  ): Promise<TaskCompletionResult> {
    const result = await super.completeTask(id, reason);

    // Clear cached reasoning for completed task
    this.taskReasoningCache.delete(id);

    // Refresh triage data asynchronously
    if (result.success && this.bvAvailable) {
      // Don't await - let it refresh in background
      void this.refreshTriage();
    }

    return result;
  }

  /**
   * Override updateTaskStatus to refresh triage data after status change.
   */
  override async updateTaskStatus(
    id: string,
    status: TrackerTaskStatus
  ): Promise<TrackerTask | undefined> {
    const result = await super.updateTaskStatus(id, status);

    // Refresh triage data asynchronously
    if (result && this.bvAvailable) {
      void this.refreshTriage();
    }

    return result;
  }

  // Private helper methods

  /**
   * Cache task reasoning from triage output.
   */
  private cacheTaskReasoning(triageOutput: BvTriageOutput): void {
    this.taskReasoningCache.clear();

    for (const rec of triageOutput.triage.recommendations) {
      const reasoning: TaskReasoning = {
        taskId: rec.id,
        score: rec.score,
        reasons: rec.reasons,
        unblocks: rec.unblocks ?? 0,
      };

      // Parse breakdown if available
      if (rec.breakdown) {
        reasoning.breakdown = {
          pagerank:
            typeof rec.breakdown.pagerank === 'number'
              ? rec.breakdown.pagerank
              : undefined,
          betweenness:
            typeof rec.breakdown.betweenness === 'number'
              ? rec.breakdown.betweenness
              : undefined,
          blockerRatio:
            typeof rec.breakdown.blocker_ratio === 'number'
              ? rec.breakdown.blocker_ratio
              : undefined,
          staleness:
            typeof rec.breakdown.staleness === 'number'
              ? rec.breakdown.staleness
              : undefined,
          priorityBoost:
            typeof rec.breakdown.priority_boost === 'number'
              ? rec.breakdown.priority_boost
              : undefined,
          timeToImpact:
            typeof rec.breakdown.time_to_impact === 'number'
              ? rec.breakdown.time_to_impact
              : undefined,
          urgency:
            typeof rec.breakdown.urgency === 'number'
              ? rec.breakdown.urgency
              : undefined,
          risk:
            typeof rec.breakdown.risk === 'number'
              ? rec.breakdown.risk
              : undefined,
        };
      }

      this.taskReasoningCache.set(rec.id, reasoning);
    }
  }

  /**
   * Get all child task IDs for an epic.
   */
  private async getEpicChildrenIds(epicId: string): Promise<string[]> {
    const { stdout, exitCode } = await execBd(
      ['list', '--json', '--parent', epicId, '--limit', '0'],
      this.getWorkingDir()
    );

    if (exitCode !== 0) {
      return [];
    }

    try {
      const beads = JSON.parse(stdout) as Array<{ id: string }>;
      return beads.map((b) => b.id);
    } catch {
      return [];
    }
  }

  // Helper methods to access config values (since parent properties are protected)
  private getWorkingDir(): string {
    return (this.config.workingDir as string) ?? process.cwd();
  }

  private getBeadsDir(): string {
    return (this.config.beadsDir as string) ?? '.beads';
  }

  private getLabels(): string[] {
    // Use the labels parsed by parent's initialize() method
    return this.labels;
  }

  /**
   * Get the prompt template for the Beads+bv tracker.
   * Returns the embedded template to avoid path resolution issues in bundled environments.
   * See: https://github.com/subsy/ralph-tui/issues/248
   */
  override getTemplate(): string {
    return BEADS_BV_TEMPLATE;
  }
}

/**
 * Factory function for the Beads+bv tracker plugin.
 */
const createBeadsBvTracker: TrackerPluginFactory = () =>
  new BeadsBvTrackerPlugin();

export default createBeadsBvTracker;
