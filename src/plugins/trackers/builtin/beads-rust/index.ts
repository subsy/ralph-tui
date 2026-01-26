/**
 * ABOUTME: Beads-rust tracker plugin (br CLI) for projects using the Rust beads fork.
 * Provides environment detection for beads-rust by checking for a .beads directory
 * and the presence of the br executable.
 */

import { spawn } from 'node:child_process';
import { constants, readFileSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
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
 * Get the directory containing this module (for locating template.hbs).
 */
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Cache for the template content to avoid repeated file reads.
 */
let templateCache: string | null = null;

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
  external_ref?: string;
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
    /** br serializes dep_type as "type" via serde rename */
    type: 'blocks' | 'parent-child';
  }>;
  dependents?: Array<{
    id: string;
    title: string;
    status: string;
    /** br serializes dep_type as "type" via serde rename */
    type: 'blocks' | 'parent-child';
  }>;
}

/**
 * Output structure from br dep list --json.
 * Used to query parent-child relationships reliably.
 */
interface BrDepListItem {
  issue_id: string;
  depends_on_id: string;
  /** br serializes dep_type as "type" via serde rename */
  type: 'blocks' | 'parent-child';
  title: string;
  status: string;
  priority: number;
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
      if (dep.type === 'blocks') {
        dependsOn.push(dep.id);
      }
    }
  }

  if (task.dependents) {
    for (const dep of task.dependents) {
      if (dep.type === 'blocks') {
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

    // Note: br list doesn't support --parent, so we filter in-memory below
    const parentId = filter?.parentId ?? this.epicId;

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

    // Filter by parent (br list doesn't support --parent)
    // Always apply filter when parentId is set - empty childIds means no matching tasks
    if (parentId) {
      const childIds = await this.getChildIds(parentId);
      tasks = tasks.filter((t) => childIds.has(t.id));
    }

    // Apply remaining filters (excluding parentId which we handled above)
    const filterWithoutParent = parentId
      ? filter
        ? { ...filter, parentId: undefined }
        : undefined
      : filter;
    tasks = this.filterTasks(tasks, filterWithoutParent);

    return tasks;
  }

  /**
   * Get all available epics from the beads-rust tracker.
   * Queries for tasks with type='epic' and filters to top-level open/in_progress only.
   */
  override async getEpics(): Promise<TrackerTask[]> {
    const args = ['list', '--json', '--type', 'epic'];

    if (this.labels.length > 0) {
      args.push('--label', this.labels.join(','));
    }

    const { stdout, exitCode, stderr } = await execBr(args, this.workingDir);

    if (exitCode !== 0) {
      console.error('br list --type epic failed:', stderr);
      return [];
    }

    let tasksJson: BrTaskJson[];
    try {
      tasksJson = JSON.parse(stdout) as BrTaskJson[];
    } catch (err) {
      console.error('Failed to parse br list --type epic output:', err);
      return [];
    }

    const tasks = tasksJson.map(brTaskToTask);
    return tasks.filter(
      (t) =>
        !t.parentId && (t.status === 'open' || t.status === 'in_progress')
    );
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
  /**
   * Get child IDs for a parent epic/task.
   * Uses br dep list --direction up to get issues that depend on the parent
   * with a parent-child relationship (i.e., children of the epic).
   */
  private async getChildIds(parentId: string): Promise<Set<string>> {
    const { stdout, exitCode } = await execBr(
      ['dep', 'list', parentId, '--direction', 'up', '--json'],
      this.workingDir
    );

    if (exitCode !== 0) {
      return new Set();
    }

    try {
      const deps = JSON.parse(stdout) as BrDepListItem[];
      const childIds = new Set<string>();

      for (const dep of deps) {
        if (dep.type === 'parent-child') {
          childIds.add(dep.issue_id);
        }
      }

      return childIds;
    } catch {
      return new Set();
    }
  }

  override async getNextTask(filter?: TaskFilter): Promise<TrackerTask | undefined> {
    const args = ['ready', '--json'];

    // We only need one task, but fetch a small batch so we can prefer
    // in_progress tasks over open tasks.
    const requestedLimit =
      typeof filter?.limit === 'number' && filter.limit > 0 ? filter.limit : 10;
    args.push('--limit', String(Math.max(10, requestedLimit)));

    // Note: br ready doesn't support --parent, so we filter in-memory below
    const parentId = filter?.parentId ?? this.epicId;

    // Exclude epics from ready results when filtering by parent
    if (parentId) {
      args.push('--type', 'task');
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

    // Filter by parent (br ready doesn't support --parent)
    // Always apply filter when parentId is set - empty childIds means no matching tasks
    if (parentId) {
      const childIds = await this.getChildIds(parentId);
      tasks = tasks.filter((t) => childIds.has(t.id));
    }

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

  /**
   * Get PRD context for template rendering.
   * Reads epic external_ref (prd:./path/to/file.md) and returns the PRD markdown content.
   */
  async getPrdContext(): Promise<{
    name: string;
    description?: string;
    content: string;
    completedCount: number;
    totalCount: number;
  } | null> {
    const epicId = this.epicId;
    if (!epicId) {
      return null;
    }

    try {
      const epicResult = await execBr(['show', epicId, '--json'], this.workingDir);
      if (epicResult.exitCode !== 0) {
        return null;
      }

      const epics = JSON.parse(epicResult.stdout) as BrTaskJson[];
      if (epics.length === 0) {
        return null;
      }

      const epic = epics[0]!;
      const externalRef = epic.external_ref;

      if (!externalRef || !externalRef.startsWith('prd:')) {
        return null;
      }

      const prdPath = externalRef.substring(4);
      if (!prdPath) {
        return null;
      }

      // Always resolve against workingDir to prevent path traversal attacks
      const resolvedPath = resolve(this.workingDir, prdPath);

      // Security check: ensure the path is inside workingDir
      const relativePath = relative(this.workingDir, resolvedPath);
      if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
        return null;
      }

      const fullPath = resolvedPath;

      let content: string;
      try {
        content = await readFile(fullPath, 'utf-8');
      } catch {
        return null;
      }

      // Get children count from epic's dependents (br list doesn't support --parent)
      let completedCount = 0;
      let totalCount = 0;

      if (epic.dependents) {
        const children = epic.dependents.filter(
          (d) => d.type === 'parent-child'
        );
        totalCount = children.length;
        completedCount = children.filter(
          (c) => c.status === 'closed' || c.status === 'cancelled'
        ).length;
      }

      return {
        name: epic.title,
        description: epic.description,
        content,
        completedCount,
        totalCount,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get the prompt template for the beads-rust tracker.
   * Reads from the co-located template.hbs file.
   */
  override getTemplate(): string {
    if (templateCache !== null) {
      return templateCache;
    }

    const templatePath = join(__dirname, 'template.hbs');
    try {
      templateCache = readFileSync(templatePath, 'utf-8');
      return templateCache;
    } catch (err) {
      console.error(`Failed to read template from ${templatePath}:`, err);
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
 * Factory function for the Beads-rust tracker plugin.
 */
const createBeadsRustTracker: TrackerPluginFactory = () => new BeadsRustTrackerPlugin();

export default createBeadsRustTracker;
