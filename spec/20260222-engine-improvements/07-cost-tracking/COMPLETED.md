/**
 * ABOUTME: Completion summary for Step 7 - Cost Tracking.
 * Documents what was implemented and how verification was confirmed.
 */

# Step 7: Cost Tracking - COMPLETED

## Summary

Implemented cumulative token cost tracking per session with model-aware pricing, TUI display, cost alert threshold, and session persistence.

## Files Created

### `src/engine/cost-tracker.ts` (NEW)
- `CostTracker` class with `addIteration(inputTokens, outputTokens, model?)` method
- `MODEL_PRICING` lookup table for opus, sonnet, haiku (exact and shorthand variants)
- Prefix/substring matching for unknown models with sonnet fallback
- `getSnapshot()` returns a defensive copy of `CostSnapshot`
- `formatCost()` returns dollar-formatted string (e.g., `$0.0234`)

### `tests/engine/cost-tracker.test.ts` (NEW)
- 10 tests covering: opus pricing, sonnet pricing, haiku pricing, unknown model fallback, undefined model fallback, multi-iteration accumulation, formatCost format, zero tokens, prefix matching, snapshot immutability

## Files Modified

### `src/engine/types.ts`
- Added `import type { CostSnapshot }` from cost-tracker
- Added `'cost:updated'` and `'cost:threshold-exceeded'` to `EngineEventType` union
- Added `CostUpdatedEvent` and `CostThresholdExceededEvent` interfaces
- Added both to the `EngineEvent` union
- Added `costSnapshot?: CostSnapshot` to `EngineState`

### `src/config/types.ts`
- Added `CostConfig` interface (`enabled?: boolean`, `alertThreshold?: number`)
- Added `cost?: CostConfig` to both `StoredConfig` and `RalphConfig`

### `src/engine/index.ts`
- Imported `CostTracker`
- Added `private costTracker: CostTracker = new CostTracker()` field
- After each successful iteration (when usage data is available): calls `costTracker.addIteration()`, emits `cost:updated`, checks threshold and pauses engine + emits `cost:threshold-exceeded` if exceeded
- Updated `updateSessionIteration()` call to pass `costSnapshot.totalCost` for persistence

### `src/session/types.ts`
- Added `cumulativeCost?: number` to `SessionMetadata`

### `src/session/index.ts`
- Added `cumulativeCost?: number` parameter to `updateSessionIteration()`
- Persists value to session when provided

### `src/tui/components/ProgressDashboard.tsx`
- Added `totalCost?: number` to `ProgressDashboardProps`
- Added cost display in Row 2 (Tracker row): `Cost: $0.0234` when `totalCost > 0`

### `src/tui/components/RunApp.tsx`
- Added `const [totalCost, setTotalCost] = useState<number>(0)` state
- Handle `cost:updated` and `cost:threshold-exceeded` events to update `totalCost`
- Pass `totalCost > 0 ? totalCost : undefined` to `ProgressDashboard`

## Verification

- `bun run typecheck`: PASS (no errors)
- `bun run build`: PASS
- `bun test tests/engine/cost-tracker.test.ts`: 10/10 PASS
- Full suite: 4 pre-existing failures (unrelated to this step, confirmed by checking without changes)
