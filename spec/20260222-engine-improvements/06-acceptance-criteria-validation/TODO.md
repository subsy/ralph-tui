# Step 6: Acceptance Criteria Validation - Todo

## Status: ⬜ Not Started

## Tasks
- [ ] **Prerequisite:** Verify Step 1 (Verification Gates) is implemented and merged
- [ ] Create `src/engine/ac-validator.ts` with `parseExecutableCriteria()` and `acToVerificationCommands()`
- [ ] Implement pattern detection: backtick commands, file existence, file contains
- [ ] Implement `looksLikeCommand()` helper function
- [ ] Update `src/engine/verification.ts` to accept AC-derived commands alongside configured commands
- [ ] Integrate AC extraction in `src/engine/index.ts` before running verification
- [ ] Ensure JSON tracker includes `acceptanceCriteria` in `TrackerTask.metadata`
- [ ] Write tests: backtick command extraction, file existence patterns, non-executable criteria skipped, mixed criteria, empty criteria
- [ ] Manual verification: run with AC containing `Running \`bun test\` passes`, verify test runs; test non-executable AC skipped
- [ ] Run `bun run typecheck`, `bun run build`, `bun test`

## Notes
[Add during implementation]

## Blockers
- Depends on Step 1 (Verification Gates) being completed
