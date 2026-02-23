# Step 5: Completion Detection Hardening - Todo

## Status: ⬜ Not Started

## Tasks
- [ ] Create `src/engine/completion-strategies.ts` with `CompletionStrategy` interface
- [ ] Implement `promiseTagStrategy` in `src/engine/completion-strategies.ts`
- [ ] Implement `relaxedTagStrategy` in `src/engine/completion-strategies.ts`
- [ ] Implement `heuristicStrategy` in `src/engine/completion-strategies.ts`
- [ ] Create strategy map and `detectCompletion()` orchestrator function
- [ ] Add `CompletionConfig` interface to `src/config/types.ts`
- [ ] Add `CompletionStrategyName` type to `src/config/types.ts`
- [ ] Add `completion?: CompletionConfig` to `StoredConfig` and `RalphConfig`
- [ ] Replace single regex detection in `src/engine/index.ts` with `detectCompletion()` call
- [ ] Update `tests/engine/completion-detection.test.ts` to test all strategies
- [ ] Write tests: promise-tag exact/case-insensitive/whitespace, relaxed-tag in fences, heuristic requires exit 0, strategy ordering, default config
- [ ] Manual verification: test default (promise-tag only), test with multiple strategies, verify no false positives
- [ ] Run `bun run typecheck`, `bun run build`, `bun test`

## Notes
[Add during implementation]

## Blockers
[Document any blockers]
