/**
 * ABOUTME: Tracker plugins module for task/issue tracker integrations.
 * Exports plugin interfaces, the plugin registry, and built-in plugins.
 * Trackers are used by Ralph to get tasks, update status, and sync changes.
 */

// Type definitions
export type {
  TaskPriority,
  TrackerTaskStatus,
  TrackerTask,
  ExecutionScope,
  ScopedTrackerTask,
  TaskCompletionResult,
  SyncResult,
  SetupQuestion,
  TaskFilter,
  TrackerPluginConfig,
  TrackerPluginMeta,
  TrackerPlugin,
  TrackerPluginFactory,
} from './types.js';

// Base class for creating plugins
export { BaseTrackerPlugin } from './base.js';

// Tracker wrappers
export { MultiScopeTrackerPlugin, createExecutionScopeFromTask } from './multi-scope.js';

// Plugin registry
export { TrackerRegistry, getTrackerRegistry } from './registry.js';

// Built-in plugins and registration
export {
  builtinTrackers,
  registerBuiltinTrackers,
  createJsonTracker,
  createBeadsTracker,
  createBeadsBvTracker,
} from './builtin/index.js';
