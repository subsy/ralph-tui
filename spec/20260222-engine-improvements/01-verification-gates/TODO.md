# Step 1: Verification Gates - Todo

## Status: ⬜ Not Started

## Tasks
- [ ] Add config types: `VerificationConfig` and `DEFAULT_VERIFICATION_CONFIG` to `src/config/types.ts`
- [ ] Add `verification?: VerificationConfig` to `StoredConfig` and `RalphConfig`
- [ ] Create `src/engine/verification.ts` with `runVerification()` and `formatVerificationErrors()`
- [ ] Add verification events (`VerificationStartedEvent`, `VerificationPassedEvent`, `VerificationFailedEvent`) to `src/engine/types.ts`
- [ ] Integrate verification into engine loop in `src/engine/index.ts` (post-completion, pre-task-marking)
- [ ] Add `verificationErrors` to `TemplateVariables` in `src/templates/types.ts`
- [ ] Add verification errors block to `src/plugins/trackers/builtin/json/template.hbs`
- [ ] Write tests for `runVerification()` (all pass, first failure, timeout, empty commands, format errors)
- [ ] Manual verification: test with failing type checks, passing verification, and disabled verification
- [ ] Run `bun run typecheck`, `bun run build`, `bun test`

## Notes
[Add during implementation]

## Blockers
[Document any blockers]
