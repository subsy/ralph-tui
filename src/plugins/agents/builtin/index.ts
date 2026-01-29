/**
 * ABOUTME: Built-in agent plugin registration.
 * Registers all bundled agent plugins with the AgentRegistry.
 */

import { getAgentRegistry } from '../registry.js';
import createDroidAgent from '../droid/index.js';
import createClaudeAgent from './claude.js';
import createOpenCodeAgent from './opencode.js';
import createGeminiAgent from './gemini.js';
import createCodexAgent from './codex.js';
import createKiroAgent from './kiro.js';
import createCursorAgent from './cursor.js';

/**
 * Register all built-in agent plugins with the registry.
 * Should be called once during application initialization.
 */
export function registerBuiltinAgents(): void {
  const registry = getAgentRegistry();

  // Register built-in plugins
  registry.registerBuiltin(createClaudeAgent);
  registry.registerBuiltin(createOpenCodeAgent);
  registry.registerBuiltin(createDroidAgent);
  registry.registerBuiltin(createGeminiAgent);
  registry.registerBuiltin(createCodexAgent);
  registry.registerBuiltin(createKiroAgent);
  registry.registerBuiltin(createCursorAgent);
}

// Export the factory functions for direct use
export {
  createClaudeAgent,
  createOpenCodeAgent,
  createDroidAgent,
  createGeminiAgent,
  createCodexAgent,
  createKiroAgent,
  createCursorAgent,
};

// Export Claude JSONL parsing types and utilities
export type { ClaudeJsonlMessage, JsonlParseResult } from './claude.js';
export { ClaudeAgentPlugin } from './claude.js';

// Export new agent plugin classes
export { GeminiAgentPlugin } from './gemini.js';
export { CodexAgentPlugin } from './codex.js';
export { KiroAgentPlugin } from './kiro.js';
export { CursorAgentPlugin } from './cursor.js';
