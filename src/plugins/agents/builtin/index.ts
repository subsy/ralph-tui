/**
 * ABOUTME: Built-in agent plugin registration.
 * Registers all bundled agent plugins with the AgentRegistry.
 */

import { getAgentRegistry } from '../registry.js';
import createDroidAgent from '../droid/index.js';
import createClaudeAgent from './claude.js';
import createOpenCodeAgent from './opencode.js';
import createAmpcodeAgent from './ampcode.js';

/**
 * Register all built-in agent plugins with the registry.
 * Should be called once during application initialization.
 */
export function registerBuiltinAgents(): void {
  const registry = getAgentRegistry();

  // Register built-in plugins
  registry.registerBuiltin(createClaudeAgent);
  registry.registerBuiltin(createOpenCodeAgent);
  registry.registerBuiltin(createAmpcodeAgent);
  registry.registerBuiltin(createDroidAgent);
}

// Export the factory functions for direct use
export { createClaudeAgent, createOpenCodeAgent, createAmpcodeAgent, createDroidAgent };

// Export Claude JSONL parsing types and utilities
export type { ClaudeJsonlMessage, JsonlParseResult } from './claude.js';
export { ClaudeAgentPlugin } from './claude.js';

// Export Ampcode JSONL parsing types and utilities
export type { AmpcodeJsonlMessage } from './ampcode.js';
export { AmpcodeAgentPlugin } from './ampcode.js';
