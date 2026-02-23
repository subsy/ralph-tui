# Step 4: Cross-Iteration Context — Completed

## Summary

Implemented structured diff summaries that capture what changed after each iteration and feed that context into subsequent iteration prompts.

## Files Created

### `src/engine/diff-summarizer.ts` (NEW)
- `DiffSummary` interface: `filesChanged`, `filesAdded`, `filesDeleted`, `summary`
- `generateDiffSummary(cwd)`: runs `git status --porcelain`, categorizes files, returns null if nothing changed
- `formatDiffContext(summaries)`: formats rolling array of summaries into markdown block for prompt injection
- Key fix: uses `split('\n').filter(Boolean)` instead of `.trim().split('\n')` to preserve leading-space git status codes (e.g., ` M` for unstaged modified files)

### `tests/engine/diff-summarizer.test.ts` (NEW)
- 9 tests covering: no changes → null, untracked files → filesAdded, modified files → filesChanged, summary formatting, formatDiffContext with 0/1/N summaries
- Uses `Bun.spawn` directly (not `runProcess`) to avoid mock pollution from other tests in the full suite — same pattern as `auto-commit.test.ts`

## Files Modified

### `src/engine/types.ts`
- Added `import type { DiffSummary }` from diff-summarizer
- Added `diffSummary?: DiffSummary` to `IterationResult`

### `src/engine/index.ts`
- Added imports: `generateDiffSummary`, `formatDiffContext`, `DiffSummary`
- Added `private recentDiffSummaries: DiffSummary[] = []` rolling window field to `ExecutionEngine`
- Extended `buildPrompt()` signature with `diffContext?: string` parameter; passes it into `extendedContext`
- In `runIteration()`, before prompt build: `formatDiffContext(this.recentDiffSummaries)` is computed and passed to `buildPrompt`
- After task completion but BEFORE auto-commit: calls `generateDiffSummary()`, stores in rolling window (max 5), stores on result
- `IterationResult` construction includes `diffSummary: diffSummary ?? undefined`

### `src/templates/types.ts`
- Added `diffContext: string` to `TemplateVariables`

### `src/templates/engine.ts`
- Added `diffContext?: string` to `ExtendedTemplateContext`
- Added `diffContext` extraction in `buildTemplateVariables()`
- Added `diffContext` to the returned `TemplateVariables` object

### `src/plugins/trackers/builtin/json/template.hbs`
- Added `{{#if diffContext}} ... {{/if}}` block between `recentProgress` and `verificationErrors`

### `src/templates/builtin.ts`
- Added `{{#if diffContext}} ... {{/if}}` block to `JSON_TEMPLATE` string (same location)

## Verification

```
bun run typecheck  ✓ (no errors)
bun run build      ✓ (builds successfully)
bun test           ✓ (9 new tests pass; 4 pre-existing integration failures unchanged)
```

## Notes

- The 4 pre-existing `ExecutionEngine Integration` test failures only occur in the full test suite due to Bun mock restoration issues — they pass in isolation. This is pre-existing behavior unrelated to this step.
- Diff is captured only when `taskCompleted = true` (not on failed/incomplete iterations) for signal clarity.
- Works regardless of `autoCommit` setting since diff is captured before the commit happens.
