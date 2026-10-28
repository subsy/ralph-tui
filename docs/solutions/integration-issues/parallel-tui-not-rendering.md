---
title: "Parallel TUI Not Rendering — Missing Event-to-React Bridge"
category: integration-issues
component: parallel-execution-tui
symptoms:
  - "TUI never opens when parallel mode activates"
  - "Only console log output visible during parallel execution"
  - "ParallelProgressView, WorkerDetailView, MergeProgressView, ConflictResolutionPanel components exist but never render"
  - "Application runs silently in TUI mode despite showTui being true"
root_cause: "The parallel execution path in run.tsx called parallelExecutor.execute() directly with only console logging — no Ink renderer was created and RunApp was never mounted. Additionally, RunApp required engine: ExecutionEngine as a mandatory prop, which doesn't exist in parallel mode (there's no single engine, only a ParallelExecutor managing multiple worker engines)."
severity: high
date_resolved: 2026-01-27
tags: [parallel, tui, react, ink, event-bridge, adapter-pattern, execution-engine, integration]
related_files:
  - src/commands/run.tsx
  - src/tui/components/RunApp.tsx
  - src/parallel/index.ts
  - src/parallel/events.ts
  - src/parallel/types.ts
related_docs:
  - docs/solutions/runtime-errors/parallel-execution-hang-tracker-init.md
---

# Parallel TUI Not Rendering — Missing Event-to-React Bridge

## Problem

When parallel execution activated (via `--parallel` or auto-detection), the TUI never opened. Users saw only console log output:

```text
Parallel execution enabled: 2 group(s), max parallelism 3
[12:34:56] [INFO] [parallel] Parallel execution started: 5 tasks, 2 groups, 3 workers
[12:34:57] [INFO] [worker] Worker w0-0 started: Validate full workflow
...
```

All four parallel TUI components existed and were imported in RunApp:
- `ParallelProgressView` — worker overview panel
- `WorkerDetailView` — single worker output drill-down
- `MergeProgressView` — merge queue monitoring
- `ConflictResolutionPanel` — conflict resolution overlay

RunApp had all 12 parallel props defined in its interface, with defaults. The keyboard shortcuts (`w`, `m`, `Enter`, `1-9`) for parallel views were implemented. But nothing ever rendered.

## Investigation

### Execution Path Analysis

`run.tsx` had three execution paths:

```typescript
if (useParallel) {
  // Path 1: Parallel — NO TUI, bare console logging
  await parallelExecutor.execute();
} else if (config.showTui) {
  // Path 2: Sequential TUI — creates Ink renderer, mounts RunApp
  persistedState = await runWithTui(engine, ...);
} else {
  // Path 3: Sequential headless — structured console logging
  persistedState = await runHeadless(engine, ...);
}
```

The parallel path never called any TUI rendering function — it just awaited `execute()` with event listeners that logged to console.

### The Engine Dependency

Even if someone had tried to call `runWithTui()` for parallel mode, it would have failed:

```typescript
// runWithTui requires an ExecutionEngine
async function runWithTui(engine: ExecutionEngine, ...) { ... }

// RunApp requires engine as a mandatory prop
export interface RunAppProps {
  engine: ExecutionEngine;  // REQUIRED — breaks parallel mode
  // ...
}
```

In parallel mode, there's no single `ExecutionEngine`. The `ParallelExecutor` manages multiple `Worker` instances, each wrapping its own engine. RunApp's hard dependency on a single engine made it structurally incompatible with parallel rendering.

## Root Cause

**Two architectural gaps compounded:**

1. **Missing rendering function**: No `runParallelWithTui()` existed to create the Ink renderer, subscribe to ParallelExecutor events, translate them to React state, and mount RunApp with parallel props.

2. **Tight engine coupling**: RunApp required `engine: ExecutionEngine` as a mandatory prop, making it impossible to render without one. Engine was used for ~15 different operations: event subscription, state queries, pause/resume, iteration control, subagent tracing, task refresh, and prompt preview.

This was a "last mile" integration gap — all components were built in isolation across multiple phases, but nobody wired them together in the execution path.

## Solution

### 1. Made Engine Optional in RunApp (`src/tui/components/RunApp.tsx`)

Changed the engine prop from required to optional:

```typescript
export interface RunAppProps {
  /** The execution engine instance (optional in parallel mode) */
  engine?: ExecutionEngine;
  // ...
}
```

Guarded all ~15 engine call sites. Three patterns emerged:

```typescript
// Pattern 1: Early return guard (for useEffect subscriptions)
useEffect(() => {
  if (!engine) return;
  const unsubscribe = engine.on((event: EngineEvent) => { ... });
  return unsubscribe;
}, [engine]);

// Pattern 2: Conditional execution (for keyboard handlers)
} else if (engine) {
  // Local engine control (engine absent in parallel mode)
  engine.pause();
}

// Pattern 3: Optional chaining (for data accessors)
const subagentOutput = engine?.getSubagentOutput(selectedSubagentId);
```

In parallel mode, engine-dependent features (pause/resume, iteration control, subagent tracing) are naturally disabled since engine is `undefined`.

### 2. Created `runParallelWithTui()` (`src/commands/run.tsx`)

New function following the same pattern as `runWithTui()`:

```typescript
async function runParallelWithTui(
  parallelExecutor: ParallelExecutor,
  persistedState: PersistedSessionState,
  config: RalphConfig,
  initialTasks: TrackerTask[],
  storedConfig?: StoredConfig,
): Promise<PersistedSessionState> {
  // Mutable state updated by event handlers, read by React renders
  let workers: WorkerDisplayState[] = [];
  const workerOutputs = new Map<string, string[]>();
  let mergeQueue: MergeOperation[] = [];
  // ... more parallel state

  // Re-render trigger — forces React to pick up updated mutable state
  let triggerRerender: (() => void) | null = null;

  // Subscribe to ParallelExecutor events → translate to TUI state
  parallelExecutor.on((event: ParallelEvent) => {
    switch (event.type) {
      case 'worker:started':
      case 'worker:progress':
        workers = parallelExecutor.getWorkerStates();
        break;
      case 'worker:output':
        // Buffer output per-worker (keep last 500 lines)
        // ...
        break;
      case 'merge:completed':
        mergeQueue = [...parallelExecutor.getState().mergeQueue];
        break;
      // ... conflict events, completion events
    }
    triggerRerender?.();
  });

  // Inner React component that re-renders on parallel events
  function ParallelRunAppWrapper() {
    const [, setTick] = useState(0);
    useEffect(() => {
      triggerRerender = () => setTick((t) => t + 1);
      return () => { triggerRerender = null; };
    }, []);

    return (
      <RunAppWrapper
        isParallelMode={true}
        parallelWorkers={workers}
        parallelWorkerOutputs={workerOutputs}
        parallelMergeQueue={mergeQueue}
        // ... all 12 parallel props
      />
    );
  }

  root.render(<ParallelRunAppWrapper />);

  // Non-blocking: start execution while TUI renders
  parallelExecutor.execute()
    .then(() => triggerRerender?.())
    .catch(() => triggerRerender?.());

  // Block until user quits
  await new Promise<void>((resolve) => {
    resolveQuitPromise = resolve;
  });
}
```

**Key design choice**: Parallel execution starts non-blocking (`fire-and-forget` with `.then()/.catch()`) so the TUI renders immediately. The TUI stays open after execution finishes for user review.

### 3. Wired Execution Path (`src/commands/run.tsx`)

```typescript
if (useParallel) {
  const parallelExecutor = new ParallelExecutor(config, tracker, { maxWorkers });

  if (config.showTui) {
    // NEW: Parallel TUI mode
    persistedState = await runParallelWithTui(
      parallelExecutor, persistedState, config, tasks, storedConfig
    );
  } else {
    // Parallel headless mode (existing console logging)
    parallelExecutor.on((event) => { /* console.log */ });
    await parallelExecutor.execute();
  }
} else if (config.showTui) {
  // Sequential TUI mode (unchanged)
  persistedState = await runWithTui(engine, ...);
}
```

### 4. Extended RunAppWrapper Props

Added all 12 parallel props to `RunAppWrapperProps` and passed them through to `RunApp`.

## Key Pattern: Event-to-React Bridge

The `runParallelWithTui()` function establishes a reusable pattern for connecting any event emitter to React rendering:

```text
Event Source (ParallelExecutor)
  │
  ▼
Event Handler (updates mutable variables)
  │
  ▼
Re-render Trigger (setTick(t => t + 1))
  │
  ▼
React Component (reads mutable variables as props)
  │
  ▼
TUI Components (render updated state)
```

This avoids the complexity of lifting all state into React — the mutable variables act as a lightweight bridge between the imperative event world and the declarative React world.

## Prevention

- **Integration phase in feature plans**: When building multi-phase features, include an explicit "integration wiring" phase that connects all pieces. Build the execution path routing FIRST, even if it's a stub, so the gap is visible.

- **End-to-end smoke tests**: Write a test that verifies the full path from CLI flag → rendering function → component mount. Even a basic test like "parallel mode with showTui calls runParallelWithTui" catches this class of bug.

- **Props as integration contracts**: When adding optional props to a component (like RunApp's parallel props), also add the code that populates those props. Unused props with defaults are invisible — they compile fine but do nothing.

- **Make hard dependencies optional when adding new modes**: When a component gains a new operating mode (parallel), audit all required props. If the new mode doesn't have that dependency (engine), make it optional rather than creating stubs or adapters.

## Related

- [Parallel Execution Hang — Tracker Initialization in Git Worktrees](../runtime-errors/parallel-execution-hang-tracker-init.md): Companion fix for tracker re-initialization that caused actual hangs in worktree directories.
