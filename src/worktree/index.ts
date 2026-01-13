/**
 * ABOUTME: Public exports for the worktree pool management module.
 * Provides resource-aware git worktree management for parallel agent execution,
 * including a coordinator for agent-to-agent message passing.
 */

export * from './types.js';
export * from './resources.js';
export * from './coordinator-types.js';
export { WorktreePoolManager } from './manager.js';
export { Coordinator } from './coordinator.js';
