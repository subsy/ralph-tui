# Step 8: First-Class Parallel Execution

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this task.

## Quick Reference
- **Branch:** `feat/engine-improvements-08-parallel`
- **Complexity:** S
- **Dependencies:** None
- **Estimated files:** 3

## Objective
Make `--parallel` a well-documented first-class CLI flag. Auto-detect independent tasks from the dependency graph by default. Make the conflict resolution timeout configurable via config.

## Context from Research
- Full parallel system exists in `src/parallel/` — coordinator, workers, merge engine, conflict resolver
- `ParallelConfig` already in `src/config/types.ts` with `mode`, `maxWorkers`, `worktreeDir`, `directMerge`
- `ConflictResolutionConfig` has `timeoutMs` but hardcoded default of 120000ms
- CLI already supports `--parallel [N]` and `--serial` flags
- Parallel mode uses git worktrees for isolation
- Task dependency graph analysis exists in parallel coordinator

## Prerequisites
- [ ] ralph-tui builds and tests pass on current main

## Implementation

**Read these files first** (in parallel):
- `src/parallel/` — coordinator, types
- `src/config/types.ts` — `ParallelConfig`, `ConflictResolutionConfig`
- CLI command file — where `--parallel` flag is defined

### 1. Make parallel mode 'auto' by default

Change `ParallelConfig.mode` default from `'never'` to `'auto'`:

```typescript
// In default config resolution
const defaultParallelConfig: ParallelConfig = {
  mode: 'auto',  // was 'never'
  maxWorkers: 3,
  directMerge: false,
};
```

When `mode: 'auto'`, the parallel coordinator should:
- Analyze the task dependency graph
- If 2+ tasks are independent (no shared dependencies), run in parallel
- If all tasks are sequential, fall back to serial mode automatically

### 2. Make conflict timeout configurable

Ensure `ConflictResolutionConfig.timeoutMs` is actually wired through to the conflict resolver. If it's hardcoded, replace with config value:

```typescript
// In conflict resolver
const timeout = config.conflictResolution?.timeoutMs ?? 120_000;
```

### 3. Improve CLI help text

Update the CLI help to make `--parallel` more visible:

```
Parallel Execution:
  --parallel [N]       Enable parallel mode with N workers (default: 3)
  --serial             Force sequential execution
  --direct-merge       Merge directly to current branch (skip session branch)
```

### 4. Add `--conflict-timeout` flag

```
  --conflict-timeout <ms>   AI conflict resolution timeout per file (default: 120000)
```

## Files to Create/Modify

### `src/config/types.ts` (MODIFY)
Change parallel mode default to 'auto'.

### CLI command file (MODIFY)
Add `--conflict-timeout` flag, improve help text.

### `src/parallel/conflict-resolver.ts` (MODIFY)
Ensure timeout is read from config, not hardcoded.

## Verification

### Automated Checks (ALL must pass)
```bash
bun run typecheck
bun run build
bun test
```

### Test Cases to Write
```typescript
// - Default parallel mode is 'auto'
// - Auto mode detects independent tasks
// - Auto mode falls back to serial when all tasks depend on each other
// - --serial overrides auto to sequential
// - --conflict-timeout passed through to resolver
```

### Manual Verification
- [ ] Run with default config on PRD with independent tasks — verify parallel execution
- [ ] Run with fully sequential tasks — verify falls back to serial
- [ ] Verify `--serial` overrides parallel auto-detection

## Success Criteria
- [ ] Parallel mode defaults to 'auto'
- [ ] Independent tasks auto-detected from dependency graph
- [ ] Conflict timeout configurable via CLI and config
- [ ] `--serial` still works as override
- [ ] Help text clearly documents parallel options

## Scope Boundaries
**Do:** Default change, CLI flags, timeout wiring
**Don't:** New parallel strategies, distributed execution, parallel UI improvements
