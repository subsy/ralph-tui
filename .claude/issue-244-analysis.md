# Issue #244 Analysis: Start does not work after refreshing

## Problem Summary
Newly created issues cannot be started in ralph-tui after refreshing when those issues were created in a separate terminal session, and the engine had previously completed all tasks.

## Root Cause
The 's' key handler in `src/tui/components/RunApp.tsx` (lines 1418-1450) only handles these TUI statuses:
- `'ready'` - calls `onStart()` for first-time engine start
- `'stopped'` or `'idle'` - calls `engine.continueExecution()` to resume

**The handler does NOT process the `'complete'` status.**

## Reproduction Flow
1. User loads an epic and presses 's' to start execution
2. Engine runs and completes all existing tasks (or finds no tasks if epic is empty)
3. Engine stops with reason `'completed'` (from `isComplete()` returning true)
4. TUI status is set to `'complete'` (line 952)
5. User creates a new task externally: `br create "New task" --parent <epic-id>`
6. User presses 'r' to refresh - task list updates and shows the new task
7. User presses 's' to start working on the new task
8. **Nothing happens** - the 's' handler ignores 'complete' status

## Key Code Locations

| File | Lines | Description |
|------|-------|-------------|
| `src/tui/components/RunApp.tsx` | 1418-1450 | 's' key handler - missing 'complete' status handling |
| `src/tui/components/RunApp.tsx` | 944-956 | 'engine:stopped' event sets status to 'complete' |
| `src/tui/components/RunApp.tsx` | 1119-1122 | 'tasks:refreshed' only updates tasks, not status |
| `src/engine/index.ts` | 470-487 | `isComplete()` check triggers 'completed' stop reason |

## Proposed Fix

### Option A: Extend 's' key handler
Add `'complete'` to the status check in the 's' key handler:

```typescript
// Line 1431 in RunApp.tsx - change:
} else if (status === 'stopped' || status === 'idle') {

// To:
} else if (status === 'stopped' || status === 'idle' || status === 'complete') {
```

### Option B: Reset status on refresh with new actionable tasks
In the 'tasks:refreshed' event handler, check if there are new actionable tasks and reset status from 'complete' to 'idle':

```typescript
case 'tasks:refreshed':
  const newTasks = convertTasksWithDependencyStatus(event.tasks);
  setTasks(newTasks);
  // If we were complete but now have actionable tasks, transition to idle
  if (status === 'complete' && newTasks.some(t => t.status === 'actionable')) {
    setStatus('idle');
  }
  break;
```

### Recommended
Option A is simpler and maintains the "s = keep going" mental model mentioned in the code comment. Option B is more automatic but adds complexity.

## Workaround
Quitting and restarting ralph-tui resolves the issue by resetting all state.
