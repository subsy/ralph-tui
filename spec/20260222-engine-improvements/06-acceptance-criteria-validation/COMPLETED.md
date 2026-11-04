/**
 * ABOUTME: Completion summary for Step 6 - Acceptance Criteria Validation.
 */

# Step 6: Acceptance Criteria Validation — COMPLETED

## Summary

Implemented AC parsing and verification integration as specified.

## Files Created

### `src/engine/ac-validator.ts` (NEW)
- `parseExecutableCriteria(criteria: string[]): ExecutableAC[]` — parses AC strings for backtick commands and file-existence patterns
- `acToVerificationCommands(acs: ExecutableAC[]): string[]` — converts parsed AC to shell commands
- `getAcVerificationCommands(taskMetadata?)` — convenience wrapper used by the engine

### `tests/engine/ac-validator.test.ts` (NEW)
17 tests covering all specified test cases:
- Backtick command extraction
- File existence detection
- Non-executable criteria skipped gracefully
- Mixed criteria (only executable returned)
- Empty criteria array

## Files Modified

### `src/engine/index.ts`
- Added import for `getAcVerificationCommands`
- In the verification gate block: AC commands are prepended to configured commands before running `runVerification`

## Notes

- The JSON tracker already stored `acceptanceCriteria` in `task.metadata` (lines 287-293 of `json/index.ts`), so no tracker modification was needed.
- 4 pre-existing test failures in `tests/engine/` (integration test isolation issue) — confirmed present before this change.

## Verification

```
bun run typecheck  ✓ (clean)
bun run build      ✓ (clean)
bun test tests/engine/ac-validator.test.ts  ✓ (17 pass, 0 fail)
```
