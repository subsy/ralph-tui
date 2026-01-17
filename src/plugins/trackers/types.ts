/**
 * ABOUTME: Type definitions for the tracker plugin system.
 * Defines the interfaces and types that all tracker plugins must implement
 * to integrate with Ralph TUI's task orchestration.
 */

/**
 * Priority level for tasks (0 = highest, 4 = lowest/backlog)
 */
export type TaskPriority = 0 | 1 | 2 | 3 | 4;

/**
 * Status of a task in the tracker
 */
export type TrackerTaskStatus =
  | 'open'
  | 'in_progress'
  | 'blocked'
  | 'completed'
  | 'cancelled';

/**
 * Unified task representation across all tracker plugins.
 * All tracker plugins must convert their native task format to this type.
 */
export interface TrackerTask {
  /** Unique identifier from the tracker */
  id: string;

  /** Human-readable task title */
  title: string;

  /** Current status of the task */
  status: TrackerTaskStatus;

  /** Priority level (0-4, where 0 is critical) */
  priority: TaskPriority;

  /** Detailed description or body text */
  description?: string;

  /** Labels or tags associated with the task */
  labels?: string[];

  /** Task type (e.g., 'feature', 'bug', 'task', 'epic') */
  type?: string;

  /** Parent task/epic ID for hierarchical trackers */
  parentId?: string;

  /** IDs of tasks this task depends on (blockers) */
  dependsOn?: string[];

  /** IDs of tasks that depend on this task */
  blocks?: string[];

  /** Assigned user or owner */
  assignee?: string;

  /** Creation timestamp (ISO 8601) */
  createdAt?: string;

  /** Last update timestamp (ISO 8601) */
  updatedAt?: string;

  /** Current iteration/sprint number */
  iteration?: number;

  /** Tracker-specific metadata (varies by plugin) */
  metadata?: Record<string, unknown>;
}

/**
 * Result of completing a task
 */
export interface TaskCompletionResult {
  /** Whether the completion was successful */
  success: boolean;

  /** Human-readable message about the completion */
  message: string;

  /** The updated task after completion (if available) */
  task?: TrackerTask;

  /** Error details if completion failed */
  error?: string;
}

/**
 * Result of syncing with the tracker
 */
export interface SyncResult {
  /** Whether the sync was successful */
  success: boolean;

  /** Human-readable message about the sync */
  message: string;

  /** Number of tasks added during sync */
  added?: number;

  /** Number of tasks updated during sync */
  updated?: number;

  /** Number of tasks removed during sync */
  removed?: number;

  /** Error details if sync failed */
  error?: string;

  /** Timestamp of the sync (ISO 8601) */
  syncedAt: string;
}

/**
 * A setup question for configuring a tracker plugin
 */
export interface SetupQuestion {
  /** Unique identifier for this question */
  id: string;

  /** The question prompt to display */
  prompt: string;

  /** Type of input expected */
  type: 'text' | 'password' | 'boolean' | 'select' | 'multiselect' | 'path';

  /** Available choices for select/multiselect types */
  choices?: Array<{
    value: string;
    label: string;
    description?: string;
  }>;

  /** Default value if user doesn't provide one */
  default?: string | boolean | string[];

  /** Whether this question is required */
  required?: boolean;

  /** Validation pattern (regex) for text inputs */
  pattern?: string;

  /** Help text to display alongside the question */
  help?: string;
}

/**
 * Filter criteria for querying tasks
 */
export interface TaskFilter {
  /** Filter by status */
  status?: TrackerTaskStatus | TrackerTaskStatus[];

  /** Filter by labels (tasks must have all specified labels) */
  labels?: string[];

  /** Filter by priority */
  priority?: TaskPriority | TaskPriority[];

  /** Filter by parent ID */
  parentId?: string;

  /** Filter by assignee */
  assignee?: string;

  /** Filter by type */
  type?: string | string[];

  /** Only include tasks that are ready (no unresolved dependencies) */
  ready?: boolean;

  /** Maximum number of tasks to return */
  limit?: number;

  /** Offset for pagination */
  offset?: number;

  /** Exclude tasks with these IDs (used by engine to skip failed tasks) */
  excludeIds?: string[];
}

/**
 * Configuration for a tracker plugin instance.
 * Stored in YAML config files.
 */
export interface TrackerPluginConfig {
  /** Unique name for this tracker instance */
  name: string;

  /** Plugin type identifier (e.g., 'beads', 'json', 'beads-bv') */
  plugin: string;

  /** Whether this is the default tracker */
  default?: boolean;

  /** Plugin-specific configuration options */
  options: Record<string, unknown>;
}

/**
 * Metadata about a tracker plugin
 */
export interface TrackerPluginMeta {
  /** Unique identifier for the plugin */
  id: string;

  /** Human-readable name */
  name: string;

  /** Short description of the plugin */
  description: string;

  /** Plugin version */
  version: string;

  /** Plugin author */
  author?: string;

  /** Whether the plugin supports bidirectional sync */
  supportsBidirectionalSync: boolean;

  /** Whether the plugin supports hierarchical tasks (epics/subtasks) */
  supportsHierarchy: boolean;

  /** Whether the plugin supports task dependencies */
  supportsDependencies: boolean;
}

/**
 * The main tracker plugin interface that all plugins must implement.
 * Provides methods for reading, updating, and syncing tasks.
 */
export interface TrackerPlugin {
  /** Metadata about this plugin */
  readonly meta: TrackerPluginMeta;

  /**
   * Initialize the plugin with configuration.
   * Called once when the plugin is loaded.
   * @param config Plugin-specific configuration options
   */
  initialize(config: Record<string, unknown>): Promise<void>;

  /**
   * Check if the plugin is properly configured and ready to use.
   * @returns true if the plugin is ready, false otherwise
   */
  isReady(): Promise<boolean>;

  /**
   * Get all tasks matching the optional filter criteria.
   * @param filter Optional filter to narrow results
   * @returns Array of tasks matching the filter
   */
  getTasks(filter?: TaskFilter): Promise<TrackerTask[]>;

  /**
   * Get a single task by its ID.
   * @param id The task ID to look up
   * @returns The task if found, undefined otherwise
   */
  getTask(id: string): Promise<TrackerTask | undefined>;

  /**
   * Get the next task to work on based on priority and dependencies.
   * Returns the highest-priority task that has no unresolved blockers.
   * @param filter Optional filter to narrow candidates
   * @returns The next task to work on, or undefined if none available
   */
  getNextTask(filter?: TaskFilter): Promise<TrackerTask | undefined>;

  /**
   * Mark a task as completed.
   * @param id The task ID to complete
   * @param reason Optional reason or notes about the completion
   * @returns Result of the completion operation
   */
  completeTask(id: string, reason?: string): Promise<TaskCompletionResult>;

  /**
   * Update a task's status.
   * @param id The task ID to update
   * @param status The new status
   * @returns The updated task
   */
  updateTaskStatus(
    id: string,
    status: TrackerTaskStatus
  ): Promise<TrackerTask | undefined>;

  /**
   * Check if all tasks are complete (no more work to do).
   * @param filter Optional filter to scope the check
   * @returns true if all matching tasks are complete
   */
  isComplete(filter?: TaskFilter): Promise<boolean>;

  /**
   * Sync with the underlying tracker (fetch updates, push changes).
   * For trackers that don't support sync, this is a no-op that returns success.
   * @returns Result of the sync operation
   */
  sync(): Promise<SyncResult>;

  /**
   * Check if a specific task is ready to work on (no unresolved dependencies).
   * @param id The task ID to check
   * @returns true if the task is ready, false if blocked or not found
   */
  isTaskReady(id: string): Promise<boolean>;

  /**
   * Get all available epics (top-level task containers).
   * An epic is typically a task with type='epic' and no parent.
   * Used for epic selection UI when no specific epic is configured.
   * @returns Array of epic tasks
   */
  getEpics(): Promise<TrackerTask[]>;

  /**
   * Set the current epic ID for filtering tasks.
   * Used when user switches epics mid-session via the 'l' key.
   * Implementation varies by tracker type:
   * - beads/beads-bv: Sets epic ID filter for bd list commands
   * - json: May change the active prd.json file
   * @param epicId The epic ID to set, or empty string to clear
   */
  setEpicId?(epicId: string): void;

  /**
   * Get the currently configured epic ID.
   * @returns The current epic ID, or empty string if none set
   */
  getEpicId?(): string;

  /**
   * Get setup questions for configuring this plugin.
   * Used by the setup wizard to collect configuration.
   * @returns Array of questions to ask during setup
   */
  getSetupQuestions(): SetupQuestion[];

  /**
   * Validate configuration answers before saving.
   * @param answers User's answers to setup questions
   * @returns null if valid, or an error message string if invalid
   */
  validateSetup(answers: Record<string, unknown>): Promise<string | null>;

  /**
   * Clean up resources when the plugin is unloaded.
   * Called when Ralph TUI shuts down.
   */
  dispose(): Promise<void>;
}

/**
 * Factory function type for creating tracker plugin instances.
 * Plugins export this function as their default export.
 */
export type TrackerPluginFactory = () => TrackerPlugin;
