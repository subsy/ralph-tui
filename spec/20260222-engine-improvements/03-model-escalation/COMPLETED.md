/**
 * ABOUTME: Completion summary for Step 3 - Model Escalation Strategy.
 */

# Step 3: Model Escalation Strategy - COMPLETED

## Summary

Implemented model escalation strategy that starts with a cheaper model and automatically escalates to a more capable model when a task fails verification or exceeds retry count.

## Files Created

### `src/engine/model-escalation.ts` (NEW)
Pure escalation logic with three exported functions:
- `createEscalationState()` — creates fresh state (Map-based attempt tracker)
- `getModelForTask(taskId, config, state)` — returns the appropriate model based on attempt count
- `recordTaskAttempt(taskId, state)` — increments failure count for a task
- `clearTaskAttempts(taskId, state)` — resets attempts on task completion/skip/abort

### `tests/engine/model-escalation.test.ts` (NEW)
8 tests covering all specified cases:
- First attempt uses startModel
- After `escalateAfter` failures, uses escalateModel
- Stays on startModel before threshold
- Task completion clears attempt counter
- Independent tasks have independent attempt counts
- Clearing one task doesn't affect another

## Files Modified

### `src/config/types.ts`
- Added `ModelEscalationConfig` interface
- Added `DEFAULT_MODEL_ESCALATION` constant
- Added `modelEscalation?: ModelEscalationConfig` to both `StoredConfig` and `RalphConfig`

### `src/engine/types.ts`
- Added `'model:escalated'` to `EngineEventType` union
- Added `ModelEscalatedEvent` interface
- Added `ModelEscalatedEvent` to `EngineEvent` union

### `src/engine/index.ts`
- Imported `ModelEscalationState`, `createEscalationState`, `getModelForTask`, `recordTaskAttempt`, `clearTaskAttempts` from `./model-escalation.js`
- Imported `ModelEscalatedEvent` from `./types.js`
- Imported `DEFAULT_MODEL_ESCALATION` from `../config/types.js`
- Added `escalationState: ModelEscalationState` field to `ExecutionEngine`
- In `runIteration`: before agent execution, determines model via escalation if enabled (explicit `--model` always takes precedence)
- Emits `model:escalated` event when model changes due to escalation
- Records attempt on verification failure (calls `recordTaskAttempt`)
- Records attempt on agent execution error (in catch block)
- Clears attempts on task completion (calls `clearTaskAttempts`)
- Clears attempts on task skip/abort (calls `clearTaskAttempts`)

### `src/commands/run.tsx`
- Added `startModel?` and `escalateModel?` to `ExtendedRuntimeOptions` interface
- Added `--start-model` and `--escalate-model` CLI flag parsing in `parseRunArgs`
- After `buildConfig`, applies CLI overrides to `config.modelEscalation` (enables escalation automatically when either flag is provided)
- Added flags to help text

## Verification

All checks pass:
- `bun run typecheck` — clean
- `bun run build` — clean
- `bun test` — 3296 pass, 0 fail (8 new tests for escalation)

## Behavior

- Escalation is **disabled by default** (`enabled: false`)
- When enabled via config or `--start-model`/`--escalate-model` flags, cheaper model is used first
- Explicit `--model` flag always takes precedence over escalation
- Model escalates after `escalateAfter` (default: 1) failed attempts
- `model:escalated` event is emitted when escalation occurs
- Attempt counters are cleared on task completion, skip, or abort
