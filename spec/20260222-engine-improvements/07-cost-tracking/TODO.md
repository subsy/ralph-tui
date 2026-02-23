# Step 7: Cost Tracking - Todo

## Status: ⬜ Not Started

## Tasks
- [ ] **Prerequisite:** Verify Step 3 (Model Escalation) is implemented and merged
- [ ] Create `src/engine/cost-tracker.ts` with `CostTracker` class and `ModelPricing` data
- [ ] Implement cost calculation methods: `addIteration()`, `getSnapshot()`, `formatCost()`
- [ ] Implement `getPricing()` with model name matching (exact and prefix)
- [ ] Add `CostConfig` interface to `src/config/types.ts` (enabled, alertThreshold)
- [ ] Add `CostUpdatedEvent` and `CostThresholdExceededEvent` to `src/engine/types.ts`
- [ ] Integrate `CostTracker` into engine: instantiate on start, call `addIteration()` after each iteration
- [ ] Emit `cost:updated` event after each iteration with current snapshot
- [ ] Implement threshold checking: if exceeded, pause engine and emit `cost:threshold-exceeded`
- [ ] Find and update TUI dashboard component to display running cost total
- [ ] Add cumulative cost to `SessionMetadata` for persistence across pause/resume
- [ ] Write tests: opus/sonnet pricing, unknown model fallback, multiple iterations, alert threshold, formatCost()
- [ ] Manual verification: run with cost tracking visible in TUI, set low threshold and verify pause
- [ ] Run `bun run typecheck`, `bun run build`, `bun test`

## Notes
[Add during implementation]

## Blockers
- Depends on Step 3 (Model Escalation) being completed
