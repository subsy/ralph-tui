/**
 * ABOUTME: Completion record for step 05 - completion detection hardening.
 */

# Step 5 Completion: Completion Detection Hardening

## What Was Done

### Files Created
- `src/engine/completion-strategies.ts` — Strategy pattern with three built-in strategies:
  - `promiseTagStrategy` — exact `<promise>COMPLETE</promise>` match (original behavior)
  - `relaxedTagStrategy` — adds `promise: complete` alternate form
  - `heuristicStrategy` — exit code 0 + completion phrase in last 500 chars
  - `detectCompletion()` orchestrator — runs strategies in order, returns first match

### Files Modified
- `src/config/types.ts` — Added `CompletionConfig` interface and `CompletionStrategyName` import; added `completion?: CompletionConfig` to both `StoredConfig` and `RalphConfig`
- `src/engine/index.ts` — Replaced `PROMISE_COMPLETE_PATTERN.test(agentResult.stdout)` with `detectCompletion(agentResult, this.config.completion?.strategies ?? ['promise-tag'])`

### Files Created (tests)
- `tests/engine/completion-detection.test.ts` — 20 tests covering all strategies and the orchestrator

## Verification Results

```
bun run typecheck  — PASS
bun run build      — PASS (bundled 368/372 modules)
bun test tests/engine/completion-detection.test.ts — 20 pass, 0 fail (100% coverage)
bun test tests/engine/integration.test.ts — 10 pass, 0 fail
```

## Notes on Pre-existing Test Failures

The full `bun test` suite shows 4-9 failures from `tests/engine/diff-summarizer.test.ts` (added by a previous step, step 4). These tests run git operations against the repo and contaminate shared state, causing some integration tests to fail when run together. These failures exist independently of this step's changes and are documented here for awareness.

## Success Criteria Met

- [x] Current behavior unchanged with default config (`['promise-tag']` is the default)
- [x] Multiple strategies configurable via `completion.strategies` in config
- [x] `detectCompletion` returns `matchedStrategy` name for logging
- [x] All new completion detection tests pass
