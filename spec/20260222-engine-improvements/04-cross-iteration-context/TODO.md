# Step 4: Cross-Iteration Context - Todo

## Status: ⬜ Not Started

## Tasks
- [ ] Create `src/engine/diff-summarizer.ts` with `generateDiffSummary()` and `formatDiffContext()`
- [ ] Add `diffSummary?: DiffSummary` to `IterationResult` in `src/engine/types.ts`
- [ ] Integrate diff capture in `src/engine/index.ts` (after task completion, BEFORE auto-commit)
- [ ] Store diff summaries and maintain rolling window on engine instance
- [ ] Add `diffContext` to `TemplateVariables` in `src/templates/types.ts`
- [ ] Update `src/templates/engine.ts` to format rolling diff summaries via `formatDiffContext()` and include as `diffContext`
- [ ] Add diff context block to `src/plugins/trackers/builtin/json/template.hbs` template
- [ ] Write tests: no changes returns null, new files detected, modified files detected, format multiple summaries
- [ ] Manual verification: run 2+ iterations and verify second iteration's prompt includes diff context from first
- [ ] Run `bun run typecheck`, `bun run build`, `bun test`

## Notes
[Add during implementation]

## Blockers
[Document any blockers]
