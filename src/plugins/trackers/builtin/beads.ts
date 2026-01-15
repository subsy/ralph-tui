/**
 * ABOUTME: Beads tracker plugin for bd (beads) issue tracking.
 * Integrates with the local beads issue tracker using the bd CLI.
 * Implements full CRUD operations via bd commands with --json output.
 */

import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { BaseTrackerPlugin } from '../base.js';
import type {
  TrackerPluginMeta,
  TrackerPluginFactory,
  TrackerTask,
  TrackerTaskStatus,
  TaskPriority,
  TaskFilter,
  TaskCompletionResult,
  SyncResult,
  SetupQuestion,
} from '../types.js';

/**
 * Raw bead structure from bd list --json output.
 */
interface BeadJson {
  id: string;
  title: string;
  description?: string;
  status: 'open' | 'in_progress' | 'closed' | 'cancelled';
  priority: number;
  issue_type?: string;
  owner?: string;
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
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
interface DetectResult {
  available: boolean;
  beadsDir?: string;
  bdPath?: string;
  bdVersion?: string;
  error?: string;
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
 * Convert bd status to TrackerTaskStatus.
 */
function mapStatus(bdStatus: string): TrackerTaskStatus {
  switch (bdStatus) {
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
      // Beads doesn't have a blocked status; keep as open
      return 'open';
    default:
      return 'open';
  }
}

/**
 * Convert bd priority (0-4) to TaskPriority.
 */
function mapPriority(bdPriority: number): TaskPriority {
  const clamped = Math.max(0, Math.min(4, bdPriority));
  return clamped as TaskPriority;
}

/**
 * Convert a BeadJson object to TrackerTask.
 */
function beadToTask(bead: BeadJson): TrackerTask {
  // Extract blocking dependencies (tasks this depends on that aren't done)
  const dependsOn: string[] = [];
  const blocks: string[] = [];

  if (bead.dependencies) {
    for (const dep of bead.dependencies) {
      if (dep.dependency_type === 'blocks') {
        dependsOn.push(dep.id);
      }
    }
  }

  if (bead.dependents) {
    for (const dep of bead.dependents) {
      if (dep.dependency_type === 'blocks') {
        blocks.push(dep.id);
      }
    }
  }

  // Infer parentId from bead ID if not provided (bd list --json bug)
  // e.g., "ralph-tui-45r.37" -> parent is "ralph-tui-45r"
  let parentId = bead.parent;
  if (!parentId && bead.id.includes('.')) {
    const lastDotIndex = bead.id.lastIndexOf('.');
    parentId = bead.id.substring(0, lastDotIndex);
  }

  return {
    id: bead.id,
    title: bead.title,
    status: mapStatus(bead.status),
    priority: mapPriority(bead.priority),
    description: bead.description,
    labels: bead.labels,
    type: bead.issue_type,
    parentId,
    dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
    blocks: blocks.length > 0 ? blocks : undefined,
    assignee: bead.owner,
    createdAt: bead.created_at,
    updatedAt: bead.updated_at,
    metadata: {
      closedAt: bead.closed_at,
      dependencyCount: bead.dependency_count,
      dependentCount: bead.dependent_count,
    },
  };
}

/**
 * Beads tracker plugin implementation.
 * Uses the bd CLI to interact with beads issues.
 */
export class BeadsTrackerPlugin extends BaseTrackerPlugin {
  readonly meta: TrackerPluginMeta = {
    id: 'beads',
    name: 'Beads Issue Tracker',
    description: 'Track issues using the bd (beads) CLI',
    version: '1.0.0',
    supportsBidirectionalSync: true,
    supportsHierarchy: true,
    supportsDependencies: true,
  };

  private beadsDir: string = '.beads';
  private epicId: string = '';
  protected labels: string[] = [];
  private workingDir: string = process.cwd();

  override async initialize(config: Record<string, unknown>): Promise<void> {
    await super.initialize(config);

    if (typeof config.beadsDir === 'string') {
      this.beadsDir = config.beadsDir;
    }

    if (typeof config.epicId === 'string') {
      this.epicId = config.epicId;
    }

    // Handle labels as either string or array
    if (typeof config.labels === 'string') {
      // Single string or comma-separated string
      this.labels = config.labels.split(',').map((l) => l.trim()).filter(Boolean);
    } else if (Array.isArray(config.labels)) {
      this.labels = config.labels.filter(
        (l): l is string => typeof l === 'string'
      );
    }

    if (typeof config.workingDir === 'string') {
      this.workingDir = config.workingDir;
    }

    // Validate readiness
    const detection = await this.detect();
    this.ready = detection.available;
  }

  /**
   * Detect if beads is available in the current environment.
   * Checks for .beads/ directory and bd binary.
   */
  async detect(): Promise<DetectResult> {
    // Check for .beads directory
    const beadsDirPath = join(this.workingDir, this.beadsDir);
    try {
      await access(beadsDirPath, constants.R_OK);
    } catch {
      return {
        available: false,
        error: `Beads directory not found: ${beadsDirPath}`,
      };
    }

    // Check for bd binary
    const { stdout, stderr, exitCode } = await execBd(
      ['--version'],
      this.workingDir
    );

    if (exitCode !== 0) {
      return {
        available: false,
        error: `bd binary not available: ${stderr}`,
      };
    }

    // Parse version from output (format: "bd version X.Y.Z (hash)")
    const versionMatch = stdout.match(/bd version (\S+)/);
    const version = versionMatch ? versionMatch[1] : 'unknown';

    return {
      available: true,
      beadsDir: beadsDirPath,
      bdPath: 'bd',
      bdVersion: version,
    };
  }

  override async isReady(): Promise<boolean> {
    if (!this.ready) {
      const detection = await this.detect();
      this.ready = detection.available;
    }
    return this.ready;
  }

  getSetupQuestions(): SetupQuestion[] {
    // Note: epicId is NOT asked here - it should be specified via CLI flag (--epic)
    // when starting the TUI, not saved in config
    return [
      {
        id: 'beadsDir',
        prompt: 'Path to .beads directory:',
        type: 'path',
        default: '.beads',
        required: false,
        help: 'Directory containing beads issues (default: .beads in project root)',
      },
      {
        id: 'labels',
        prompt: 'Labels to filter issues by (comma-separated):',
        type: 'text',
        default: 'ralph',
        required: false,
        help: 'Only show issues with these labels (e.g., "ralph,frontend")',
      },
    ];
  }

  override async validateSetup(
    _answers: Record<string, unknown>
  ): Promise<string | null> {
    // Note: epicId is validated at runtime when specified via CLI, not during setup

    // Check if beads is available
    const detection = await this.detect();
    if (!detection.available) {
      return detection.error ?? 'Beads tracker not available';
    }

    return null;
  }

  async getTasks(filter?: TaskFilter): Promise<TrackerTask[]> {
    // Build bd list command args
    // Use --all to include closed issues (TUI filters visibility via showClosedTasks state)
    const args = ['list', '--json', '--all'];

    // Filter by parent (epic) - beads in an epic are children of the epic issue
    if (filter?.parentId) {
      args.push('--parent', filter.parentId);
    } else if (this.epicId) {
      args.push('--parent', this.epicId);
    }

    // Filter by status
    if (filter?.status) {
      const statuses = Array.isArray(filter.status)
        ? filter.status
        : [filter.status];
      // Map our statuses to bd statuses
      const bdStatuses = statuses.map(mapStatusToBd);
      // bd only supports single --status, so use the first one
      // For multiple statuses, we'll filter in memory
      if (bdStatuses.length === 1) {
        args.push('--status', bdStatuses[0]!);
      }
    }

    // Filter by labels (separate from epic hierarchy)
    const labelsToFilter =
      filter?.labels && filter.labels.length > 0 ? filter.labels : this.labels;
    if (labelsToFilter.length > 0) {
      args.push('--label', labelsToFilter.join(','));
    }

    const { stdout, exitCode, stderr } = await execBd(args, this.workingDir);

    if (exitCode !== 0) {
      console.error('bd list failed:', stderr);
      return [];
    }

    // Parse JSON output
    let beads: BeadJson[];
    try {
      beads = JSON.parse(stdout) as BeadJson[];
    } catch (err) {
      console.error('Failed to parse bd list output:', err);
      return [];
    }

    // Convert to TrackerTask
    let tasks = beads.map(beadToTask);

    // Apply additional filtering that bd doesn't support directly
    // Note: Remove parentId from filter since bd already handled it via --parent flag
    // (bd list --json doesn't include parent field in output, so filterTasks would incorrectly remove tasks)
    const filterWithoutParent = filter ? { ...filter, parentId: undefined } : undefined;
    tasks = this.filterTasks(tasks, filterWithoutParent);

    return tasks;
  }

  override async getTask(id: string): Promise<TrackerTask | undefined> {
    const { stdout, exitCode, stderr } = await execBd(
      ['show', id, '--json'],
      this.workingDir
    );

    if (exitCode !== 0) {
      console.error(`bd show ${id} failed:`, stderr);
      return undefined;
    }

    // bd show --json returns an array with one element
    let beads: BeadJson[];
    try {
      beads = JSON.parse(stdout) as BeadJson[];
    } catch (err) {
      console.error('Failed to parse bd show output:', err);
      return undefined;
    }

    if (beads.length === 0) {
      return undefined;
    }

    return beadToTask(beads[0]!);
  }

  async completeTask(
    id: string,
    reason?: string
  ): Promise<TaskCompletionResult> {
    const args = ['update', id, '--status', 'closed'];

    if (reason) {
      args.push('--reason', reason);
    }

    const { exitCode, stderr, stdout } = await execBd(args, this.workingDir);

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
    const bdStatus = mapStatusToBd(status);
    const args = ['update', id, '--status', bdStatus];

    const { exitCode, stderr } = await execBd(args, this.workingDir);

    if (exitCode !== 0) {
      console.error(`bd update ${id} --status ${bdStatus} failed:`, stderr);
      return undefined;
    }

    // Fetch and return the updated task
    return this.getTask(id);
  }

  override async sync(): Promise<SyncResult> {
    // Run bd sync to synchronize with git
    const { exitCode, stderr, stdout } = await execBd(
      ['sync'],
      this.workingDir
    );

    if (exitCode !== 0) {
      return {
        success: false,
        message: 'Beads sync failed',
        error: stderr || stdout,
        syncedAt: new Date().toISOString(),
      };
    }

    return {
      success: true,
      message: 'Beads synced with git',
      syncedAt: new Date().toISOString(),
    };
  }

  override async isComplete(filter?: TaskFilter): Promise<boolean> {
    // Get all tasks for the epic (or filtered set)
    const tasks = await this.getTasks({
      ...filter,
      parentId: filter?.parentId ?? this.epicId,
    });

    // Check if all tasks are completed or cancelled
    return tasks.every(
      (t) => t.status === 'completed' || t.status === 'cancelled'
    );
  }

  /**
   * Get all available epics from the beads tracker.
   * Queries for beads with type='epic' and open/in_progress status.
   */
  override async getEpics(): Promise<TrackerTask[]> {
    // Query for epics using bd list with type filter
    const args = ['list', '--json', '--type', 'epic'];

    // Filter by labels if configured
    if (this.labels.length > 0) {
      args.push('--label', this.labels.join(','));
    }

    const { stdout, exitCode, stderr } = await execBd(args, this.workingDir);

    if (exitCode !== 0) {
      console.error('bd list --type epic failed:', stderr);
      return [];
    }

    // Parse JSON output
    let beads: BeadJson[];
    try {
      beads = JSON.parse(stdout) as BeadJson[];
    } catch (err) {
      console.error('Failed to parse bd list output:', err);
      return [];
    }

    // Convert to TrackerTask and filter to top-level epics (no parent)
    // Also include open/in_progress epics only (not closed)
    const tasks = beads.map(beadToTask);
    return tasks.filter(
      (t) =>
        !t.parentId &&
        (t.status === 'open' || t.status === 'in_progress')
    );
  }

  /**
   * Set the epic ID for filtering tasks.
   * Used when user selects an epic from the TUI.
   */
  setEpicId(epicId: string): void {
    this.epicId = epicId;
  }

  /**
   * Get the currently configured epic ID.
   */
  getEpicId(): string {
    return this.epicId;
  }
}

/**
 * Factory function for the Beads tracker plugin.
 */
const createBeadsTracker: TrackerPluginFactory = () => new BeadsTrackerPlugin();

export default createBeadsTracker;
