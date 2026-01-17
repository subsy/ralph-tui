/**
 * ABOUTME: Iteration log persistence functions.
 * Handles saving, loading, listing, and cleaning up iteration logs.
 */

import { join } from 'node:path';
import {
  writeFile,
  readFile,
  mkdir,
  readdir,
  unlink,
  stat,
} from 'node:fs/promises';
import type {
  AgentSwitchEntry,
  IterationLog,
  IterationLogMetadata,
  IterationLogSummary,
  LogFilterOptions,
  LogCleanupOptions,
  LogCleanupResult,
  SubagentTrace,
  SubagentHierarchyNode,
  SubagentTraceStats,
} from './types.js';
import { ITERATIONS_DIR } from './types.js';
import type {
  SubagentEvent,
  SubagentState,
} from '../plugins/agents/tracing/types.js';
import type { IterationResult } from '../engine/types.js';
import type {
  RalphConfig,
  SandboxConfig,
  SandboxMode,
} from '../config/types.js';

/**
 * Divider between metadata header and raw output in log files.
 */
const LOG_DIVIDER = '\n--- RAW OUTPUT ---\n';

/**
 * Divider between stdout and stderr in raw output section.
 */
const STDERR_DIVIDER = '\n--- STDERR ---\n';

/**
 * Divider before subagent trace JSON section.
 */
const SUBAGENT_TRACE_DIVIDER = '\n--- SUBAGENT TRACE ---\n';

/**
 * Generate log filename for an iteration.
 * Format: iteration-{N}-{taskId}.log
 */
export function generateLogFilename(iteration: number, taskId: string): string {
  // Sanitize task ID for filesystem safety (replace / with -)
  const safeTaskId = taskId.replace(/[/\\:*?"<>|]/g, '-');
  const paddedIteration = String(iteration).padStart(3, '0');
  return `iteration-${paddedIteration}-${safeTaskId}.log`;
}

/**
 * Get the full path to the iterations directory.
 * @param cwd Working directory
 * @param customDir Optional custom directory (relative to cwd or absolute)
 */
export function getIterationsDir(cwd: string, customDir?: string): string {
  const dir = customDir ?? ITERATIONS_DIR;
  // If customDir is absolute, use it directly; otherwise join with cwd
  if (
    customDir &&
    (customDir.startsWith('/') || customDir.match(/^[A-Za-z]:/))
  ) {
    return customDir;
  }
  return join(cwd, dir);
}

/**
 * Ensure the iterations directory exists.
 * @param cwd Working directory
 * @param customDir Optional custom directory
 */
export async function ensureIterationsDir(
  cwd: string,
  customDir?: string,
): Promise<void> {
  const dir = getIterationsDir(cwd, customDir);
  await mkdir(dir, { recursive: true });
}

/**
 * Options for building iteration metadata.
 */
export interface BuildMetadataOptions {
  /** Ralph config (for agent plugin, model, epicId) */
  config?: Partial<RalphConfig>;

  /** Agent switches that occurred during this iteration */
  agentSwitches?: AgentSwitchEntry[];

  /** Summary of how iteration completed */
  completionSummary?: string;

  /** Sandbox configuration used for this iteration */
  sandboxConfig?: SandboxConfig;

  /** Resolved sandbox mode when configured mode was 'auto' */
  resolvedSandboxMode?: Exclude<SandboxMode, 'auto'>;
}

/**
 * Build metadata from an iteration result and config.
 */
export function buildMetadata(
  result: IterationResult,
  configOrOptions?: Partial<RalphConfig> | BuildMetadataOptions,
): IterationLogMetadata {
  // Handle both old signature (config only) and new signature (options object)
  let config: Partial<RalphConfig> | undefined;
  let agentSwitches: AgentSwitchEntry[] | undefined;
  let completionSummary: string | undefined;
  let sandboxConfig: SandboxConfig | undefined;
  let resolvedSandboxMode: Exclude<SandboxMode, 'auto'> | undefined;

  // Detect new options object format by checking for any of its unique keys
  // (config, agentSwitches, completionSummary, sandboxConfig, resolvedSandboxMode)
  const isOptionsObject =
    configOrOptions &&
    ('config' in configOrOptions ||
      'agentSwitches' in configOrOptions ||
      'completionSummary' in configOrOptions ||
      'sandboxConfig' in configOrOptions ||
      'resolvedSandboxMode' in configOrOptions);

  if (isOptionsObject) {
    // New options object
    const opts = configOrOptions as BuildMetadataOptions;
    config = opts.config;
    agentSwitches = opts.agentSwitches;
    completionSummary = opts.completionSummary;
    sandboxConfig = opts.sandboxConfig;
    resolvedSandboxMode = opts.resolvedSandboxMode;
  } else {
    // Old config-only signature for backward compatibility
    config = configOrOptions as Partial<RalphConfig> | undefined;
  }

  return {
    iteration: result.iteration,
    taskId: result.task.id,
    taskTitle: result.task.title,
    taskDescription: result.task.description,
    status: result.status,
    taskCompleted: result.taskCompleted,
    promiseComplete: result.promiseComplete,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    durationMs: result.durationMs,
    error: result.error,
    agentPlugin: config?.agent?.plugin,
    model: config?.model,
    epicId: config?.epicId,
    agentSwitches:
      agentSwitches && agentSwitches.length > 0 ? agentSwitches : undefined,
    completionSummary,
    sandboxMode: sandboxConfig?.mode,
    resolvedSandboxMode,
    sandboxNetwork: sandboxConfig?.network,
  };
}

/**
 * Format metadata as a human-readable header.
 */
function formatMetadataHeader(metadata: IterationLogMetadata): string {
  const lines: string[] = [];

  lines.push(`# Iteration ${metadata.iteration} Log`);
  lines.push('');
  lines.push('## Metadata');
  lines.push('');
  lines.push(`- **Task ID**: ${metadata.taskId}`);
  lines.push(`- **Task Title**: ${metadata.taskTitle}`);
  if (metadata.taskDescription) {
    lines.push(
      `- **Description**: ${metadata.taskDescription.slice(0, 200)}${metadata.taskDescription.length > 200 ? '...' : ''}`,
    );
  }
  lines.push(`- **Status**: ${metadata.status}`);
  lines.push(`- **Task Completed**: ${metadata.taskCompleted ? 'Yes' : 'No'}`);
  lines.push(
    `- **Promise Detected**: ${metadata.promiseComplete ? 'Yes' : 'No'}`,
  );
  lines.push(`- **Started At**: ${metadata.startedAt}`);
  lines.push(`- **Ended At**: ${metadata.endedAt}`);
  lines.push(`- **Duration**: ${formatDuration(metadata.durationMs)}`);

  if (metadata.error) {
    lines.push(`- **Error**: ${metadata.error}`);
  }

  if (metadata.agentPlugin) {
    lines.push(`- **Agent**: ${metadata.agentPlugin}`);
  }
  if (metadata.model) {
    lines.push(`- **Model**: ${metadata.model}`);
  }
  if (metadata.epicId) {
    lines.push(`- **Epic**: ${metadata.epicId}`);
  }

  // Add sandbox configuration if present
  if (metadata.sandboxMode) {
    const modeDisplay =
      metadata.sandboxMode === 'auto' && metadata.resolvedSandboxMode
        ? `auto (${metadata.resolvedSandboxMode})`
        : metadata.sandboxMode;
    lines.push(`- **Sandbox Mode**: ${modeDisplay}`);
    if (metadata.sandboxNetwork !== undefined) {
      lines.push(
        `- **Sandbox Network**: ${metadata.sandboxNetwork ? 'Enabled' : 'Disabled'}`,
      );
    }
  }

  // Add completion summary if present
  if (metadata.completionSummary) {
    lines.push(`- **Completion Summary**: ${metadata.completionSummary}`);
  }

  // Add agent switches section if any occurred
  if (metadata.agentSwitches && metadata.agentSwitches.length > 0) {
    lines.push('');
    lines.push('## Agent Switches');
    lines.push('');
    for (const sw of metadata.agentSwitches) {
      const switchType =
        sw.reason === 'fallback'
          ? 'Switched to fallback'
          : 'Recovered to primary';
      lines.push(`- **${switchType}**: ${sw.from} → ${sw.to} at ${sw.at}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format duration in human-readable form.
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

/**
 * Parse metadata from a log file header.
 */
function parseMetadataHeader(header: string): IterationLogMetadata | null {
  try {
    const lines = header.split('\n');

    // Extract iteration number from title
    const titleMatch = lines[0]?.match(/# Iteration (\d+) Log/);
    const iteration = titleMatch ? parseInt(titleMatch[1], 10) : 0;

    // Helper to extract value from "- **Key**: Value" format
    const extractValue = (key: string): string | undefined => {
      const line = lines.find((l) => l.includes(`**${key}**:`));
      if (!line) return undefined;
      const match = line.match(/\*\*.*?\*\*:\s*(.+)/);
      return match ? match[1].trim() : undefined;
    };

    const taskId = extractValue('Task ID') ?? '';
    const taskTitle = extractValue('Task Title') ?? '';
    const taskDescription = extractValue('Description');
    const status = (extractValue('Status') ??
      'completed') as IterationLogMetadata['status'];
    const taskCompleted = extractValue('Task Completed') === 'Yes';
    const promiseComplete = extractValue('Promise Detected') === 'Yes';
    const startedAt = extractValue('Started At') ?? new Date().toISOString();
    const endedAt = extractValue('Ended At') ?? new Date().toISOString();

    // Parse duration back to ms
    const durationStr = extractValue('Duration');
    let durationMs = 0;
    if (durationStr) {
      const hoursMatch = durationStr.match(/(\d+)h/);
      const minsMatch = durationStr.match(/(\d+)m/);
      const secsMatch = durationStr.match(/(\d+)s/);
      if (hoursMatch) durationMs += parseInt(hoursMatch[1], 10) * 3600000;
      if (minsMatch) durationMs += parseInt(minsMatch[1], 10) * 60000;
      if (secsMatch) durationMs += parseInt(secsMatch[1], 10) * 1000;
    }

    const error = extractValue('Error');
    const agentPlugin = extractValue('Agent');
    const model = extractValue('Model');
    const epicId = extractValue('Epic');

    // Parse sandbox configuration
    const sandboxModeRaw = extractValue('Sandbox Mode');
    let sandboxMode: string | undefined;
    let resolvedSandboxMode: string | undefined;
    if (sandboxModeRaw) {
      // Handle "auto (docker)" or "auto (sandbox-exec)" format
      const autoMatch = sandboxModeRaw.match(/^auto\s*\(([^)]+)\)$/);
      if (autoMatch) {
        sandboxMode = 'auto';
        resolvedSandboxMode = autoMatch[1];
      } else {
        sandboxMode = sandboxModeRaw;
      }
    }
    const sandboxNetworkRaw = extractValue('Sandbox Network');
    const sandboxNetwork = sandboxNetworkRaw
      ? sandboxNetworkRaw === 'Enabled'
      : undefined;

    return {
      iteration,
      taskId,
      taskTitle,
      taskDescription,
      status,
      taskCompleted,
      promiseComplete,
      startedAt,
      endedAt,
      durationMs,
      error,
      agentPlugin,
      model,
      epicId,
      sandboxMode,
      resolvedSandboxMode,
      sandboxNetwork,
    };
  } catch {
    return null;
  }
}

/**
 * Options for saving iteration logs.
 */
export interface SaveIterationLogOptions {
  /** Ralph config (for output directory, agent plugin, model, epicId) */
  config?: Partial<RalphConfig>;

  /** Subagent trace data to persist (optional) */
  subagentTrace?: SubagentTrace;

  /** Agent switches that occurred during this iteration */
  agentSwitches?: AgentSwitchEntry[];

  /** Summary of how iteration completed (e.g., 'Completed on fallback (opencode) due to rate limit') */
  completionSummary?: string;

  /** Sandbox configuration used for this iteration */
  sandboxConfig?: SandboxConfig;

  /** Resolved sandbox mode when configured mode was 'auto' */
  resolvedSandboxMode?: Exclude<SandboxMode, 'auto'>;
}

/**
 * Save an iteration log to disk.
 * @param cwd Working directory
 * @param result Iteration execution result
 * @param stdout Agent stdout output
 * @param stderr Agent stderr output
 * @param options Save options including config and subagent trace
 */
export async function saveIterationLog(
  cwd: string,
  result: IterationResult,
  stdout: string,
  stderr: string,
  options?: SaveIterationLogOptions | Partial<RalphConfig>,
): Promise<string> {
  // Handle both old signature (config only) and new signature (options object)
  // Old signature: saveIterationLog(cwd, result, stdout, stderr, config)
  // New signature: saveIterationLog(cwd, result, stdout, stderr, options)
  let config: Partial<RalphConfig> | undefined;
  let subagentTrace: SubagentTrace | undefined;
  let agentSwitches: AgentSwitchEntry[] | undefined;
  let completionSummary: string | undefined;
  let sandboxConfig: SandboxConfig | undefined;
  let resolvedSandboxMode: Exclude<SandboxMode, 'auto'> | undefined;

  // Detect new options object format by checking for any of its unique keys
  const isOptionsObject =
    options &&
    ('config' in options ||
      'subagentTrace' in options ||
      'agentSwitches' in options ||
      'completionSummary' in options ||
      'sandboxConfig' in options ||
      'resolvedSandboxMode' in options);

  if (isOptionsObject) {
    // New options object
    const saveOptions = options as SaveIterationLogOptions;
    config = saveOptions.config;
    subagentTrace = saveOptions.subagentTrace;
    agentSwitches = saveOptions.agentSwitches;
    completionSummary = saveOptions.completionSummary;
    sandboxConfig = saveOptions.sandboxConfig;
    resolvedSandboxMode = saveOptions.resolvedSandboxMode;
  } else {
    // Old config-only signature for backward compatibility
    config = options as Partial<RalphConfig> | undefined;
  }

  const outputDir = config?.outputDir;
  await ensureIterationsDir(cwd, outputDir);

  const metadata = buildMetadata(result, {
    config,
    agentSwitches,
    completionSummary,
    sandboxConfig,
    resolvedSandboxMode,
  });
  const filename = generateLogFilename(result.iteration, result.task.id);
  const filePath = join(getIterationsDir(cwd, outputDir), filename);

  // Build file content with structured header and raw output
  const header = formatMetadataHeader(metadata);
  let content = header + LOG_DIVIDER;
  content += stdout;

  if (stderr && stderr.trim().length > 0) {
    content += STDERR_DIVIDER;
    content += stderr;
  }

  // Append subagent trace if provided
  if (subagentTrace && subagentTrace.events.length > 0) {
    content += SUBAGENT_TRACE_DIVIDER;
    content += JSON.stringify(subagentTrace, null, 2);
  }

  await writeFile(filePath, content);
  return filePath;
}

/**
 * Load an iteration log from disk.
 * Handles logs with and without subagent trace data for backward compatibility.
 */
export async function loadIterationLog(
  filePath: string,
): Promise<IterationLog | null> {
  try {
    const content = await readFile(filePath, 'utf-8');

    // Split header and output
    const parts = content.split(LOG_DIVIDER);
    const header = parts[0] ?? '';
    let output = parts[1] ?? '';

    // Parse metadata from header
    const metadata = parseMetadataHeader(header);
    if (!metadata) {
      return null;
    }

    // Check for and extract subagent trace section
    let subagentTrace: SubagentTrace | undefined;
    const traceIndex = output.indexOf(SUBAGENT_TRACE_DIVIDER);
    if (traceIndex !== -1) {
      const traceJson = output.slice(
        traceIndex + SUBAGENT_TRACE_DIVIDER.length,
      );
      output = output.slice(0, traceIndex);

      try {
        subagentTrace = JSON.parse(traceJson) as SubagentTrace;
      } catch {
        // If trace parsing fails, continue without it (backward compatibility)
        subagentTrace = undefined;
      }
    }

    // Split stdout and stderr from the remaining output
    const outputParts = output.split(STDERR_DIVIDER);
    const stdout = outputParts[0] ?? '';
    const stderr = outputParts[1] ?? '';

    return {
      metadata,
      stdout,
      stderr,
      filePath,
      subagentTrace,
    };
  } catch {
    return null;
  }
}

/**
 * List all iteration logs in the iterations directory.
 * @param cwd Working directory
 * @param options Filter options
 * @param customDir Optional custom iterations directory
 */
export async function listIterationLogs(
  cwd: string,
  options: LogFilterOptions = {},
  customDir?: string,
): Promise<IterationLogSummary[]> {
  const dir = getIterationsDir(cwd, customDir);

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    // Directory doesn't exist yet
    return [];
  }

  // Filter to .log files that match our pattern
  const logFiles = files
    .filter((f) => f.startsWith('iteration-') && f.endsWith('.log'))
    .sort(); // Sort by filename (which includes iteration number)

  const summaries: IterationLogSummary[] = [];

  for (const file of logFiles) {
    const filePath = join(dir, file);
    const log = await loadIterationLog(filePath);

    if (!log) continue;

    // Apply filters
    if (
      options.iteration !== undefined &&
      log.metadata.iteration !== options.iteration
    ) {
      continue;
    }

    if (options.taskId !== undefined) {
      const normalizedFilter = options.taskId.toLowerCase();
      const normalizedId = log.metadata.taskId.toLowerCase();
      if (!normalizedId.includes(normalizedFilter)) {
        continue;
      }
    }

    if (options.status !== undefined && options.status.length > 0) {
      if (!options.status.includes(log.metadata.status)) {
        continue;
      }
    }

    summaries.push({
      iteration: log.metadata.iteration,
      taskId: log.metadata.taskId,
      taskTitle: log.metadata.taskTitle,
      status: log.metadata.status,
      taskCompleted: log.metadata.taskCompleted,
      durationMs: log.metadata.durationMs,
      startedAt: log.metadata.startedAt,
      filePath,
    });
  }

  // Apply pagination
  let result = summaries;
  if (options.offset !== undefined && options.offset > 0) {
    result = result.slice(options.offset);
  }
  if (options.limit !== undefined && options.limit > 0) {
    result = result.slice(0, options.limit);
  }

  return result;
}

/**
 * Get a specific iteration log by iteration number.
 */
export async function getIterationLogByNumber(
  cwd: string,
  iteration: number,
): Promise<IterationLog | null> {
  const summaries = await listIterationLogs(cwd, { iteration });

  if (summaries.length === 0) {
    return null;
  }

  return loadIterationLog(summaries[0].filePath);
}

/**
 * Get iteration logs for a specific task.
 * @param cwd Working directory
 * @param taskId Task ID to filter by
 * @param customDir Optional custom iterations directory
 */
export async function getIterationLogsByTask(
  cwd: string,
  taskId: string,
  customDir?: string,
): Promise<IterationLog[]> {
  const summaries = await listIterationLogs(cwd, { taskId }, customDir);
  const logs: IterationLog[] = [];

  for (const summary of summaries) {
    const log = await loadIterationLog(summary.filePath);
    if (log) {
      logs.push(log);
    }
  }

  return logs;
}

/**
 * Clean up old iteration logs, keeping only the most recent N.
 */
export async function cleanupIterationLogs(
  cwd: string,
  options: LogCleanupOptions,
): Promise<LogCleanupResult> {
  const allSummaries = await listIterationLogs(cwd);

  // Sort by iteration number descending (most recent first)
  const sorted = [...allSummaries].sort((a, b) => b.iteration - a.iteration);

  const toKeep = sorted.slice(0, options.keep);
  const toDelete = sorted.slice(options.keep);

  const result: LogCleanupResult = {
    deletedCount: toDelete.length,
    deletedFiles: toDelete.map((s) => s.filePath),
    keptCount: toKeep.length,
    dryRun: options.dryRun ?? false,
  };

  if (!options.dryRun) {
    for (const summary of toDelete) {
      try {
        await unlink(summary.filePath);
      } catch {
        // Ignore errors deleting individual files
      }
    }
  }

  return result;
}

/**
 * Get total count of iteration logs.
 */
export async function getIterationLogCount(cwd: string): Promise<number> {
  const summaries = await listIterationLogs(cwd);
  return summaries.length;
}

/**
 * Check if any iteration logs exist.
 */
export async function hasIterationLogs(cwd: string): Promise<boolean> {
  const dir = getIterationsDir(cwd);
  try {
    const files = await readdir(dir);
    return files.some((f) => f.startsWith('iteration-') && f.endsWith('.log'));
  } catch {
    return false;
  }
}

/**
 * Get disk usage of iteration logs in bytes.
 */
export async function getIterationLogsDiskUsage(cwd: string): Promise<number> {
  const summaries = await listIterationLogs(cwd);
  let totalBytes = 0;

  for (const summary of summaries) {
    try {
      const stats = await stat(summary.filePath);
      totalBytes += stats.size;
    } catch {
      // Ignore errors getting file stats
    }
  }

  return totalBytes;
}

/**
 * Build a SubagentTrace from arrays of events and states.
 * This is a helper function for the engine to construct trace data for persistence.
 *
 * @param events Array of subagent lifecycle events in chronological order
 * @param states Array of all subagent states
 * @returns Complete SubagentTrace ready for persistence
 */
export function buildSubagentTrace(
  events: SubagentEvent[],
  states: SubagentState[],
): SubagentTrace {
  // Build hierarchy tree from states
  const hierarchy = buildHierarchyTree(states);

  // Compute aggregate statistics
  const stats = computeTraceStats(states);

  return {
    events,
    hierarchy,
    stats,
  };
}

/**
 * Build hierarchy tree from flat list of subagent states.
 */
function buildHierarchyTree(states: SubagentState[]): SubagentHierarchyNode[] {
  const nodeMap = new Map<string, SubagentHierarchyNode>();
  const roots: SubagentHierarchyNode[] = [];

  // First pass: create nodes for all states
  for (const state of states) {
    nodeMap.set(state.id, {
      state,
      children: [],
    });
  }

  // Second pass: build tree structure
  for (const state of states) {
    const node = nodeMap.get(state.id)!;

    if (state.parentId && nodeMap.has(state.parentId)) {
      // Add as child of parent
      const parentNode = nodeMap.get(state.parentId)!;
      parentNode.children.push(node);
    } else {
      // This is a root node
      roots.push(node);
    }
  }

  return roots;
}

/**
 * Compute aggregate statistics from subagent states.
 */
function computeTraceStats(states: SubagentState[]): SubagentTraceStats {
  const byType: Record<string, number> = {};
  let totalDurationMs = 0;
  let failureCount = 0;
  let maxDepth = 0;

  // Create a map for quick lookup
  const stateMap = new Map<string, SubagentState>();
  for (const state of states) {
    stateMap.set(state.id, state);
  }

  for (const state of states) {
    // Count by agent type
    byType[state.agentType] = (byType[state.agentType] || 0) + 1;

    // Sum durations of completed subagents
    if (state.durationMs !== undefined) {
      totalDurationMs += state.durationMs;
    }

    // Count failures
    if (state.status === 'error') {
      failureCount++;
    }

    // Calculate depth for this subagent
    let depth = 1;
    let current = state;
    while (current.parentId) {
      depth++;
      const parent = stateMap.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    maxDepth = Math.max(maxDepth, depth);
  }

  return {
    totalSubagents: states.length,
    byType,
    totalDurationMs,
    failureCount,
    maxDepth,
  };
}

// Test exports - internal functions exposed for unit testing
// These are not part of the public API and may change without notice
export const __test__ = {
  formatMetadataHeader,
  parseMetadataHeader,
  formatDuration,
};
