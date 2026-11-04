/**
 * ABOUTME: Completion summary for Step 1: Verification Gates.
 */

# Step 1: Verification Gates — COMPLETED

## Summary

Implemented configurable post-completion verification commands that run after an agent signals `<promise>COMPLETE</promise>` but before the task is marked done in the tracker. If verification fails, the task is NOT marked complete and the engine retries with the verification error output injected into the next prompt.

## Files Created

### `src/engine/verification.ts` (NEW)
Verification gate runner with:
- `runVerification(cwd, config)` — runs all commands via `sh -c`, stops on first failure, returns `VerificationResult`
- `formatVerificationErrors(result)` — formats failures into readable multi-line string for prompt injection

### `tests/engine/verification.test.ts` (NEW)
11 tests covering:
- All commands pass → `result.passed === true`
- First command fails → stops, `result.passed === false`
- Timeout → `result.passed === false`
- Empty commands → `result.passed === true` (vacuously true)
- Format errors → readable multi-line string with command, exit code, stdout, stderr
- Only failed commands appear in formatted output

## Files Modified

### `src/config/types.ts`
- Added `VerificationConfig` interface with `enabled`, `commands`, `timeoutMs`, `maxRetries`
- Added `DEFAULT_VERIFICATION_CONFIG` constant
- Added `verification?: VerificationConfig` to both `StoredConfig` and `RalphConfig`

### `src/engine/types.ts`
- Added `'verification:started' | 'verification:passed' | 'verification:failed'` to `EngineEventType` union
- Added `VerificationStartedEvent`, `VerificationPassedEvent`, `VerificationFailedEvent` interfaces
- Added new events to `EngineEvent` union type

### `src/engine/index.ts`
- Imported `runVerification`, `formatVerificationErrors`, `DEFAULT_VERIFICATION_CONFIG`
- Added `lastVerificationErrors: string` and `verificationRetryMap: Map<string, number>` private fields
- Modified `buildPrompt()` to accept and pass `verificationErrors` into template context
- Modified `runIteration()` to clear `lastVerificationErrors` when no pending verification retries
- Inserted verification gate between completion detection and task completion marking:
  - Emits `verification:started` event
  - Runs all configured commands
  - On pass: emits `verification:passed`, clears state
  - On fail: emits `verification:failed`, stores errors for next prompt, suppresses completion
  - On exhausted retries (`verificationRetries >= maxRetries`): skips gate and marks done

### `src/templates/types.ts`
- Added `verificationErrors: string` to `TemplateVariables`

### `src/templates/engine.ts`
- Added `verificationErrors?: string` to `ExtendedTemplateContext`
- Wires `verificationErrors` through `buildTemplateVariables()`

### `src/templates/builtin.ts`
- Added `{{#if verificationErrors}}` block to `JSON_TEMPLATE` after `recentProgress`

### `src/plugins/trackers/builtin/json/template.hbs`
- Added same `{{#if verificationErrors}}` block (reference copy)

## Verification Results

```
bun run typecheck  ✓ (no errors)
bun run build      ✓ (bundled successfully)
bun test           ✓ 3278 pass, 0 fail
```

## Behavior When Disabled

When `verification.enabled` is `false` (default) or `verification` is not configured, the engine skips the gate entirely — existing behavior is unchanged.
