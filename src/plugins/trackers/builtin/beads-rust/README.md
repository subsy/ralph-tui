# Beads-Rust Tracker Plugin

A tracker plugin for ralph-tui that integrates with **beads-rust** (`br` CLI) - the Rust rewrite of the beads issue tracker.

## Overview

This plugin enables ralph-tui to use beads-rust as its task source. It provides:

- **Task discovery** via `br list` and `br ready`
- **Dependency-aware task selection** - respects `blocks`/`depends-on` relationships
- **Epic support** - work on child tasks within a specific epic
- **PRD context injection** - includes PRD content when epic has `prd:` external reference
- **Automatic task completion** via `br close`
- **Git-native sync** via `br sync`

## Prerequisites

1. **beads-rust CLI (`br`)** - Install from [beads-rust releases](https://github.com/Dicklesworthstone/beads_rust)
2. **Initialized beads directory** - Run `br init` in your project root

## Detection

The plugin auto-detects when:
1. A `.beads/` directory exists in the project
2. The `br` executable is available in PATH

## Usage

### Basic Usage

```bash
# Let ralph-tui select the best available task
ralph-tui run --tracker beads-rust

# Work on tasks within a specific epic
ralph-tui run --tracker beads-rust --epic ralph-tui-123

# Run one parallel session across multiple epics
ralph-tui run --tracker beads-rust --parallel --epic ui-epic --epic backend-epic
ralph-tui run --tracker beads-rust --parallel --epics ui-epic,backend-epic
```

### Creating Tasks for ralph-tui

Use the `ralph-tui-create-beads-rust` skill (via Claude Code) to convert PRDs into beads:

```bash
# In Claude Code
/ralph-tui-create-beads-rust
```

Or create tasks manually:

```bash
# Create an epic with PRD reference
br create --type=epic \
  --title="Feature Name" \
  --description="Feature description" \
  --external-ref="prd:./docs/feature-prd.md"

# Create child tasks
br create --parent=<epic-id> \
  --title="US-001: Add database schema" \
  --description="Acceptance criteria here" \
  --priority=1

# Add dependencies (task depends on blocker)
br dep add <task-id> <blocker-id>
```

## Configuration

The plugin can be configured in `ralph-tui.yaml`:

```yaml
tracker:
  plugin: beads-rust
  # Optional: specify epic to work within
  epic: ralph-tui-123
```

Or via CLI flags:

```bash
ralph-tui run --tracker beads-rust --epic ralph-tui-123
```

For multi-epic parallel sessions, use repeated `--epic` flags or comma-separated `--epics`. Ralph keeps one global scheduler and merge queue, annotates tasks with their source epic, and stores the full selected epic set for resume.

## Task Selection

The plugin uses `br ready` to find unblocked tasks:

1. **With `--epic`**: Only tasks that are children of the specified epic
2. **With repeated `--epic` or `--epics`**: Children from all selected epics are combined into one scoped run
3. **Without `--epic`**: Any unblocked task in the project

Tasks are selected based on:
- Dependency status (only unblocked tasks)
- Priority (P0 > P1 > P2 > P3 > P4)
- Parent-child relationships

Cross-epic dependencies are respected when both tasks are in the selected epic set. Dependencies outside the selected set must already be completed or cancelled; otherwise, the dependent task is blocked for that run.

## PRD Context Injection

When an epic has an `external_ref` starting with `prd:`, the plugin:

1. Reads the PRD file from the specified path
2. Injects PRD content into the agent's context
3. Provides progress information (completed vs total tasks)

Example:
```bash
br create --type=epic \
  --title="Authentication Feature" \
  --external-ref="prd:./docs/auth-prd.md"
```

The PRD path is resolved relative to the project root and protected against path traversal attacks.

## Template

The plugin includes a Handlebars template (`template.hbs`) that generates agent instructions for:

- Closing completed tasks
- Syncing changes with git
- Handling task completion signals

## Differences from beads (Go version)

| Feature | beads (`bd`) | beads-rust (`br`) |
|---------|--------------|-------------------|
| CLI command | `bd` | `br` |
| Storage | JSONL only | SQLite + JSONL export |
| Performance | Good | Better (Rust) |
| Daemon mode | Yes | No (direct mode) |
| Plugin | `beads` | `beads-rust` |

## Troubleshooting

### "br command not found"

Ensure beads-rust is installed and in your PATH:
```bash
which br
br --version
```

### "No .beads directory found"

Initialize beads in your project:
```bash
br init
```

### "No tasks available"

Check if tasks exist and are unblocked:
```bash
br list              # List all tasks
br ready             # List unblocked tasks
br dep cycles        # Check for circular dependencies
```

## Related

- [beads-rust CLI documentation](https://github.com/Dicklesworthstone/beads_rust)
- [ralph-tui documentation](../../../README.md)
- [Creating beads from PRDs](../../../../skills/ralph-tui-create-beads-rust/SKILL.md)
