# Step 3: Model Escalation Strategy

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this task.

## Quick Reference
- **Branch:** `feat/engine-improvements-03-model-escalation`
- **Complexity:** M
- **Dependencies:** None
- **Estimated files:** 5

## Objective
Implement a model escalation strategy: start with a cheaper model (e.g., sonnet) and automatically escalate to a more capable model (e.g., opus) when a task fails verification or exceeds retry count. This reduces cost for straightforward tasks while preserving quality for hard ones.

## Context from Research
- Model is set via `config.model` and passed to agent as `--model` flag
- Agent plugins receive model in `AgentExecuteOptions`
- Rate limit handling already supports agent switching — model escalation follows similar pattern
- `ActiveAgentState` tracks which agent is active and why — extend for model escalation
- Engine state has `currentModel` field already
- Token usage tracked by `TokenUsageAccumulator`

## Prerequisites
- [ ] ralph-tui builds and tests pass on current main

## Implementation

**Read these files first** (in parallel):
- `src/engine/index.ts` — how model is passed to agent execution (search for `currentModel`)
- `src/config/types.ts` — config structure
- `src/plugins/agents/types.ts` — how model reaches the agent plugin

### 1. Add config types

In `src/config/types.ts`:

```typescript
/**
 * Model escalation configuration.
 * Start with a cheaper model and escalate on failure.
 */
export interface ModelEscalationConfig {
  /** Whether model escalation is enabled (default: false) */
  enabled?: boolean;

  /** Starting model — used for first attempt (e.g., "sonnet") */
  startModel?: string;

  /** Escalated model — used after failure (e.g., "opus") */
  escalateModel?: string;

  /** Number of failed attempts before escalating (default: 1) */
  escalateAfter?: number;
}

export const DEFAULT_MODEL_ESCALATION: Required<ModelEscalationConfig> = {
  enabled: false,
  startModel: 'sonnet',
  escalateModel: 'opus',
  escalateAfter: 1,
};
```

Add `modelEscalation?: ModelEscalationConfig` to `StoredConfig` and `RalphConfig`.

### 2. Create escalation logic

Create `src/engine/model-escalation.ts`:

```typescript
/**
 * ABOUTME: Model escalation strategy for cost-effective task execution.
 * Starts with a cheaper model and escalates to a more capable one on failure.
 */

import type { ModelEscalationConfig } from '../config/types.js';

export interface ModelEscalationState {
  taskAttempts: Map<string, number>;
}

export function createEscalationState(): ModelEscalationState {
  return { taskAttempts: new Map() };
}

export function getModelForTask(
  taskId: string,
  config: Required<ModelEscalationConfig>,
  state: ModelEscalationState,
): string {
  const attempts = state.taskAttempts.get(taskId) ?? 0;
  return attempts >= config.escalateAfter ? config.escalateModel : config.startModel;
}

export function recordTaskAttempt(
  taskId: string,
  state: ModelEscalationState,
): void {
  const current = state.taskAttempts.get(taskId) ?? 0;
  state.taskAttempts.set(taskId, current + 1);
}
```

### 3. Integrate into engine

In `src/engine/index.ts`:
- Add `ModelEscalationState` to engine instance
- Before agent execution, determine model via `getModelForTask()` if escalation enabled
- On task retry (verification failure or error), call `recordTaskAttempt()`
- Emit `model:escalated` event when model changes
- Clear task attempts on task completion

### 4. Add CLI flags

- `--start-model <name>` — override starting model
- `--escalate-model <name>` — override escalation model

## Files to Create/Modify

### `src/engine/model-escalation.ts` (NEW)
Model escalation state and logic.

### `src/config/types.ts` (MODIFY)
Add `ModelEscalationConfig`, defaults, add to stored/runtime configs.

### `src/engine/index.ts` (MODIFY)
Integrate escalation into iteration execution.

### `src/engine/types.ts` (MODIFY)
Add `ModelEscalatedEvent` to event union.

### CLI command file (MODIFY)
Add `--start-model` and `--escalate-model` flags.

## Verification

### Automated Checks (ALL must pass)
```bash
bun run typecheck
bun run build
bun test
```

### Test Cases to Write
```typescript
// tests/engine/model-escalation.test.ts
// - First attempt uses startModel
// - After escalateAfter failures, uses escalateModel
// - Task completion clears attempt counter
// - Disabled config returns undefined (use default model)
```

### Manual Verification
- [ ] Configure escalation with `startModel: sonnet, escalateModel: opus`
- [ ] Run a task that fails — verify model escalates on retry
- [ ] Verify TUI shows which model is being used

## Success Criteria
- [ ] Starts with cheaper model by default when enabled
- [ ] Escalates after configured number of failures
- [ ] Model shown in TUI/logs
- [ ] Existing model override (`--model`) still works and takes precedence

## Scope Boundaries
**Do:** Model selection logic, config, engine integration
**Don't:** Per-task model configuration in PRD, multi-step escalation chains, cost calculation (that's Step 7)
