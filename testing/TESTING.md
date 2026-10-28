# Ralph-TUI Manual Testing Guide

This guide describes a **repeatable, idempotent** method for manually testing Ralph-TUI's end-to-end workflow, including the parallel task execution feature.

## Quick Start

```bash
# One-time setup (creates workspace in ~/.cache/ralph-tui/test-workspace)
./testing/setup-test-workspace.sh

# Run the test (uses PRD copy in workspace)
bun run dev -- run --prd ~/.cache/ralph-tui/test-workspace/test-prd.json --cwd ~/.cache/ralph-tui/test-workspace

# If something goes wrong, stop and reset
./testing/reset-test.sh

# Run again
bun run dev -- run --prd ~/.cache/ralph-tui/test-workspace/test-prd.json --cwd ~/.cache/ralph-tui/test-workspace
```

## Architecture

### Why External Workspace?

The test workspace is created **outside** the ralph-tui repository to avoid:
- Nested git repository issues
- Accidental commits of test state
- Conflicts with ralph-tui's own git history

**Default location**: `~/.cache/ralph-tui/test-workspace`

You can override this by passing a path to setup:
```bash
./testing/setup-test-workspace.sh /custom/path/to/workspace
```

### How the PRD Works

The source PRD (`testing/test-prd.json`) is a **template** that never gets modified:
- Setup script copies it to the workspace
- Ralph-TUI modifies the workspace copy during runs
- Reset script re-copies from source to restore clean state

This prevents accidental commits of test state to the ralph-tui repo.

### What Gets Shared with Contributors

| File | Location | Shared? |
|------|----------|---------|
| `test-prd.json` | `testing/` | Yes (template, committed) |
| `setup-test-workspace.sh` | `testing/` | Yes (committed) |
| `reset-test.sh` | `testing/` | Yes (committed) |
| `TESTING.md` | `testing/` | Yes (committed) |
| `.test-workspace-path` | `testing/` | No (gitignored) |
| Test workspace | `~/.cache/...` | No (external) |

Contributors clone the repo and run `./testing/setup-test-workspace.sh` to create their own isolated test environment.

## Test PRD Design

The test PRD (`test-prd.json`) creates a **dependency graph** that exercises:

```
TEST-001 (P1) ─────┐
                   ├──▶ TEST-004 (P2) ─────┐
TEST-002 (P1) ─────┘                       │
                                           ├──▶ TEST-005 (P3)
TEST-003 (P2) ────────────────────────────┘
```

| Task | Priority | Dependencies | Purpose |
|------|----------|--------------|---------|
| TEST-001 | P1 (high) | None | Independent task, can run in parallel |
| TEST-002 | P1 (high) | None | Independent task, can run in parallel |
| TEST-003 | P2 (medium) | None | Independent task, can run in parallel |
| TEST-004 | P2 (medium) | TEST-001, TEST-002 | Tests dependency resolution |
| TEST-005 | P3 (low) | TEST-003, TEST-004 | Final aggregation task |

### State That Gets Reset

| State Type | Location | Reset Method |
|------------|----------|--------------|
| Task completion | `<workspace>/test-prd.json` | Re-copied from source |
| Session state | `<workspace>/.ralph-tui/session.json` | Deleted |
| Session lock | `<workspace>/.ralph-tui/lock.json` | Deleted |
| Progress context | `<workspace>/.ralph-tui/progress.md` | Deleted |
| Iteration logs | `<workspace>/.ralph-tui/iterations/` | Directory cleared |
| Generated files | `output-*.txt`, `merged-*.txt`, `summary.txt` | Deleted |
| Git state | `<workspace>/.git/` | Optional: `git reset --hard test-start` |

## Detailed Workflow

### 1. Initial Setup (One Time per Machine)

```bash
./testing/setup-test-workspace.sh
```

This creates:
- `~/.cache/ralph-tui/test-workspace/` - Isolated git repo for testing
- `test-prd.json` - Copy of the test PRD (modified during runs)
- Initial commit with README and .gitignore
- Git tag `test-start` for easy hard reset
- `.test-workspace-path` file (gitignored) to remember location

### 2. Running a Test

```bash
bun run dev -- run --prd ~/.cache/ralph-tui/test-workspace/test-prd.json --cwd ~/.cache/ralph-tui/test-workspace
```

The `--prd` flag points to the workspace copy (gets modified during runs).
The `--cwd` flag tells ralph-tui to execute in the test workspace, where:
- The agent will create output files
- Session state (`.ralph-tui/`) will be stored
- Git operations will occur

### 3. Observing the Workflow

Watch for these stages:

1. **Task Selection**: Ralph should select TEST-001 or TEST-002 first (both P1, no deps)
2. **Prompt Building**: Check the prompt includes task details and acceptance criteria
3. **Agent Execution**: Watch the agent create the output files
4. **Completion Detection**: Agent should emit `<promise>COMPLETE</promise>`
5. **Task Update**: PRD file should update `passes: true`
6. **Next Task**: Cycle repeats with dependency awareness

### 4. Testing Specific Scenarios

#### Parallel Task Execution
When parallel execution is implemented, TEST-001, TEST-002, and TEST-003 should be eligible to run simultaneously since they have no dependencies on each other.

To verify:
- Check that multiple tasks are selected in the same iteration
- Verify agents are spawned concurrently
- Confirm all three complete before TEST-004 starts

#### Dependency Resolution
TEST-004 should **not** be selected until both TEST-001 and TEST-002 are complete:
- If you see TEST-004 start while TEST-001 or TEST-002 are incomplete → **Bug!**

#### Error Recovery
To test error handling:
1. Start a test run
2. Kill the agent mid-execution (Ctrl+C on the agent process)
3. Run `ralph-tui resume`
4. Verify the task that was interrupted is retried

### 5. Resetting for Re-test

**Soft Reset** (keeps git history, re-copies PRD):
```bash
./testing/reset-test.sh
```

**Hard Reset** (full clean slate):
```bash
cd ~/.cache/ralph-tui/test-workspace && git reset --hard test-start && git clean -fd
./testing/reset-test.sh
```

## Files Reference

| File | Purpose |
|------|---------|
| `testing/test-prd.json` | Source PRD template (never modified) |
| `testing/setup-test-workspace.sh` | Creates workspace, copies PRD |
| `testing/reset-test.sh` | Re-copies PRD, cleans state |
| `testing/TESTING.md` | This documentation |
| `testing/.test-workspace-path` | Saved workspace location (gitignored) |
| `<workspace>/test-prd.json` | Working copy (modified during runs) |
| `<workspace>/` | The actual test git repo |

## Troubleshooting

### Test won't start
```bash
# Check for stale lock
cat ~/.cache/ralph-tui/test-workspace/.ralph-tui/lock.json

# Remove if stale
rm ~/.cache/ralph-tui/test-workspace/.ralph-tui/lock.json
```

### Task status won't reset
```bash
# Manually verify workspace PRD
cat ~/.cache/ralph-tui/test-workspace/test-prd.json | jq '.userStories[].passes'

# Re-copy from source
cp testing/test-prd.json ~/.cache/ralph-tui/test-workspace/test-prd.json
```

### Agent keeps failing
Check the iteration logs:
```bash
ls -la ~/.cache/ralph-tui/test-workspace/.ralph-tui/iterations/
cat ~/.cache/ralph-tui/test-workspace/.ralph-tui/iterations/*.log | tail -100
```

### Git state is corrupted
```bash
cd ~/.cache/ralph-tui/test-workspace
git status
git reset --hard test-start
git clean -fd
```

### Workspace not found
```bash
# Re-run setup
./testing/setup-test-workspace.sh

# Or check saved path
cat testing/.test-workspace-path
```

## CI/Automated Testing

For automated testing in CI, you can run:

```bash
# Setup
./testing/setup-test-workspace.sh

# Run headless with max iterations
bun run dev -- run --prd ~/.cache/ralph-tui/test-workspace/test-prd.json --cwd ~/.cache/ralph-tui/test-workspace --headless --iterations 10

# Verify completion
jq '.userStories | all(.passes)' ~/.cache/ralph-tui/test-workspace/test-prd.json
# Should output: true

# Verify output files exist
test -f ~/.cache/ralph-tui/test-workspace/summary.txt && echo "PASS" || echo "FAIL"
```

## Testing AI Conflict Resolution

The `test-conflict-prd.json` is specifically designed to trigger merge conflicts during parallel execution, allowing you to test the AI conflict resolution feature.

### How It Works

The conflict PRD has three parallel tasks (CONFLICT-001, 002, 003) that all modify the **same file** (`FEATURES.md`). When running in parallel:

1. Each worktree starts from the same base (no `FEATURES.md`)
2. Each agent creates `FEATURES.md` with different content
3. When merging back, Git detects conflicting changes
4. The AI resolver is invoked to intelligently merge the content

### Running the Conflict Test

```bash
# Setup (if not already done)
./testing/setup-test-workspace.sh

# Copy the conflict PRD to workspace
cp testing/test-conflict-prd.json ~/.cache/ralph-tui/test-workspace/test-conflict-prd.json

# Run with parallel execution (use --parallel to force parallel mode)
bun run dev -- run --prd ~/.cache/ralph-tui/test-workspace/test-conflict-prd.json \
  --cwd ~/.cache/ralph-tui/test-workspace \
  --parallel 3

# Reset and try again
./testing/reset-test.sh
cp testing/test-conflict-prd.json ~/.cache/ralph-tui/test-workspace/test-conflict-prd.json
```

### Expected Behavior

```
CONFLICT-001 ─────┐
                  │
CONFLICT-002 ─────┼──▶ [MERGE CONFLICTS] ──▶ AI Resolution ──▶ CONFLICT-004
                  │
CONFLICT-003 ─────┘
```

1. **Parallel Execution**: All three CONFLICT-00x tasks run simultaneously
2. **Conflict Detection**: When merging worktrees, Git reports conflicts in `FEATURES.md`
3. **AI Resolution**: The conflict resolver spawns the session agent to intelligently merge
4. **Final Task**: CONFLICT-004 reads the merged `FEATURES.md` and creates a summary

### Verifying AI Resolution

After a successful run:

```bash
# Check that all features are present in the merged file
cat ~/.cache/ralph-tui/test-workspace/FEATURES.md

# Should contain sections for Feature A, B, and C
grep -E "## Feature [ABC]" ~/.cache/ralph-tui/test-workspace/FEATURES.md

# Verify the summary was created
cat ~/.cache/ralph-tui/test-workspace/SUMMARY.md
```

### Debugging Conflict Resolution

If conflicts aren't being resolved:

```bash
# Check iteration logs for conflict events
grep -r "conflict" ~/.cache/ralph-tui/test-workspace/.ralph-tui/iterations/

# Look for AI resolver output
grep -r "AI resolver" ~/.cache/ralph-tui/test-workspace/.ralph-tui/iterations/

# Check if fast-path was triggered (trivial conflicts)
grep -r "fast-path" ~/.cache/ralph-tui/test-workspace/.ralph-tui/iterations/
```

### Disabling AI Resolution

To test fallback behavior when AI resolution is disabled:

```bash
# Create a config that disables AI resolution
cat > ~/.cache/ralph-tui/test-workspace/.ralph-tui/config.toml << 'EOF'
[conflictResolution]
enabled = false
EOF

# Run the test - conflicts should cause task failure or manual intervention
bun run dev -- run --prd ~/.cache/ralph-tui/test-workspace/test-conflict-prd.json \
  --cwd ~/.cache/ralph-tui/test-workspace \
  --parallel 3
```

## Contributing

When adding new test scenarios:

1. Add new user stories to `testing/test-prd.json` (the source template)
2. Update this documentation
3. Consider adding automated verification to `reset-test.sh`
4. Ensure new scenarios maintain idempotency
