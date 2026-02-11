# Product Requirements Document: Parallel Execution & AI Conflict Resolution

**Date:** 2026-02-10
**Status:** Implemented
**Authors:** Ralph TUI Team
**Related Documents:**
- `docs/plans/2026-02-04-ai-conflict-resolution-design.md`
- `website/content/docs/parallel/overview.mdx`

## 1. Executive Summary

This release introduces a major architectural upgrade to Ralph TUI: the ability to execute independent tasks in parallel using git worktrees. This significantly reduces total project execution time by running non-blocking tasks simultaneously. To support this, we have implemented an AI-powered conflict resolution system to handle merge conflicts automatically, and updated the TUI to visualize parallel worker states.

## 2. Problem Statement

Previously, Ralph TUI executed tasks strictly sequentially. In large projects with many independent tasks (e.g., "fix typo in README", "update dependency X", "refactor component Y"), this sequential processing was inefficient. Agents would sit idle while waiting for unrelated tasks to complete. Furthermore, manual intervention was required whenever a merge conflict occurred, halting the entire workflow.

## 3. Goals & Objectives

1.  **Efficiency:** Reduce total execution time for suitable task sets by 40-60%.
2.  **Isolation:** Ensure tasks running in parallel do not interfere with each other's filesystem or git state.
3.  **Automation:** Automatically resolve git merge conflicts using AI, minimizing user intervention.
4.  **Usability:** Provide clear visibility into parallel worker status and merge operations via the TUI.
5.  **Reliability:** Ensure robust error handling, rollback capabilities, and session resumption for parallel workflows.

## 4. Technical Architecture

### 4.1 Parallel Executor
-   **Wrapper Pattern:** The `ParallelExecutor` wraps multiple instances of the existing `ExecutionEngine`. The core engine logic remains unchanged; it is simply instantiated multiple times with different working directories.
-   **Task Graph:** A dependency graph is built from task metadata (`dependsOn`, `blocks`). Tasks are topologically sorted and grouped by dependency depth.
-   **Heuristics:** Parallel mode is automatically enabled if:
    -   At least one group has 2+ independent tasks.
    -   Total task count ≥ 3.
    -   Cyclic dependencies < 50%.

### 4.2 Git Worktree Isolation
-   **Mechanism:** Uses `git worktree` to create lightweight, isolated working copies for each worker.
-   **Location:** Worktrees are stored in `.ralph-tui/worktrees/worker-{N}/`.
-   **Branching:** Each worker operates on a dedicated branch `ralph-parallel/{taskId}` derived from the current `HEAD`.

### 4.3 Merge Engine & Conflict Resolution
-   **Sequential Merge:** Workers merge back to the main branch one at a time to maintain a linear history and simplify conflict handling.
-   **Backup Tags:** A git tag is created before every merge to allow for safe rollbacks if a merge fails.
-   **AI Resolution:**
    -   **Fast-path:** Automatically resolves trivial conflicts (e.g., one side empty, identical changes).
    -   **AI Agent:** Spawns an LLM agent to resolve complex semantic conflicts. The agent is provided with "Base", "Ours", and "Theirs" content and instructed to produce a merged version.

## 5. User Interface (TUI)

### 5.1 Parallel Progress View
-   **Worker Grid:** Displays a dynamic grid showing the status of each active worker.
-   **State Indicators:**
    -   `IDLE`: Waiting for a task.
    -   `BUSY`: Executing a task (shows current step/tool).
    -   `MERGING`: Merging changes back to main.
    -   `FAILED`: Task execution failed.
-   **Task Detail:** Sidebar or detailed view showing the logs for the currently selected worker.

### 5.2 Conflict Resolution Panel
-   **Visual Diff:** Shows the conflicting files.
-   **Status:** Displays "AI Resolving..." or prompts for user intervention if AI fails/is disabled.
-   **Manual Override:** (Future scope) Allow users to manually select "Ours", "Theirs", or "Edit".

## 6. Configuration

New configuration options in `ralph.json`:

```json
{
  "parallel": {
    "mode": "auto",            // "auto" | "always" | "never"
    "maxWorkers": 3,           // Max concurrent worktrees
    "conflictResolution": {
      "enabled": true,         // Enable AI resolution
      "timeoutMs": 120000      // Timeout for AI resolution
    }
  }
}
```

## 7. Migration & Compatibility
-   **Backwards Compatible:** The system falls back to sequential execution if parallel conditions are not met or if explicitly disabled (`--serial`).
-   **Session Resume:** The `SessionManager` has been updated to persist parallel state, allowing interrupted sessions to resume from where they left off, cleaning up orphaned worktrees on restart.

## 8. Release Strategy
-   **Phase 1 (Alpha):** Internal testing with synthetic conflict scenarios.
-   **Phase 2 (Beta):** Release to `dev` branch, enabled via flag.
-   **Phase 3 (GA):** Enabled by default with auto-detection heuristics.

## 9. Success Metrics
-   **Throughput:** Average tasks completed per minute.
-   **Conflict Resolution Rate:** % of conflicts resolved successfully by AI without rollback.
-   **Stability:** Rate of worktree cleanup failures or git lock contentions (target < 1%).
