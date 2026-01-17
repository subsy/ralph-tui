/**
 * ABOUTME: Type definitions for the prompt template system.
 * Defines template variables, context, and configuration types.
 */

import type { TrackerTask } from '../plugins/trackers/types.js';
import type { RalphConfig } from '../config/types.js';

/**
 * Variables available for template substitution.
 * These are the documented template variables exposed to users.
 */
export interface TemplateVariables {
  /** Task ID from the tracker */
  taskId: string;

  /** Task title */
  taskTitle: string;

  /** Task description (may include acceptance criteria) */
  taskDescription: string;

  /** Acceptance criteria extracted from description (if available) */
  acceptanceCriteria: string;

  /** Parent epic ID (if task is part of an epic) */
  epicId: string;

  /** Parent epic title (if available) */
  epicTitle: string;

  /** Name of the tracker plugin (e.g., 'beads', 'json', 'beads-bv') */
  trackerName: string;

  /** Task labels as comma-separated string */
  labels: string;

  /** Task priority (0-4, where 0 is critical) */
  priority: string;

  /** Task status (open, in_progress, etc.) */
  status: string;

  /** Task dependencies as comma-separated string */
  dependsOn: string;

  /** Tasks blocked by this task as comma-separated string */
  blocks: string;

  /** Task type (feature, bug, task, etc.) */
  type: string;

  /** Model being used for the agent */
  model: string;

  /** Agent plugin name */
  agentName: string;

  /** Current working directory */
  cwd: string;

  /** Current date in ISO format */
  currentDate: string;

  /** Current timestamp in ISO format */
  currentTimestamp: string;

  /** Task notes (additional context, progress notes, etc.) */
  notes: string;

  /** Recent progress summary from previous iterations (optional) */
  recentProgress: string;

  /** Full path to beads database file (for bd --db flag) */
  beadsDbPath: string;

  // --- NEW: PRD Context Variables ---

  /** PRD/Epic name */
  prdName: string;

  /** PRD/Epic description */
  prdDescription: string;

  /** Full PRD markdown content (the source document - study this for context) */
  prdContent: string;

  /** Number of completed stories in the PRD */
  prdCompletedCount: string;

  /** Total number of stories in the PRD */
  prdTotalCount: string;

  // --- NEW: Learning/Patterns Variables ---

  /** Codebase patterns extracted from progress.md (study these first) */
  codebasePatterns: string;

  // --- NEW: Selection Context Variables ---

  /** Why this task was selected (for beads-bv, includes PageRank info) */
  selectionReason: string;
}

/**
 * Context passed to template rendering.
 * Includes both raw objects and flattened variables.
 */
export interface TemplateContext {
  /** The flattened template variables */
  vars: TemplateVariables;

  /** The raw task object for advanced template use */
  task: TrackerTask;

  /** The raw configuration for advanced template use */
  config: Partial<RalphConfig>;

  /** Epic information if available */
  epic?: {
    id: string;
    title: string;
    description?: string;
  };
}

/**
 * Result of loading a template.
 */
export interface TemplateLoadResult {
  /** Whether the template was loaded successfully */
  success: boolean;

  /** The template content (if successful) */
  content?: string;

  /** The source of the template (path or 'builtin:<type>') */
  source: string;

  /** Error message if loading failed */
  error?: string;
}

/**
 * Result of rendering a template.
 */
export interface TemplateRenderResult {
  /** Whether the template rendered successfully */
  success: boolean;

  /** The rendered prompt (if successful) */
  prompt?: string;

  /** Error message if rendering failed */
  error?: string;

  /** The source of the template used */
  source: string;
}

/**
 * Supported built-in template types.
 * Each tracker type has a corresponding default template.
 */
export type BuiltinTemplateType = 'default' | 'beads' | 'json' | 'beads-bv';

/**
 * Template configuration in ralph config.
 */
export interface TemplateConfig {
  /** Path to custom template file (relative to cwd or absolute) */
  path?: string;

  /** Use a specific built-in template instead of auto-detecting */
  builtin?: BuiltinTemplateType;
}
