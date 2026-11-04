# Step 4: Cross-Iteration Context

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this task.

## Quick Reference
- **Branch:** `feat/engine-improvements-04-cross-iteration-context`
- **Complexity:** M
- **Dependencies:** None
- **Estimated files:** 5

## Objective
After each completed iteration, generate a structured diff summary (files changed, exports added, key patterns established). Feed this as structured context to subsequent iterations instead of relying only on raw output history and the minimal `progress.md`.

## Context from Research
- Current cross-iteration context: `getRecentProgressSummary()` in `src/logs/index.ts` returns last 5 iteration summaries
- `getCodebasePatternsForPrompt()` reads from `progress.md` file
- Template variable `recentProgress` carries this to prompts
- Template variable `codebasePatterns` carries `progress.md` content
- Git diff available via `runProcess('git', ['diff', ...])` in `src/utils/process.ts`
- Auto-commit happens before iteration log save — diff should be captured before commit

## Prerequisites
- [ ] ralph-tui builds and tests pass on current main

## Implementation

**Read these files first** (in parallel):
- `src/logs/index.ts` — `getRecentProgressSummary()` and `getCodebasePatternsForPrompt()`
- `src/templates/types.ts` — `TemplateVariables` for adding new context
- `src/templates/engine.ts` — `renderPrompt()` and how extended context is built

### 1. Create diff summarizer

Create `src/engine/diff-summarizer.ts`:

```typescript
/**
 * ABOUTME: Generates structured diff summaries after each iteration.
 * Captures files changed, new exports, and patterns for cross-iteration context.
 */

import { runProcess } from '../utils/process.js';

export interface DiffSummary {
  filesChanged: string[];
  filesAdded: string[];
  filesDeleted: string[];
  summary: string;
}

/**
 * Generate a structured diff summary of changes since the last commit.
 * Should be called BEFORE auto-commit to capture the iteration's changes.
 */
export async function generateDiffSummary(cwd: string): Promise<DiffSummary | null> {
  // Get list of changed files
  const statusResult = await runProcess('git', ['status', '--porcelain'], { cwd });
  if (!statusResult.success || !statusResult.stdout.trim()) return null;

  const lines = statusResult.stdout.trim().split('\n');
  const filesAdded: string[] = [];
  const filesChanged: string[] = [];
  const filesDeleted: string[] = [];

  for (const line of lines) {
    const status = line.substring(0, 2).trim();
    const file = line.substring(3);
    if (status === 'A' || status === '??') filesAdded.push(file);
    else if (status === 'D') filesDeleted.push(file);
    else filesChanged.push(file);
  }

  // Get compact diff stat
  const diffResult = await runProcess('git', ['diff', '--stat', 'HEAD'], { cwd });
  const stat = diffResult.success ? diffResult.stdout.trim() : '';

  // Build human-readable summary
  const parts: string[] = [];
  if (filesAdded.length > 0) parts.push(`Created: ${filesAdded.join(', ')}`);
  if (filesChanged.length > 0) parts.push(`Modified: ${filesChanged.join(', ')}`);
  if (filesDeleted.length > 0) parts.push(`Deleted: ${filesDeleted.join(', ')}`);

  return {
    filesChanged,
    filesAdded,
    filesDeleted,
    summary: parts.join('\n'),
  };
}

/**
 * Format multiple iteration diff summaries into a context block
 * suitable for injection into agent prompts.
 */
export function formatDiffContext(summaries: DiffSummary[]): string {
  if (summaries.length === 0) return '';

  return summaries.map((s, i) =>
    `### Iteration ${i + 1}\n${s.summary}`
  ).join('\n\n');
}
```

### 2. Store diff summaries in iteration results

In `src/engine/types.ts`, add `diffSummary?: DiffSummary` to `IterationResult`.

### 3. Capture diffs in engine loop

In `src/engine/index.ts`, after task completion but BEFORE auto-commit:

```typescript
// Capture diff summary before auto-commit (which stages and commits)
let diffSummary: DiffSummary | null = null;
if (taskCompleted) {
  diffSummary = await generateDiffSummary(this.config.cwd);
}
```

Store on the `IterationResult` and maintain a rolling window of last N summaries on the engine.

### 4. Inject into prompt context

Add `diffContext` to `TemplateVariables` in `src/templates/types.ts`.

In `src/templates/engine.ts`, when building extended context, format the rolling diff summaries via `formatDiffContext()` and include as `diffContext`.

### 5. Update templates

In the JSON tracker template, add:

```handlebars
{{#if diffContext}}

## Recent Changes (by previous iterations)

{{{diffContext}}}
{{/if}}
```

## Files to Create/Modify

### `src/engine/diff-summarizer.ts` (NEW)
Diff summary generation and formatting.

### `src/engine/types.ts` (MODIFY)
Add `diffSummary` to `IterationResult`.

### `src/engine/index.ts` (MODIFY)
Capture diff before auto-commit, maintain rolling summaries.

### `src/templates/types.ts` (MODIFY)
Add `diffContext` to `TemplateVariables`.

### `src/plugins/trackers/builtin/json/template.hbs` (MODIFY)
Add diff context block.

## Verification

### Automated Checks (ALL must pass)
```bash
bun run typecheck
bun run build
bun test
```

### Test Cases to Write
```typescript
// tests/engine/diff-summarizer.test.ts
// - No changes → returns null
// - New files → filesAdded populated
// - Modified files → filesChanged populated
// - Format multiple summaries → readable output
```

### Manual Verification
- [ ] Run 2+ iterations — verify second iteration's prompt includes diff context from first
- [ ] Check that diff summary appears in iteration logs

## Success Criteria
- [ ] Diff summary captured after each iteration
- [ ] Subsequent iterations receive structured change context
- [ ] Works with and without auto-commit enabled
- [ ] Does not break existing progress.md behavior

## Scope Boundaries
**Do:** Diff capture, summary formatting, template injection
**Don't:** AI-powered diff analysis, export/import detection, semantic diff
