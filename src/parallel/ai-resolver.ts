/**
 * ABOUTME: AI-powered conflict resolution using the session's configured agent.
 * Provides fast-path heuristics for trivial cases and LLM-based resolution for complex ones.
 * Works on any node (local or remote) as long as the agent CLI is available.
 */

import { getAgentRegistry } from '../plugins/agents/registry.js';
import type { RalphConfig } from '../config/types.js';
import type { FileConflict } from './types.js';
import type { AiResolverCallback } from './conflict-resolver.js';

/** Default timeout for AI resolution per file (2 minutes) */
const DEFAULT_TIMEOUT_MS = 120000;

/**
 * Creates an AI resolver callback that spawns the session's configured agent.
 * The callback is injected into ConflictResolver via ParallelExecutor.setAiResolver().
 *
 * @param config - The session's RalphConfig containing agent configuration
 * @returns AiResolverCallback for use with ConflictResolver
 */
export function createAiResolver(config: RalphConfig): AiResolverCallback {
  const timeout = config.conflictResolution?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (conflict, taskContext) => {
    // Fast-path: Check for trivial cases before spawning agent
    const fastResult = tryFastPathResolution(conflict);
    if (fastResult !== null) {
      return fastResult;
    }

    // Spawn agent for complex resolution
    try {
      const agentRegistry = getAgentRegistry();
      const agent = await agentRegistry.getInstance(config.agent);

      const prompt = buildConflictPrompt(conflict, taskContext);

      const handle = agent.execute(prompt, [], {
        cwd: config.cwd,
        timeout,
      });

      const result = await handle.promise;

      if (result.status !== 'completed' || result.exitCode !== 0) {
        return null;
      }

      return extractResolvedContent(result.stdout);
    } catch {
      // Agent execution failed - return null to signal failure
      return null;
    }
  };
}

/**
 * Fast-path resolution for trivial conflict cases.
 * Avoids spawning an agent for cases that can be resolved deterministically.
 *
 * @param conflict - The file conflict to analyze
 * @returns Resolved content if trivial case detected, null if AI is needed
 */
export function tryFastPathResolution(conflict: FileConflict): string | null {
  const oursEmpty = conflict.oursContent.trim() === '';
  const theirsEmpty = conflict.theirsContent.trim() === '';

  // One side is empty → take the non-empty side
  if (oursEmpty && !theirsEmpty) {
    return conflict.theirsContent;
  }
  if (!oursEmpty && theirsEmpty) {
    return conflict.oursContent;
  }

  // Both sides identical → either works
  if (conflict.oursContent === conflict.theirsContent) {
    return conflict.oursContent;
  }

  // Need AI for complex cases
  return null;
}

/**
 * Build the prompt for AI conflict resolution.
 * Includes task context so AI understands the purpose of the worker's changes.
 *
 * @param conflict - The file conflict with all three versions
 * @param ctx - Task context (what the worker was implementing)
 * @returns Formatted prompt string
 */
export function buildConflictPrompt(
  conflict: FileConflict,
  ctx: { taskId: string; taskTitle: string }
): string {
  return `You are resolving a git merge conflict. Output ONLY the resolved file content.

## Context
File: ${conflict.filePath}
Task: ${ctx.taskTitle} (${ctx.taskId})

## Base Version (common ancestor)
\`\`\`
${conflict.baseContent || '(file did not exist)'}
\`\`\`

## Main Branch (ours)
\`\`\`
${conflict.oursContent}
\`\`\`

## Worker Branch (theirs - implementing the task)
\`\`\`
${conflict.theirsContent}
\`\`\`

## Instructions
1. Merge intelligently - keep changes from both branches where they don't conflict
2. The worker was implementing "${ctx.taskTitle}" - preserve their functional changes
3. Keep main branch updates (formatting, unrelated fixes) where possible
4. If in doubt, prefer the worker's changes since they implement the requested task

OUTPUT ONLY THE RESOLVED FILE CONTENT. No explanation, no markdown code fences.`;
}

/**
 * Extract the resolved file content from agent output.
 * Strips markdown fences if the agent included them despite instructions.
 *
 * @param stdout - Raw stdout from the agent execution
 * @returns Extracted content or null if empty
 */
export function extractResolvedContent(stdout: string): string | null {
  let content = stdout.trim();

  // Strip markdown code fences if present (agent might add them despite instructions)
  const fenceMatch = content.match(/^```[\w]*\n([\s\S]*)\n```$/);
  if (fenceMatch) {
    content = fenceMatch[1] ?? content;
  }

  // Validate we got something
  if (content.length === 0) {
    return null;
  }

  return content;
}
