# Step 2: Auto-Commit Defaults

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this task.

## Quick Reference
- **Branch:** `feat/engine-improvements-02-auto-commit`
- **Complexity:** S
- **Dependencies:** None
- **Estimated files:** 3

## Objective
Make `autoCommit: true` the default behavior. Improve commit messages to include iteration context. Add `--no-auto-commit` CLI flag for opt-out.

## Context from Research
- Auto-commit already fully implemented in `src/engine/auto-commit.ts`
- Current default is `autoCommit: false` — users must opt in
- Commit message format: `feat: ${taskId} - ${taskTitle}` (line 72)
- Called after task completion at `src/engine/index.ts:1334`
- Events: `task:auto-committed`, `task:auto-commit-failed` already exist
- CLI options parsed in `src/commands/run.ts` or similar

## Prerequisites
- [ ] ralph-tui builds and tests pass on current main

## Implementation

**Read these files first** (in parallel):
- `src/engine/auto-commit.ts` — current implementation
- `src/config/types.ts` — where `autoCommit` is defined
- `src/config/merge.ts` or equivalent — where defaults are applied

### 1. Change default to true

In `src/config/types.ts` or wherever the default config is built, change `autoCommit` default from `false` to `true`.

### 2. Add --no-auto-commit CLI flag

Find where CLI options are parsed (likely `src/commands/run.ts` or `src/cli.tsx`) and add:
- `--no-auto-commit` flag that sets `autoCommit: false`
- `--auto-commit` flag that explicitly sets `autoCommit: true`

### 3. Improve commit messages

In `src/engine/auto-commit.ts`, change the commit message format:

```typescript
// Before:
const commitMessage = `feat: ${taskId} - ${taskTitle}`;

// After:
const commitMessage = `feat(ralph): ${taskId} - ${taskTitle}\n\nIteration: ${iteration}\nAgent: ralph-tui`;
```

Add `iteration` parameter to `performAutoCommit()`.

## Files to Create/Modify

### `src/engine/auto-commit.ts` (MODIFY)
Add iteration parameter, improve commit message format.

### `src/config/types.ts` (MODIFY)
Change autoCommit default to true.

### CLI command file (MODIFY)
Add `--no-auto-commit` and `--auto-commit` flags.

## Verification

### Automated Checks (ALL must pass)
```bash
bun run typecheck
bun run build
bun test
```

### Test Cases to Write
```typescript
// Update existing auto-commit tests to verify:
// - New commit message format includes iteration number
// - Default config has autoCommit: true
// - --no-auto-commit flag overrides to false
```

### Manual Verification
- [ ] Run ralph without specifying autoCommit — verify commits happen automatically
- [ ] Run with `--no-auto-commit` — verify no commits
- [ ] Check commit messages include iteration number

## Success Criteria
- [ ] `autoCommit` defaults to `true`
- [ ] `--no-auto-commit` flag works
- [ ] Commit messages include iteration context
- [ ] Existing auto-commit tests updated and passing

## Scope Boundaries
**Do:** Default change, CLI flag, better messages
**Don't:** Branch creation per task, push to remote, commit signing
