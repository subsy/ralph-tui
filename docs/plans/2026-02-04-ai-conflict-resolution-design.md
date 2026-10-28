# AI Conflict Resolution Design

## Problem Statement

The conflict resolution UI exists but the actual AI resolution is **never wired up**:
- `ConflictResolver.setAiResolver()` is never called after creating `ParallelExecutor`
- The `aiResolver` callback is always `null`, so resolution always fails
- Users see "AI resolving..." but nothing happens

## Goals

1. Wire up actual AI-powered conflict resolution using the session's configured agent
2. Work on any node (local or remote) as long as the agent CLI is available
3. Add fast-path heuristics to skip AI for trivial cases
4. Provide confidence scoring and user choice when AI is uncertain
5. Make behavior configurable (auto-resolve threshold, timeout, etc.)

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                      run.tsx                                    │
│  parallelExecutor.setAiResolver(createAiResolver(config))       │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│              createAiResolver(config) → AiResolverCallback      │
│                                                                 │
│  1. Fast-path checks (one side empty, identical content)        │
│  2. Spawn agent with conflict resolution prompt                 │
│  3. Parse response and extract confidence                       │
│  4. Return resolved content or null on failure                  │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                     ConflictResolver                            │
│  resolveFile() → writes content → git add → success/failure     │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### 1. Add Configuration Types

Extend `src/config/types.ts`:

```typescript
export interface ConflictResolutionConfig {
  /** Whether to attempt AI resolution for merge conflicts (default: true) */
  enabled?: boolean;
  // TODO: Future work - confidenceThreshold not yet implemented
  // /** Confidence threshold (0.0-1.0) above which AI resolution is auto-accepted (default: 0.7) */
  // confidenceThreshold?: number;
  /** Timeout in milliseconds for AI resolution per file (default: 120000) */
  timeoutMs?: number;
  /** Maximum files to attempt AI resolution on per conflict (default: 10) */
  maxFiles?: number;
}
```

### 2. Create AI Resolver Module

New file: `src/parallel/ai-resolver.ts`

```typescript
/**
 * ABOUTME: AI-powered conflict resolution using the session's configured agent.
 * Provides fast-path heuristics for trivial cases and LLM-based resolution for complex ones.
 */

import { getAgentRegistry } from '../plugins/agents/registry.js';
import type { RalphConfig } from '../config/types.js';
import type { FileConflict } from './types.js';
import type { AiResolverCallback } from './conflict-resolver.js';

export interface AiResolutionResult {
  content: string;
  confidence: number;
  strategy: 'ours' | 'theirs' | 'merged' | 'ai';
  reasoning?: string;
}

/**
 * Creates an AI resolver callback that spawns the session's configured agent.
 */
export function createAiResolver(config: RalphConfig): AiResolverCallback {
  const timeout = config.conflictResolution?.timeoutMs ?? 120000;

  return async (conflict, taskContext) => {
    // Fast-path: Check for trivial cases before spawning agent
    const fastResult = tryFastPathResolution(conflict);
    if (fastResult !== null) {
      return fastResult;
    }

    // Spawn agent for complex resolution
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
  };
}

/**
 * Fast-path resolution for trivial conflict cases.
 * Returns resolved content or null if AI is needed.
 */
function tryFastPathResolution(conflict: FileConflict): string | null {
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
 */
function buildConflictPrompt(
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
 */
function extractResolvedContent(stdout: string): string | null {
  let content = stdout.trim();

  // Strip markdown code fences if present
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
```

### 3. Wire Up in run.tsx

In `src/commands/run.tsx`, after creating `ParallelExecutor`:

```typescript
import { createAiResolver } from '../parallel/ai-resolver.js';

// After: const parallelExecutor = new ParallelExecutor(config, tracker, {...});

// Wire up AI conflict resolution
if (storedConfig?.parallel?.conflictResolution?.enabled !== false) {
  parallelExecutor.setAiResolver(createAiResolver(config));
}
```

### 4. Update Events for Better UI Feedback

Enhance `conflict:ai-resolving` event to include strategy information:

```typescript
// In conflict-resolver.ts
// TODO: Future work - strategy field not yet implemented
this.emit({
  type: 'conflict:ai-resolving',
  timestamp: new Date().toISOString(),
  operationId,
  taskId,
  filePath: conflict.filePath,
  // strategy: 'fast-path' | 'ai',  // Future: indicates resolution approach
});
```

### 5. Add Config Schema Validation

Update `src/config/schema.ts` to validate conflict resolution config.

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/parallel/ai-resolver.ts` | Create | AI resolver callback factory |
| `src/config/types.ts` | Modify | Add `ConflictResolutionConfig` interface |
| `src/config/schema.ts` | Modify | Add schema validation |
| `src/commands/run.tsx` | Modify | Wire up `setAiResolver()` call |
| `src/parallel/conflict-resolver.ts` | Modify | Minor: add strategy to events |
| `src/parallel/ai-resolver.test.ts` | Create | Unit tests |

## Testing Strategy

1. **Unit tests** for `tryFastPathResolution()` with various conflict scenarios
2. **Unit tests** for `buildConflictPrompt()` output format
3. **Unit tests** for `extractResolvedContent()` with/without markdown fences
4. **Integration test** with mock agent to verify full flow
5. **Manual test** with real conflicts in parallel execution

## Rollout

1. Feature is **enabled by default** (matches existing `aiConflictResolution: true`)
2. Can be disabled via config: `parallel.conflictResolution.enabled: false`
3. No breaking changes to existing behavior

## Open Questions

1. Should we add a `--dry-run` flag to show what AI would resolve without applying?
2. Should low-confidence resolutions prompt user instead of failing?
3. Should we cache agent instance across multiple conflict resolutions?

---

*Design created: 2026-02-04*
