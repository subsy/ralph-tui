---
title: "Parallel Execution Hang — Tracker Initialization in Git Worktrees"
category: runtime-errors
component: parallel-execution
symptoms:
  - "Application hangs after creating worktrees during parallel execution"
  - "No output after 'Preparing worktree' messages"
  - "TUI never opens when parallel mode activates"
root_cause: "Worker engines initialized independent tracker instances in worktree directories where tracker data (.beads/) doesn't exist"
severity: critical
date_resolved: 2026-01-27
tags: [parallel, worktree, tracker, beads-rust, dependency-injection, execution-engine]
related_files:
  - src/engine/index.ts
  - src/parallel/worker.ts
  - src/parallel/index.ts
  - src/commands/run.tsx
---

# Parallel Execution Hang — Tracker Initialization in Git Worktrees

## Problem

Running `bun run dev --tracker beads-rust --cwd /tmp/ralph-tui/` would appear to hang after printing:

```text
Parallel execution enabled: 1 group(s), max parallelism 15
error: branch 'ralph-parallel/ralph-tui-12m' not found
Preparing worktree (new branch 'ralph-parallel/ralph-tui-12m')
...
```

No further output would appear. The application seemed frozen.

## Investigation

Two separate issues were discovered:

### Issue 1: Silent Execution (No Visible Output)

The parallel execution path in `run.tsx` bypasses the TUI entirely:

```typescript
if (useParallel) {
  await parallelExecutor.execute();   // No TUI, blocks silently
} else if (config.showTui) {
  await runWithTui(engine, ...);      // TUI only for sequential
}
```

Event logging was gated behind `!config.showTui`, meaning TUI mode (the default) produced **zero output** during parallel execution. The workers were actually running — they just had no visible feedback.

### Issue 2: Tracker Re-Initialization in Worktrees

Each `Worker` created its own `ExecutionEngine`, which called `engine.initialize()`. This method independently initializes a tracker instance:

```typescript
// Old code in ExecutionEngine.initialize():
const trackerRegistry = getTrackerRegistry();
this.tracker = await trackerRegistry.getInstance(this.config.tracker);
await this.tracker.sync();  // Hangs — .beads/ doesn't exist in worktree
```

For `beads-rust`, `tracker.sync()` runs `br sync` in the worktree directory. Since `.beads/` is either gitignored or not accessible in worktrees, this would fail or hang.

Additionally, the engine's `runLoop()` calls `tracker.getNextTask()` for task selection — it had no concept of the pre-assigned task that the `Worker` holds.

## Root Cause

**Architectural gap**: The `Worker` wraps an `ExecutionEngine` but the engine was designed for standalone operation. It initializes its own tracker and selects its own tasks. In parallel mode, workers need:
1. A **shared tracker** (initialized once by the parent executor)
2. A **forced task** (assigned by the executor, not discovered via tracker)

## Solution

### 1. Worker Mode for ExecutionEngine (`src/engine/index.ts`)

Added `WorkerModeOptions` interface for dependency injection:

```typescript
export interface WorkerModeOptions {
  tracker: TrackerPlugin;    // Pre-initialized, shared tracker
  forcedTask: TrackerTask;   // The specific task to work on
}
```

Modified `initialize()` to accept optional worker mode:

```typescript
async initialize(workerMode?: WorkerModeOptions): Promise<void> {
  // ... agent init (always needed) ...

  if (workerMode) {
    // Worker mode: use injected tracker, skip sync
    this.tracker = workerMode.tracker;
    this.forcedTask = workerMode.forcedTask;
    this.state.totalTasks = 1;
  } else {
    // Normal mode: init tracker from config
    const trackerRegistry = getTrackerRegistry();
    this.tracker = await trackerRegistry.getInstance(this.config.tracker);
    await this.tracker.sync();
    // ...
  }
}
```

### 2. Forced Task in Run Loop (`src/engine/index.ts`)

Task selection returns the forced task instead of querying the tracker:

```typescript
private async getNextAvailableTask(): Promise<TrackerTask | null> {
  if (this.forcedTask) {
    if (this.state.tasksCompleted >= 1) return null; // Done
    return this.forcedTask;
  }
  // ... normal tracker-based selection ...
}
```

Completion check uses single-task logic in worker mode:

```typescript
const isComplete = this.forcedTask
  ? this.state.tasksCompleted >= 1
  : await this.tracker!.isComplete();
```

### 3. Tracker Injection in Worker (`src/parallel/worker.ts`)

Worker accepts tracker from executor and passes it to the engine:

```typescript
async initialize(baseConfig: RalphConfig, tracker: TrackerPlugin): Promise<void> {
  this.engine = new ExecutionEngine(workerConfig);
  await this.engine.initialize({
    tracker,
    forcedTask: this.config.task,
  });
}
```

### 4. Unconditional Event Logging (`src/commands/run.tsx`)

Removed the `!config.showTui` guard so parallel events always log to console.

## Prevention

- **Dependency injection over self-initialization**: When components run in isolated contexts (worktrees), shared resources (tracker, config) should be injected rather than re-initialized.
- **Always provide visible feedback**: Never gate logging behind a feature flag for a code path that doesn't have that feature yet. The parallel path had no TUI but also suppressed console logging.
- **Test with real tracker plugins**: Unit tests used mocks and couldn't detect that `tracker.sync()` would fail in worktree directories. Integration testing with `beads-rust` exposed this immediately.

## Key Pattern: Worker Mode

The `WorkerModeOptions` pattern is reusable anywhere the `ExecutionEngine` needs to run in a constrained context:

```text
Normal Mode:   Engine → creates tracker → selects tasks → runs loop
Worker Mode:   Engine → receives tracker → receives task → runs single task
```

This keeps the engine's public API backward-compatible (the parameter is optional) while enabling parallel orchestration.
