/**
 * ABOUTME: Beads-rust tracker plugin (br CLI) for projects using the Rust beads fork.
 * Provides environment detection for beads-rust by checking for a .beads directory
 * and the presence of the br executable.
 */

import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { BaseTrackerPlugin } from '../../base.js';
import type {
  SyncResult,
  TaskCompletionResult,
  TaskFilter,
  TaskPriority,
  TrackerPluginFactory,
  TrackerPluginMeta,
  TrackerTask,
  TrackerTaskStatus,
} from '../../types.js';

/**
 * Raw task structure from br list --json output.
 *
 * Note: br is expected to be broadly compatible with bd output, but we only
 * rely on a small subset of fields.
 */
interface BrTaskJson {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: number;
  issue_type?: string;
  owner?: string;
  created_at?: string;
  updated_at?: string;
  labels?: string[];
  parent?: string;
  dependency_count?: number;
  dependent_count?: number;
  dependencies?: Array<{
    id: string;
    title: string;
    status: string;
    dependency_type: 'blocks' | 'parent-child';
  }>;
  dependents?: Array<{
    id: string;
    title: string;
    status: string;
    dependency_type: 'blocks' | 'parent-child';
  }>;
}

/**
 * Result of detect() operation.
 */
export interface BeadsRustDetectResult {
  available: boolean;
  beadsDir?: string;
  brPath?: string;
  brVersion?: string;
  error?: string;
}

/**
 * Execute a br command and return the output.
 */
async function execBr(
  args: string[],
  cwd?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn('br', args, {
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
 * Extract a version string from br --version output.
 *
 * Expected formats may include:
 * - "br version 1.2.3"
 * - "br 1.2.3"
 */
function extractBrVersion(stdout: string): string {
  const trimmed = stdout.trim();
  const match = trimmed.match(/\bbr\b(?:\s+version)?\s+(\S+)/i);
  return match?.[1] ?? 'unknown';
}

/**
 * Convert br status to TrackerTaskStatus.
 */
function mapStatus(brStatus: string): TrackerTaskStatus {
  const statusMap: Record<string, TrackerTaskStatus> = {
    open: 'open',
    in_progress: 'in_progress',
    closed: 'completed',
    cancelled: 'cancelled',
  };

  return statusMap[brStatus] ?? 'open';
}

/**
 * Convert TrackerTaskStatus back to br status.
 */
function mapStatusToBr(status: TrackerTaskStatus): string {
  const statusMap: Record<TrackerTaskStatus, string> = {
    open: 'open',
    in_progress: 'in_progress',
    completed: 'closed',
    cancelled: 'cancelled',
    // br doesn't have a dedicated blocked status; keep as open
    blocked: 'open',
  };

  return statusMap[status] ?? 'open';
}

/**
 * Convert br priority (0-4) to TaskPriority.
 */
function mapPriority(priority: number): TaskPriority {
  const clamped = Math.max(0, Math.min(4, priority));
  return clamped as TaskPriority;
}

/**
 * Convert a BrTaskJson object to TrackerTask.
 */
function brTaskToTask(task: BrTaskJson): TrackerTask {
  const dependsOn: string[] = [];
  const blocks: string[] = [];

  if (task.dependencies) {
    for (const dep of task.dependencies) {
      if (dep.dependency_type === 'blocks') {
        dependsOn.push(dep.id);
      }
    }
  }

  if (task.dependents) {
    for (const dep of task.dependents) {
      if (dep.dependency_type === 'blocks') {
        blocks.push(dep.id);
      }
    }
  }

  // Infer parentId from task ID if not provided.
  // e.g., "ralph-tui-45r.37" -> parent is "ralph-tui-45r"
  let parentId = task.parent;
  if (!parentId && task.id.includes('.')) {
    const lastDotIndex = task.id.lastIndexOf('.');
    parentId = task.id.substring(0, lastDotIndex);
  }

  const metadata: Record<string, unknown> = {};
  if (typeof task.dependency_count === 'number') {
    metadata.dependencyCount = task.dependency_count;
  }
  if (typeof task.dependent_count === 'number') {
    metadata.dependentCount = task.dependent_count;
  }

  return {
    id: task.id,
    title: task.title,
    status: mapStatus(task.status),
    priority: mapPriority(task.priority),
    description: task.description,
    labels: task.labels,
    type: task.issue_type,
    parentId,
    dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
    blocks: blocks.length > 0 ? blocks : undefined,
    assignee: task.owner,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

/**
 * Beads-rust tracker plugin implementation.
 *
 * Note: This initial implementation focuses on detection only.
 * Task operations are implemented incrementally in subsequent user stories.
 */
export class BeadsRustTrackerPlugin extends BaseTrackerPlugin {
  readonly meta: TrackerPluginMeta = {
    id: 'beads-rust',
    name: 'Beads Rust Issue Tracker',
    description: 'Track issues using the br (beads-rust) CLI',
    version: '1.0.0',
    supportsBidirectionalSync: true,
    supportsHierarchy: true,
    supportsDependencies: true,
  };

  /** Last detected br version (if available). */
  brVersion: string | undefined;

  private workingDir: string = process.cwd();
  private epicId: string = '';
  protected labels: string[] = [];

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (typeof config.workingDir === 'string') {
      this.workingDir = config.workingDir;
    }

    if (typeof config.epicId === 'string') {
      this.epicId = config.epicId;
    }

    if (typeof config.labels === 'string') {
      this.labels = config.labels.split(',').map((l) => l.trim()).filter(Boolean);
    } else if (Array.isArray(config.labels)) {
      this.labels = config.labels.filter((l): l is string => typeof l === 'string');
    }

    // Default readiness to false until we can detect beads-rust.
    const detection = await this.detect();
    this.ready = detection.available;
    this.brVersion = detection.brVersion;
  }

  /**
   * Detect if beads-rust is available in the current environment.
   * Checks for .beads/ directory and br binary.
   */
  async detect(): Promise<BeadsRustDetectResult> {
    const workingDir =
      typeof this.config.workingDir === 'string' ? this.config.workingDir : process.cwd();
    const beadsDir =
      typeof this.config.beadsDir === 'string' ? this.config.beadsDir : '.beads';

    // Check for .beads directory
    const beadsDirPath = join(workingDir, beadsDir);
    try {
      await access(beadsDirPath, constants.R_OK);
    } catch {
      return {
        available: false,
        error: `Beads directory not found: ${beadsDirPath}`,
      };
    }

    // Check for br binary
    const { stdout, stderr, exitCode } = await execBr(['--version'], workingDir);
    if (exitCode !== 0) {
      return {
        available: false,
        error: `br binary not available: ${stderr || stdout}`,
      };
    }

    const version = extractBrVersion(stdout);
    this.brVersion = version;

    return {
      available: true,
      beadsDir: beadsDirPath,
      brPath: 'br',
      brVersion: version,
    };
  }

  override async isReady(): Promise<boolean> {
    if (!this.ready) {
      const detection = await this.detect();
      this.ready = detection.available;
      this.brVersion = detection.brVersion;
    }
    return this.ready;
  }

  override async getTasks(filter?: TaskFilter): Promise<TrackerTask[]> {
    // Always include closed tasks; UI controls visibility.
    const args = ['list', '--json', '--all'];

    const parentId = filter?.parentId ?? this.epicId;
    if (parentId) {
      args.push('--parent', parentId);
    }

    const labelsToFilter =
      filter?.labels && filter.labels.length > 0 ? filter.labels : this.labels;
    if (labelsToFilter.length > 0) {
      args.push('--label', labelsToFilter.join(','));
    }

    if (filter?.status && !Array.isArray(filter.status)) {
      args.push('--status', mapStatusToBr(filter.status));
    }

    const { stdout, exitCode, stderr } = await execBr(args, this.workingDir);

    if (exitCode !== 0) {
      console.error('br list failed:', stderr);
      return [];
    }

    let tasksJson: BrTaskJson[];
    try {
      tasksJson = JSON.parse(stdout) as BrTaskJson[];
    } catch (err) {
      console.error('Failed to parse br list output:', err);
      return [];
    }

    let tasks = tasksJson.map(brTaskToTask);

    // If we already scoped to a parent via --parent, remove it from in-memory
    // filtering to avoid relying on parentId presence in JSON output.
    const filterWithoutParent = parentId
      ? filter
        ? { ...filter, parentId: undefined }
        : undefined
      : filter;
    tasks = this.filterTasks(tasks, filterWithoutParent);

    return tasks;
  }

  override async getTask(id: string): Promise<TrackerTask | undefined> {
    const { stdout, exitCode, stderr } = await execBr(
      ['show', id, '--json'],
      this.workingDir
    );

    if (exitCode !== 0) {
      console.error(`br show ${id} failed:`, stderr);
      return undefined;
    }

    let tasksJson: BrTaskJson[];
    try {
      tasksJson = JSON.parse(stdout) as BrTaskJson[];
    } catch (err) {
      console.error('Failed to parse br show output:', err);
      return undefined;
    }

    if (tasksJson.length === 0) {
      return undefined;
    }

    return brTaskToTask(tasksJson[0]!);
  }

  /**
   * Get the next task to work on using br ready.
   *
   * This overrides the base implementation to leverage br's server-side readiness
   * selection (dependency-aware), since br list output may not contain enough
   * dependency information for client-side readiness filtering.
   */
  override async getNextTask(filter?: TaskFilter): Promise<TrackerTask | undefined> {
    const args = ['ready', '--json'];

    // We only need one task, but fetch a small batch so we can prefer
    // in_progress tasks over open tasks.
    const requestedLimit =
      typeof filter?.limit === 'number' && filter.limit > 0 ? filter.limit : 10;
    args.push('--limit', String(Math.max(10, requestedLimit)));

    const parentId = filter?.parentId ?? this.epicId;
    if (parentId) {
      args.push('--parent', parentId);
    }

    const labelsToFilter =
      filter?.labels && filter.labels.length > 0 ? filter.labels : this.labels;
    if (labelsToFilter.length > 0) {
      args.push('--label', labelsToFilter.join(','));
    }

    if (filter?.priority !== undefined) {
      const priorities = Array.isArray(filter.priority)
        ? filter.priority
        : [filter.priority];
      // br ready only supports a single priority value; use the highest (lowest number).
      const highestPriority = Math.min(...priorities);
      args.push('--priority', String(highestPriority));
    }

    if (filter?.assignee) {
      args.push('--assignee', filter.assignee);
    }

    const { stdout, exitCode, stderr } = await execBr(args, this.workingDir);

    if (exitCode !== 0) {
      console.error('br ready failed:', stderr);
      return undefined;
    }

    let tasksJson: BrTaskJson[];
    try {
      tasksJson = JSON.parse(stdout) as BrTaskJson[];
    } catch (err) {
      console.error('Failed to parse br ready output:', err);
      return undefined;
    }

    if (tasksJson.length === 0) {
      return undefined;
    }

    let tasks = tasksJson.map(brTaskToTask);

    // Exclude specific task IDs (used by engine for skipped/failed tasks)
    if (filter?.excludeIds && filter.excludeIds.length > 0) {
      const excludeSet = new Set(filter.excludeIds);
      tasks = tasks.filter((t) => !excludeSet.has(t.id));
    }

    if (tasks.length === 0) {
      return undefined;
    }

    // Prefer in_progress tasks over open tasks
    const inProgress = tasks.find((t) => t.status === 'in_progress');
    if (inProgress) {
      return inProgress;
    }

    // br ready is expected to return tasks in a sensible order.
    return tasks[0];
  }

  override async completeTask(
    id: string,
    reason?: string
  ): Promise<TaskCompletionResult> {
    const args = ['close', id];

    if (typeof reason === 'string' && reason.trim().length > 0) {
      args.push('--reason', reason);
    }

    const { exitCode, stderr, stdout } = await execBr(args, this.workingDir);

    if (exitCode !== 0) {
      return {
        success: false,
        message: `Failed to close task ${id}`,
        error: stderr || stdout,
      };
    }

    // Fetch the updated task
    const task = await this.getTask(id);

    return {
      success: true,
      message: `Task ${id} closed successfully`,
      task,
    };
  }

  async updateTaskStatus(
    id: string,
    status: TrackerTaskStatus
  ): Promise<TrackerTask | undefined> {
    const brStatus = mapStatusToBr(status);
    const args = ['update', id, '--status', brStatus];

    const { exitCode, stderr } = await execBr(args, this.workingDir);

    if (exitCode !== 0) {
      console.error(`br update ${id} --status ${brStatus} failed:`, stderr);
      return undefined;
    }

    // Fetch and return the updated task
    return this.getTask(id);
  }

  override async sync(): Promise<SyncResult> {
    // Export tracker DB state to JSONL. This is intentionally flush-only and
    // does not run any git operations.
    const { exitCode, stderr, stdout } = await execBr(
      ['sync', '--flush-only'],
      this.workingDir
    );

    if (exitCode !== 0) {
      return {
        success: false,
        message: 'Beads-rust sync failed',
        error: stderr || stdout,
        syncedAt: new Date().toISOString(),
      };
    }

    return {
      success: true,
      message: 'Beads-rust tracker data flushed to JSONL',
      syncedAt: new Date().toISOString(),
    };
  }
}

/**
 * Factory function for the Beads-rust tracker plugin.
 */
const createBeadsRustTracker: TrackerPluginFactory = () => new BeadsRustTrackerPlugin();

export default createBeadsRustTracker;
