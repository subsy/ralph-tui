/**
 * ABOUTME: Beads + Beads Viewer (bv) tracker plugin for smart task selection.
 * Uses bv's graph-aware algorithms (PageRank, critical path) for optimal task ordering.
 * Extends the base Beads tracker with intelligent task prioritization via bv.
 * Falls back to standard beads behavior when bv is unavailable.
 */

import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BeadsTrackerPlugin } from '../beads/index.js';
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
}

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
 * Get the directory containing this module (for locating template.hbs).
 */
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Cache for the template content to avoid repeated file reads.
 */
let templateCache: string | null = null;

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
 * Convert bv priority (0-4) to TaskPriority.
 */
function mapPriority(priority: number): TaskPriority {
  const clamped = Math.max(0, Math.min(4, priority));
  return clamped as TaskPriority;
}

/**
 * Convert bv status to TrackerTaskStatus.
 */
function mapStatus(status: string): TrackerTaskStatus {
  switch (status) {
    case 'open':
      return 'open';
    case 'in_progress':
      return 'in_progress';
    case 'closed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'open';
  }
}

/**
 * Convert TrackerTaskStatus back to bd status.
 */
function mapStatusToBd(status: TrackerTaskStatus): string {
  switch (status) {
    case 'open':
      return 'open';
    case 'in_progress':
      return 'in_progress';
    case 'completed':
      return 'closed';
    case 'cancelled':
      return 'cancelled';
    case 'blocked':
      return 'open';
    default:
      return 'open';
  }
}

/**
 * Convert a BvRecommendation to TrackerTask.
 */
function recommendationToTask(rec: BvRecommendation): TrackerTask {
  return {
    id: rec.id,
    title: rec.title,
    status: mapStatus(rec.status),
    priority: mapPriority(rec.priority),
    labels: rec.labels,
    type: rec.type,
    metadata: {
      bvScore: rec.score,
      bvReasons: rec.reasons,
      bvUnblocks: rec.unblocks,
      bvBreakdown: rec.breakdown,
    },
  };
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
   * Uses bv --robot-triage for optimal task selection.
   * Falls back to base beads behavior if bv is unavailable.
   */
  override async getNextTask(
    filter?: TaskFilter
  ): Promise<TrackerTask | undefined> {
    // If bv is not available, fall back to base beads behavior
    if (!this.bvAvailable) {
      return super.getNextTask(filter);
    }

    try {
      // Build bv command args
      const args = ['--robot-triage'];

      // Apply label filter if configured
      const labels = this.getLabels();
      if (filter?.labels && filter.labels.length > 0) {
        args.push('--label', filter.labels[0]!);
      } else if (labels.length > 0) {
        args.push('--label', labels[0]!);
      }

      const { stdout, exitCode, stderr } = await execBv(args, this.getWorkingDir());

      if (exitCode !== 0) {
        console.error('bv --robot-triage failed:', stderr);
        // Fall back to base beads behavior
        return super.getNextTask(filter);
      }

      // Parse bv output
      let triageOutput: BvTriageOutput;
      try {
        triageOutput = JSON.parse(stdout) as BvTriageOutput;
        this.lastTriageOutput = triageOutput;
      } catch (err) {
        console.error('Failed to parse bv output:', err);
        return super.getNextTask(filter);
      }

      // Cache reasoning for all recommendations
      this.cacheTaskReasoning(triageOutput);

      // Filter recommendations to epic children if epicId is set
      let recommendations = triageOutput.triage.recommendations;

      const epicId = this.getEpicId();
      if (filter?.parentId || epicId) {
        const parentId = filter?.parentId ?? epicId;
        // Get all epic children to filter recommendations
        const epicChildren = await this.getEpicChildrenIds(parentId);
        recommendations = recommendations.filter((rec) =>
          epicChildren.includes(rec.id)
        );
      }

      // Filter by status if specified
      if (filter?.status) {
        const statuses = Array.isArray(filter.status)
          ? filter.status
          : [filter.status];
        const bdStatuses = statuses.map(mapStatusToBd);
        recommendations = recommendations.filter((rec) =>
          bdStatuses.includes(rec.status)
        );
      }

      // Return the top recommendation
      if (recommendations.length === 0) {
        return undefined;
      }

      const topRec = recommendations[0]!;

      // Get full task details from bd for complete information
      const fullTask = await this.getTask(topRec.id);
      if (fullTask) {
        // Augment with bv metadata
        fullTask.metadata = {
          ...fullTask.metadata,
          bvScore: topRec.score,
          bvReasons: topRec.reasons,
          bvUnblocks: topRec.unblocks,
          bvBreakdown: topRec.breakdown,
        };
        return fullTask;
      }

      // Fallback to recommendation data if bd show fails
      return recommendationToTask(topRec);
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
      ['list', '--json', '--parent', epicId],
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
   * Reads from the co-located template.hbs file.
   */
  override getTemplate(): string {
    // Return cached template if available
    if (templateCache !== null) {
      return templateCache;
    }

    // Read template from co-located file
    const templatePath = join(__dirname, 'template.hbs');
    try {
      templateCache = readFileSync(templatePath, 'utf-8');
      return templateCache;
    } catch (err) {
      console.error(`Failed to read template from ${templatePath}:`, err);
      // Return a minimal fallback template
      return `## Task: {{taskTitle}}
{{#if taskDescription}}
{{taskDescription}}
{{/if}}

When finished, signal completion with:
<promise>COMPLETE</promise>
`;
    }
  }
}

/**
 * Factory function for the Beads+bv tracker plugin.
 */
const createBeadsBvTracker: TrackerPluginFactory = () =>
  new BeadsBvTrackerPlugin();

export default createBeadsBvTracker;
