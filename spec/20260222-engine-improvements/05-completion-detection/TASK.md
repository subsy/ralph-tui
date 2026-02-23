# Step 5: Completion Detection Hardening

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this task.

## Quick Reference
- **Branch:** `feat/engine-improvements-05-completion-detection`
- **Complexity:** M
- **Dependencies:** None
- **Estimated files:** 4

## Objective
Replace the single-regex completion detection with a strategy pattern supporting multiple detection methods. Current `<promise>COMPLETE</promise>` regex becomes one strategy. Add a file-change heuristic and a post-execution probe as alternatives. Make strategies configurable.

## Context from Research
- Current detection: single regex `/<promise>\s*COMPLETE\s*<\/promise>/i` at `src/engine/index.ts:67`
- Used at line 1303: `const promiseComplete = PROMISE_COMPLETE_PATTERN.test(agentResult.stdout)`
- Issue #259 established that exit code 0 alone is NOT sufficient
- Agent output comes as `agentResult.stdout` string
- No fallback if agent wraps tag in markdown code fences or alters format

## Prerequisites
- [ ] ralph-tui builds and tests pass on current main

## Implementation

**Read these files first** (in parallel):
- `src/engine/index.ts` — completion detection at line 1302-1310
- `tests/engine/completion-detection.test.ts` — existing tests for the pattern

### 1. Create completion strategy module

Create `src/engine/completion-strategies.ts`:

```typescript
/**
 * ABOUTME: Pluggable completion detection strategies.
 * Provides multiple methods for detecting when an agent has finished a task.
 */

import type { AgentExecutionResult } from '../plugins/agents/types.js';

export interface CompletionStrategy {
  name: string;
  detect(agentResult: AgentExecutionResult): boolean;
}

/**
 * Original strategy: explicit <promise>COMPLETE</promise> tag.
 */
export const promiseTagStrategy: CompletionStrategy = {
  name: 'promise-tag',
  detect(result) {
    return /<promise>\s*COMPLETE\s*<\/promise>/i.test(result.stdout);
  },
};

/**
 * Relaxed tag strategy: catches common agent mutations like
 * wrapping in code fences, adding quotes, or slight formatting changes.
 */
export const relaxedTagStrategy: CompletionStrategy = {
  name: 'relaxed-tag',
  detect(result) {
    // Match even inside markdown code blocks
    const stripped = result.stdout.replace(/```[\s\S]*?```/g, (match) => match);
    return /<promise>\s*COMPLETE\s*<\/promise>/i.test(result.stdout) ||
      /\bpromise\s*:\s*complete\b/i.test(result.stdout);
  },
};

/**
 * Detect completion based on the agent's final lines containing
 * clear completion language and exit code 0.
 * Only used as a fallback — never as primary.
 */
export const heuristicStrategy: CompletionStrategy = {
  name: 'heuristic',
  detect(result) {
    if (result.exitCode !== 0) return false;
    // Check last 500 chars for strong completion signals
    const tail = result.stdout.slice(-500).toLowerCase();
    const completionPhrases = [
      'all acceptance criteria met',
      'all tasks complete',
      'implementation complete',
      'all checks pass',
    ];
    return completionPhrases.some(phrase => tail.includes(phrase));
  },
};

export type CompletionStrategyName = 'promise-tag' | 'relaxed-tag' | 'heuristic';

const strategyMap: Record<CompletionStrategyName, CompletionStrategy> = {
  'promise-tag': promiseTagStrategy,
  'relaxed-tag': relaxedTagStrategy,
  'heuristic': heuristicStrategy,
};

/**
 * Run strategies in order, return true on first match.
 */
export function detectCompletion(
  agentResult: AgentExecutionResult,
  strategies: CompletionStrategyName[] = ['promise-tag'],
): { completed: boolean; matchedStrategy: string | null } {
  for (const name of strategies) {
    const strategy = strategyMap[name];
    if (strategy && strategy.detect(agentResult)) {
      return { completed: true, matchedStrategy: name };
    }
  }
  return { completed: false, matchedStrategy: null };
}
```

### 2. Add config

In `src/config/types.ts`:

```typescript
/**
 * Completion detection strategy configuration.
 */
export interface CompletionConfig {
  /** Ordered list of strategies to try (default: ['promise-tag']) */
  strategies?: CompletionStrategyName[];
}
```

Add to `StoredConfig` and `RalphConfig`.

### 3. Integrate into engine

Replace the single-line detection at `src/engine/index.ts:1303` with:

```typescript
const completionResult = detectCompletion(
  agentResult,
  this.config.completion?.strategies ?? ['promise-tag'],
);
const promiseComplete = completionResult.completed;
```

### 4. Update tests

Update `tests/engine/completion-detection.test.ts` to test all strategies and the `detectCompletion()` orchestrator.

## Files to Create/Modify

### `src/engine/completion-strategies.ts` (NEW)
Strategy pattern for completion detection.

### `src/config/types.ts` (MODIFY)
Add `CompletionConfig` and strategy name type.

### `src/engine/index.ts` (MODIFY)
Replace single regex with `detectCompletion()` call.

### `tests/engine/completion-detection.test.ts` (MODIFY)
Add tests for new strategies.

## Verification

### Automated Checks (ALL must pass)
```bash
bun run typecheck
bun run build
bun test
```

### Test Cases to Write
```typescript
// - promise-tag: exact match, case insensitive, whitespace tolerant
// - relaxed-tag: matches inside code fences
// - heuristic: requires exit 0 + completion phrase
// - heuristic: rejects exit 0 without phrase
// - Strategy ordering: first match wins
// - Default config: only promise-tag active
```

### Manual Verification
- [ ] Run with default config — verify only promise-tag strategy active
- [ ] Configure `strategies: ['promise-tag', 'relaxed-tag']` — verify relaxed catches fenced tags
- [ ] Verify no false positives with heuristic strategy

## Success Criteria
- [ ] Current behavior unchanged with default config
- [ ] Multiple strategies configurable
- [ ] Matched strategy logged in iteration result
- [ ] All existing completion detection tests still pass

## Scope Boundaries
**Do:** Strategy pattern, 3 built-in strategies, config, integration
**Don't:** Post-execution probe (requires sending another prompt — too complex for this step), custom user strategies
