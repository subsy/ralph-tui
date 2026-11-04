# Step 7: Cost Tracking

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this task.

## Quick Reference
- **Branch:** `feat/engine-improvements-07-cost-tracking`
- **Complexity:** M
- **Dependencies:** Step 3 (Model Escalation)
- **Estimated files:** 5

## Objective
Track cumulative token cost per session using model pricing lookup. Display running total in TUI. Add configurable cost alert threshold that pauses execution when exceeded.

## Context from Research
- `TokenUsageAccumulator` in `src/plugins/agents/usage.ts` already tracks input/output tokens
- `IterationResult.usage` contains per-iteration token summary
- `summarizeTokenUsageFromOutput()` parses token counts from agent stdout
- TUI dashboard exists — need to find the right component for cost display
- Engine emits `agent:usage` events with token data
- Model info available in `EngineState.currentModel`

## Prerequisites
- [ ] Step 3 (Model Escalation) is implemented — provides model context for pricing
- [ ] ralph-tui builds and tests pass

## Implementation

**Read these files first** (in parallel):
- `src/plugins/agents/usage.ts` — token usage accumulation
- `src/engine/types.ts` — `IterationResult` usage field
- `src/tui/` — dashboard components for display

### 1. Create cost tracker

Create `src/engine/cost-tracker.ts`:

```typescript
/**
 * ABOUTME: Tracks cumulative token cost per session.
 * Uses model pricing lookup to estimate costs from token usage.
 */

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

// Pricing in USD per 1M tokens (update as needed)
const MODEL_PRICING: Record<string, ModelPricing> = {
  'opus': { inputPer1M: 15.0, outputPer1M: 75.0 },
  'claude-opus-4-6': { inputPer1M: 15.0, outputPer1M: 75.0 },
  'sonnet': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'claude-sonnet-4-6': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'haiku': { inputPer1M: 0.80, outputPer1M: 4.0 },
  'claude-haiku-4-5': { inputPer1M: 0.80, outputPer1M: 4.0 },
};

export interface CostSnapshot {
  totalCost: number;
  inputCost: number;
  outputCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  iterationCosts: number[];
}

export class CostTracker {
  private snapshot: CostSnapshot = {
    totalCost: 0,
    inputCost: 0,
    outputCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    iterationCosts: [],
  };

  addIteration(inputTokens: number, outputTokens: number, model?: string): number {
    const pricing = this.getPricing(model);
    const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;
    const iterationCost = inputCost + outputCost;

    this.snapshot.totalCost += iterationCost;
    this.snapshot.inputCost += inputCost;
    this.snapshot.outputCost += outputCost;
    this.snapshot.totalInputTokens += inputTokens;
    this.snapshot.totalOutputTokens += outputTokens;
    this.snapshot.iterationCosts.push(iterationCost);

    return iterationCost;
  }

  getSnapshot(): CostSnapshot {
    return { ...this.snapshot };
  }

  formatCost(): string {
    return `$${this.snapshot.totalCost.toFixed(4)}`;
  }

  private getPricing(model?: string): ModelPricing {
    if (!model) return MODEL_PRICING['sonnet']; // safe default
    // Try exact match, then prefix match
    const key = Object.keys(MODEL_PRICING).find(
      k => model === k || model.startsWith(k) || model.includes(k)
    );
    return key ? MODEL_PRICING[key] : MODEL_PRICING['sonnet'];
  }
}
```

### 2. Add config

In `src/config/types.ts`:

```typescript
export interface CostConfig {
  /** Whether cost tracking is enabled (default: true) */
  enabled?: boolean;
  /** Cost threshold in USD that triggers a pause (default: 0 = no limit) */
  alertThreshold?: number;
}
```

### 3. Integrate into engine

- Instantiate `CostTracker` on engine start
- After each iteration, call `addIteration()` with usage data
- Emit `cost:updated` event with current snapshot
- If `alertThreshold > 0` and exceeded, pause engine and emit `cost:threshold-exceeded`

### 4. Add to TUI dashboard

Find the dashboard component in `src/tui/` and add a cost display showing:
- Running total (e.g., `$0.0234`)
- Per-iteration cost in the iteration details

### 5. Add to session metadata

Include cumulative cost in `SessionMetadata` so it persists across pause/resume.

## Files to Create/Modify

### `src/engine/cost-tracker.ts` (NEW)
Cost tracking with model pricing lookup.

### `src/config/types.ts` (MODIFY)
Add `CostConfig`.

### `src/engine/index.ts` (MODIFY)
Integrate cost tracker, emit events, check threshold.

### `src/engine/types.ts` (MODIFY)
Add `CostUpdatedEvent`, `CostThresholdExceededEvent`.

### `src/tui/` dashboard component (MODIFY)
Display running cost.

## Verification

### Automated Checks (ALL must pass)
```bash
bun run typecheck
bun run build
bun test
```

### Test Cases to Write
```typescript
// tests/engine/cost-tracker.test.ts
// - Opus pricing: 1M input tokens = $15.00
// - Sonnet pricing: 1M input tokens = $3.00
// - Unknown model falls back to sonnet pricing
// - Multiple iterations accumulate correctly
// - Alert threshold triggers at correct cost
// - formatCost() returns readable string
```

### Manual Verification
- [ ] Run ralph with cost tracking — verify cost appears in TUI
- [ ] Set `alertThreshold: 0.01` — verify engine pauses when exceeded
- [ ] Check different models show different costs

## Success Criteria
- [ ] Cost tracked per iteration and cumulatively
- [ ] Model-aware pricing (different rates for opus vs sonnet)
- [ ] Cost visible in TUI dashboard
- [ ] Alert threshold pauses execution
- [ ] Cost persists across session pause/resume

## Scope Boundaries
**Do:** Token-based cost estimation, TUI display, threshold alerting
**Don't:** Exact billing (API-level cost data), cost forecasting, budget management, currency conversion
