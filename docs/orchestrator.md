# Orchestrator

Multi-agent parallel task execution for ralph-tui. The orchestrator analyzes PRD dependencies, groups independent stories, and runs multiple workers in parallel.

## Quick Start

```bash
# Run parallel execution on a PRD
ralph-tui orchestrate --prd ./prd.json

# Limit to 2 workers
ralph-tui orchestrate --prd ./prd.json --max-workers 2

# Run without TUI (CI/scripts)
ralph-tui orchestrate --prd ./prd.json --headless

# Run on a remote instance
ralph-tui orchestrate --prd ./prd.json --remote my-server
```

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                     Orchestrator Pipeline                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐    ┌───────────┐    ┌───────────┐    ┌─────────┐  │
│  │ Analyzer │───▶│ Scheduler │───▶│  Workers  │───▶│  Done   │  │
│  └──────────┘    └───────────┘    └───────────┘    └─────────┘  │
│       │               │                 │                        │
│       ▼               ▼                 ▼                        │
│   Dependency      Execution        Parallel                      │
│     Graph          Phases         Execution                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

1. **Analyzer** - Scans PRD for dependencies (explicit `dependsOn` + implicit file conflicts)
2. **Scheduler** - Creates execution phases respecting dependencies
3. **Workers** - Spawns ralph-tui processes with `--task-range` for parallel execution

## CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `--prd <path>` | PRD file path (JSON or Markdown) | Required |
| `--max-workers <n>` | Maximum parallel workers | 4 |
| `--headless` | Run without TUI, output structured logs | false |
| `--cwd <path>` | Working directory | current |
| `--remote <alias>` | Run on a remote instance | - |

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All tasks completed successfully |
| 1 | Some tasks failed or interrupted |

## PRD Format for Parallelism

The orchestrator analyzes your PRD to determine which stories can run in parallel.

### Explicit Dependencies

Use `dependsOn` to declare that one story must complete before another:

```json
{
  "userStories": [
    {
      "id": "US-001",
      "title": "Create user model",
      "acceptanceCriteria": ["..."]
    },
    {
      "id": "US-002",
      "title": "Add user authentication",
      "dependsOn": ["US-001"],
      "acceptanceCriteria": ["..."]
    }
  ]
}
```

US-002 will wait for US-001 to complete.

### Implicit Dependencies

The analyzer detects implicit dependencies by scanning for file paths in story text:

```json
{
  "id": "US-003",
  "title": "Update src/auth/login.ts handler",
  "description": "Modify the login endpoint in src/auth/login.ts"
}
```

Stories mentioning the same file are placed in separate phases to avoid conflicts.

### Parallelism Hints

The analyzer classifies stories to adjust parallelism:

| Story Type | Keywords | Parallelism |
|------------|----------|-------------|
| Test | test, spec, testing | High (0.7-0.9) |
| Docs | docs, readme, document | High (0.7-0.9) |
| Refactor | refactor, rename, move | Low (0.1-0.4) |
| Unknown | (no pattern) | Medium (0.3) |

Refactor stories get fewer parallel workers since they often touch many files.

### Best Practices

**Maximize parallelism:**
- Keep stories focused on single files/modules
- Declare explicit `dependsOn` only when truly required
- Split large features into independent stories

**Minimize conflicts:**
- Avoid stories that modify "core" files many depend on
- Put infrastructure changes (config, types) in early stories
- Group related file changes into single stories

## Example Workflows

### Basic Parallel Execution

```bash
# Analyze dependencies and run with default 4 workers
ralph-tui orchestrate --prd ./tasks/feature.json
```

Output:
```
═══════════════════════════════════════════════════════════════
                    Ralph TUI Orchestrator
═══════════════════════════════════════════════════════════════

  PRD:           ./tasks/feature.json
  Max Workers:   4
  Working Dir:   /home/user/project

▶ Phase 1/3: Phase 1
  ↳ Worker worker-1: US-001 → US-002
  ↳ Worker worker-2: US-003 → US-004
  ✓ Worker worker-1 done
  ✓ Worker worker-2 done
✓ Phase 1 completed

▶ Phase 2/3: Phase 2
  ↳ Worker worker-3: US-005 → US-005
  ✓ Worker worker-3 done
✓ Phase 2 completed

▶ Phase 3/3: Phase 3
  ↳ Worker worker-4: US-006 → US-006
  ✓ Worker worker-4 done
✓ Phase 3 completed

───────────────────────────────────────────────────────────────
  Orchestration complete
  Phases: 3
  Completed: 4
  Failed: 0
───────────────────────────────────────────────────────────────
```

### CI/CD Integration

```bash
# Headless mode with structured JSON logs
ralph-tui orchestrate --prd ./prd.json --headless --max-workers 2

# Check exit code
if [ $? -eq 0 ]; then
  echo "All tasks completed"
else
  echo "Some tasks failed"
fi
```

### Remote Orchestration

Run orchestration on a remote ralph-tui instance:

```bash
# First, start remote instance with listener
# (on remote server)
ralph-tui run --listen --prd ./prd.json

# Then orchestrate from local machine
ralph-tui orchestrate --prd ./prd.json --remote my-server --max-workers 3
```

### Large PRD with Conservative Workers

For PRDs with many interdependent stories:

```bash
# Use fewer workers to reduce conflicts
ralph-tui orchestrate --prd ./large-refactor.json --max-workers 2
```

## Remote Protocol

When using `--remote`, the orchestrator communicates via WebSocket:

### Commands

| Command | Description |
|---------|-------------|
| `orchestrate:start` | Start orchestration with config |
| `orchestrate:status` | Query current status |
| `orchestrate:pause` | Pause execution |
| `orchestrate:resume` | Resume execution |

### Events

| Event | Description |
|-------|-------------|
| `worker:started` | Worker process spawned |
| `worker:progress` | Task progress update |
| `worker:completed` | Worker finished successfully |
| `worker:failed` | Worker encountered error |
| `phase:started` | Execution phase began |
| `phase:completed` | Execution phase finished |
| `orchestration:completed` | All phases complete |

### Status Response

```json
{
  "type": "orchestrate:status_response",
  "status": "running",
  "currentPhase": "Phase 2",
  "currentPhaseIndex": 1,
  "totalPhases": 3,
  "workers": [
    { "id": "worker-1", "status": "completed", "progress": 100 },
    { "id": "worker-2", "status": "running", "progress": 50 }
  ],
  "completedTasks": 4,
  "totalTasks": 8
}
```

## Architecture

### Components

| Module | File | Purpose |
|--------|------|---------|
| Types | `src/orchestrator/types.ts` | Type definitions |
| Analyzer | `src/orchestrator/analyzer.ts` | Dependency detection |
| Heuristics | `src/orchestrator/heuristics.ts` | Parallelism hints |
| Scheduler | `src/orchestrator/scheduler.ts` | Phase planning |
| WorkerManager | `src/orchestrator/worker-manager.ts` | Process spawning |
| Orchestrator | `src/orchestrator/index.ts` | Main coordinator |

### Execution Flow

1. Load PRD (JSON or Markdown)
2. Build dependency graph from `dependsOn` + file mentions
3. Apply parallelism heuristics (test/docs/refactor detection)
4. Create execution phases (topological sort)
5. For each phase:
   - Git sync (`git pull --rebase`)
   - Spawn workers with `--task-range`
   - Wait for completion (parallel or sequential)
6. Report results

### Worker Communication

Workers are spawned as separate `ralph-tui run` processes:

```bash
ralph-tui run --task-range US-001:US-003 --headless
```

The orchestrator monitors stdout for progress:
- `progress: 50` - Progress percentage
- `task: US-002` - Current task ID

## Troubleshooting

### Workers fail with git conflicts

Workers sync via `git pull --rebase` before starting. If conflicts occur:
1. Reduce `--max-workers` to serialize execution
2. Check for stories modifying the same files
3. Add explicit `dependsOn` between conflicting stories

### Phases not parallelizing

The analyzer may detect implicit dependencies. Check:
1. File mentions in story descriptions
2. Refactor keywords reducing parallelism
3. Add explicit `dependsOn` to control ordering

### Remote connection issues

```bash
# Test remote connectivity
ralph-tui remote test my-server

# Check remote is listening
ralph-tui remote list
```
