# Step 3: Model Escalation - Todo

## Status: ⬜ Not Started

## Tasks
- [ ] Add config types: `ModelEscalationConfig` and `DEFAULT_MODEL_ESCALATION` to `src/config/types.ts`
- [ ] Add `modelEscalation?: ModelEscalationConfig` to `StoredConfig` and `RalphConfig`
- [ ] Create `src/engine/model-escalation.ts` with `ModelEscalationState`, `getModelForTask()`, `recordTaskAttempt()`, `createEscalationState()`
- [ ] Add `ModelEscalatedEvent` to `src/engine/types.ts`
- [ ] Integrate escalation into `src/engine/index.ts`: instantiate state, determine model before agent execution, record attempts on retry, clear on completion
- [ ] Emit `model:escalated` event when model changes
- [ ] Add `--start-model` CLI flag
- [ ] Add `--escalate-model` CLI flag
- [ ] Write tests: first attempt uses startModel, escalates after failures, completion clears counter
- [ ] Manual verification: configure escalation and run failing task to verify model escalates
- [ ] Run `bun run typecheck`, `bun run build`, `bun test`

## Notes
[Add during implementation]

## Blockers
[Document any blockers]
