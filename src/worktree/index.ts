/**
 * ABOUTME: Public exports for the worktree pool management module.
 * Provides resource-aware git worktree management for parallel agent execution,
 * including a coordinator for agent-to-agent message passing.
 */

export * from './types.js';
export * from './resources.js';
export * from './coordinator-types.js';
export * from './lock-types.js';
export * from './task-graph-types.js';
export * from './merge-engine-types.js';
export * from './conflict-resolver-types.js';
export * from './broadcast-types.js';
export * from './parallel-executor-types.js';
export { WorktreePoolManager } from './manager.js';
export { Coordinator } from './coordinator.js';
export { ResourceLockManager } from './lock-manager.js';
export { TaskGraphAnalyzer } from './task-graph-analyzer.js';
export { MergeEngine } from './merge-engine.js';
export { ConflictResolver } from './conflict-resolver.js';
export { BroadcastManager } from './broadcast-manager.js';
export { ParallelExecutor } from './parallel-executor.js';
export {
  ParallelAgentRunner,
  DEFAULT_PARALLEL_AGENT_CONFIG,
  type ParallelAgentConfig,
  type ParallelAgentResult,
  type ParallelAgentRunOptions,
} from './parallel-agent-runner.js';
