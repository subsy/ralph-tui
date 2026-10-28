# Investigation: Issue #247 - Session Resume Failures

**Issue**: https://github.com/subsy/ralph-tui/issues/247
**Reporter**: KarolCieslar
**Date**: January 31, 2026

## Problem Summary

User reported multiple issues with session resume functionality:
1. Session.json file deleted after quitting with "Q" and confirming save
2. "No session available" when attempting to resume
3. After manual session.json recovery, TUI shows metadata (108/130 tasks, iteration 118/50) but "No task loaded"
4. Workaround: explicitly providing PRD file works (`ralph-tui --prd ./tasks/prd.json`)

## Root Cause Analysis

### Bug 1: Session File Deleted Prematurely (Critical)

**Location**: `src/commands/run.tsx:1975-1976`

```typescript
const allComplete = finalState.tasksCompleted >= finalState.totalTasks ||
    finalState.status === 'idle';
```

**Problem**: The condition `finalState.status === 'idle'` is **always true** when the engine finishes, regardless of why it stopped.

**Why**: The engine's `runLoop()` sets `state.status = 'idle'` in a `finally` block (`src/engine/index.ts:413`). This happens whether the user quit, hit max iterations, encountered errors, OR actually completed all tasks.

**Impact Flow**:
1. User presses 'Q' to quit
2. `gracefulShutdown()` is called → saves session.json ✓
3. `runWithTui()` returns
4. `finalState.status === 'idle'` evaluates to **true** ← BUG
5. `allComplete` becomes true
6. `deletePersistedSession(config.cwd)` is called → session.json deleted!

**Recommended Fix**:

Option 1 - Simple fix:
```typescript
const allComplete = finalState.tasksCompleted >= finalState.totalTasks;
```

Option 2 - Check for specific stop reason:
```typescript
// Would require tracking stop reason in engine state
const allComplete = finalState.tasksCompleted >= finalState.totalTasks ||
    finalState.stopReason === 'no_tasks';
```

### Bug 2: "No task loaded" After Manual Recovery (By Design, But Confusing)

**Root Cause**: Tasks are loaded from the **tracker**, not from session.json.

**Architecture**:
- `session.json` stores metadata (iteration count, progress, timestamps, plugin names)
- Tasks are loaded via `tracker.getTasks()` during `engine.initialize()` (`src/engine/index.ts:241`)

**For Beads Tracker**:
- `getTasks()` runs `bd list --json --parent <epicId>` (`src/plugins/trackers/builtin/beads/index.ts:365-366`)
- If `epicId` from session doesn't exist in beads database → returns empty array → "No tasks loaded"

**For JSON Tracker**:
- `prdPath` stored in session may be relative
- Resolution depends on current working directory
- If file not found at resolved path → no tasks loaded

**Why Workaround Works**: `ralph-tui --prd ./tasks/prd.json` provides explicit path, overriding session state.

## Key Code Locations

| Component | File | Lines | Purpose |
|-----------|------|-------|---------|
| Completion logic (BUG) | `src/commands/run.tsx` | 1975-1983 | Incorrectly deletes session when status='idle' |
| Engine status reset | `src/engine/index.ts` | 413 | Always sets idle in finally block |
| gracefulShutdown | `src/commands/run.tsx` | 1055-1072 | Correctly saves session before exit |
| Task loading | `src/engine/index.ts` | 241 | Loads tasks from tracker, not session |
| Beads task filter | `src/plugins/trackers/builtin/beads/index.ts` | 365-366 | Uses epicId to filter tasks |

## Affected Code Paths

### Session Deletion Points

1. **Successful completion** (`src/commands/run.tsx:1983`) - Intended behavior
2. **Starting fresh** (`src/commands/run.tsx:1705`) - User chooses new session
3. **Resume completion** (`src/commands/resume.tsx:629`) - Intended behavior
4. **Normal quit** (`src/commands/run.tsx:1983`) - **BUG**: Should not delete!

### Engine Status Transitions

```
start() → 'running' → runLoop() executes
   ↓
runLoop() exits (any reason: quit, max iterations, no tasks, error)
   ↓
finally block → 'idle' (ALWAYS)
   ↓
run.tsx checks status === 'idle' → true → deletes session (BUG)
```

## Recommendations

### Immediate Fix (Priority 1)

Change `src/commands/run.tsx:1975-1976`:
```typescript
// Before (buggy):
const allComplete = finalState.tasksCompleted >= finalState.totalTasks ||
    finalState.status === 'idle';

// After (fixed):
const allComplete = finalState.tasksCompleted >= finalState.totalTasks;
```

### Future Improvements

1. **Track stop reason**: Add `stopReason` to engine state to differentiate between:
   - `'completed'` - All tasks done
   - `'interrupted'` - User quit
   - `'max_iterations'` - Hit iteration limit
   - `'no_tasks'` - No more available tasks
   - `'error'` - Fatal error

2. **Better error messaging**: When manual session recovery fails, explain that tasks come from tracker, not session file.

3. **Session validation**: On resume, verify that tracker state is compatible with session metadata.

## Testing Recommendations

1. **Regression test**: Verify session.json persists after normal quit (Q key)
2. **Integration test**: Resume after hitting iteration limit
3. **Integration test**: Resume after API rate limit (user's original scenario)
