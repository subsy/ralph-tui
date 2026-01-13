# Ralph TUI

[![npm version](https://img.shields.io/npm/v/ralph-tui.svg)](https://www.npmjs.com/package/ralph-tui)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-f9f1e1.svg)](https://bun.sh)

**AI Agent Loop Orchestrator** - A terminal UI for orchestrating AI coding agents to work through task lists autonomously.

Ralph TUI connects your AI coding assistant (Claude Code, OpenCode) to your task tracker (prd.json, Beads) and runs them in an autonomous loop, completing tasks one-by-one with intelligent selection, error handling, and full visibility into what's happening.

![Ralph TUI Screenshot](docs/images/ralph-tui.png)

---

## Table of Contents

- [Quick Start](#quick-start)
- [What is Ralph TUI?](#what-is-ralph-tui)
- [Installation](#installation)
- [Getting Started](#getting-started)
- [Creating PRDs and Tasks](#creating-prds-and-tasks)
- [CLI Commands Reference](#cli-commands-reference)
- [TUI Keyboard Shortcuts](#tui-keyboard-shortcuts)
- [Configuration](#configuration)
- [Agent & Tracker Plugins](#agent--tracker-plugins)
- [Best Practices](#best-practices)
- [How It Works](#how-it-works)
- [Parallel Execution Mode](#parallel-execution-mode)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)
- [Credits](#credits)

---

## Quick Start

**The fastest way to get started is with JSON mode** - no external dependencies required!

### 5-Minute Quickstart (JSON Mode)

```bash
# 1. Install
bun install -g ralph-tui

# 2. Setup (creates config, installs skills)
cd your-project
ralph-tui setup

# 3. Create a PRD for your feature
ralph-tui create-prd --chat
# Answer the AI's questions about your feature
# When done, you'll be prompted to create tasks

# 4. Run Ralph!
ralph-tui run --prd ./prd.json
```

That's it! Ralph will work through your tasks autonomously.

### What Just Happened?

1. **Setup** configured Ralph and installed the `ralph-tui-prd` skill for AI-powered PRD creation
2. **Create-prd** had an AI conversation about your feature and created:
   - A PRD markdown file (`./tasks/prd-<feature>.md`)
   - A task file (`./prd.json`) ready for Ralph to execute
3. **Run** started the autonomous loop - Ralph picks tasks, builds prompts, runs your AI agent, and marks tasks complete

### Alternative: With Beads Tracker

If you use [Beads](https://github.com/steveyegge/beads) for issue tracking:

```bash
# Run with an epic
ralph-tui run --epic my-project-epic
```

---

## What is Ralph TUI?

Ralph TUI is an **AI Agent Loop Orchestrator** that automates the cycle of selecting tasks, building prompts, running AI agents, and detecting completion. Instead of manually copying task details into Claude Code or OpenCode, Ralph does it for you in a continuous loop.

**The Autonomous Loop:**

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│   │  1. SELECT   │────▶│  2. BUILD    │────▶│  3. EXECUTE  │   │
│   │    TASK      │     │    PROMPT    │     │    AGENT     │   │
│   └──────────────┘     └──────────────┘     └──────────────┘   │
│          ▲                                         │            │
│          │                                         ▼            │
│   ┌──────────────┐                         ┌──────────────┐    │
│   │  5. NEXT     │◀────────────────────────│  4. DETECT   │    │
│   │    TASK      │                         │  COMPLETION  │    │
│   └──────────────┘                         └──────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key Concepts:**

- **Task Tracker**: Where your tasks live (prd.json user stories, Beads issues)
- **Agent Plugin**: The AI CLI that does the work (Claude Code, OpenCode)
- **Prompt Template**: Handlebars template that turns task data into agent prompts
- **Completion Detection**: The `<promise>COMPLETE</promise>` token signals task completion
- **Session Persistence**: Pause anytime, resume later, survive crashes

---

## Installation

### Prerequisites

- **Bun** >= 1.0.0 (required - Ralph TUI uses OpenTUI which requires Bun)
- One of these AI coding agents:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude` CLI)
  - [OpenCode](https://github.com/opencode-ai/opencode) (`opencode` CLI)

### Install

```bash
# Install globally with Bun
bun install -g ralph-tui

# Or run directly without installing
bunx ralph-tui
```

---

## Getting Started

### Step 1: Initialize Your Project

```bash
cd your-project
ralph-tui setup
```

The interactive wizard will:
1. Detect installed agents (Claude Code, OpenCode)
2. Create a `.ralph-tui/config.toml` configuration file
3. Install bundled skills for PRD creation and task conversion
4. Optionally detect existing trackers (Beads, prd.json files)

### Step 2: Create a PRD

```bash
# AI-powered interactive PRD creation (recommended)
ralph-tui create-prd
```

The AI will:
1. Ask about your feature goals and requirements
2. Ask about quality gates (what commands must pass)
3. Generate a structured PRD with user stories
4. Ask if you want to create tasks for a tracker

### Step 3: Start Ralph

```bash
# With prd.json (simplest - no external dependencies)
ralph-tui run --prd ./prd.json

# With Beads tracker
ralph-tui run --epic your-epic-id

# Or launch the interactive TUI first
ralph-tui
```

### Step 4: Watch the Progress

The TUI shows:
- **Left Panel**: Task list with status indicators
- **Right Panel**: Live agent output (stdout/stderr)
- **Header**: Current iteration, task being worked on
- **Footer**: Available keyboard shortcuts

Ralph will:
1. Select the highest-priority task with no blockers
2. Build a prompt from the task details using Handlebars templates
3. Execute your AI agent with the prompt
4. Stream output in real-time
5. Detect `<promise>COMPLETE</promise>` in the output
6. Mark the task complete and move to the next one

### Step 5: Control Execution

Press `p` to pause, `q` to quit, `d` for the dashboard, `i` for iteration history.

---

## Creating PRDs and Tasks

Ralph TUI includes a complete workflow for creating PRDs and converting them to tracker tasks.

### The PRD Workflow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  1. CREATE  │────▶│  2. REVIEW  │────▶│  3. CONVERT │────▶│   4. RUN    │
│    PRD      │     │    PRD      │     │  TO TASKS   │     │   RALPH     │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

### Step 1: Create a PRD

```bash
# AI-powered (recommended)
ralph-tui create-prd --chat

# Template-based wizard
ralph-tui create-prd
```

The AI will ask about:
- **Feature goal**: What problem does this solve?
- **Target users**: Who will use this feature?
- **Scope**: What should it include/exclude?
- **Quality gates**: What commands must pass? (bun run typecheck, bun run lint, etc.)

Output: `./tasks/prd-<feature-name>.md`

### Step 2: Review the PRD

Open the generated PRD and verify:
- User stories are small enough (completable in one agent session)
- Acceptance criteria are verifiable (not vague)
- Quality gates match your project's tooling
- Dependencies are correct (schema → backend → UI)

### Step 3: Convert to Tracker Tasks

After creating a PRD, Ralph will ask:

```
Would you like to create tasks for a tracker?
  A. JSON (prd.json) - Simple, no external dependencies
  B. Beads - Git-backed issue tracker with dependencies
  C. Skip - I'll create tasks manually
```

Or convert manually:

```bash
# Convert to prd.json
ralph-tui convert --to json ./tasks/prd-my-feature.md

# The conversion skill will:
# 1. Extract user stories from the PRD
# 2. Extract quality gates from the "## Quality Gates" section
# 3. Append quality gates to each story's acceptance criteria
# 4. Set up dependencies between stories
# 5. Output to ./prd.json
```

### Step 4: Run Ralph

```bash
ralph-tui run --prd ./prd.json
```

### Quality Gates

PRDs should include a **Quality Gates** section that specifies project-specific commands:

```markdown
## Quality Gates

These commands must pass for every user story:
- `bun run typecheck` - Type checking
- `bun run lint` - Linting

For UI stories, also include:
- Verify in browser using dev-browser skill
```

When converting to tasks, these gates are automatically appended to each story's acceptance criteria.

### Bundled Skills

Ralph TUI includes these skills (installed during `ralph-tui setup`):

| Skill | Trigger | Description |
|-------|---------|-------------|
| `ralph-tui-prd` | `/prd`, `create a prd` | AI-powered PRD creation with quality gates |
| `ralph-tui-create-json` | `/ralph`, `create json tasks` | Convert PRD to prd.json format |
| `ralph-tui-create-beads` | `create beads` | Convert PRD to Beads issues |

---

## CLI Commands Reference

| Command | Description |
|---------|-------------|
| `ralph-tui` | Launch the interactive TUI |
| `ralph-tui run [options]` | Start Ralph execution |
| `ralph-tui resume [options]` | Resume an interrupted session |
| `ralph-tui status [options]` | Check session status (headless, for CI/scripts) |
| `ralph-tui logs [options]` | View/manage iteration output logs |
| `ralph-tui setup` | Run interactive project setup (alias: `init`) |
| `ralph-tui create-prd [options]` | Create a new PRD interactively (alias: `prime`) |
| `ralph-tui convert [options]` | Convert PRD markdown to JSON format |
| `ralph-tui config show` | Display merged configuration |
| `ralph-tui template show` | Display current prompt template |
| `ralph-tui template init` | Copy default template for customization |
| `ralph-tui plugins agents` | List available agent plugins |
| `ralph-tui plugins trackers` | List available tracker plugins |
| `ralph-tui docs [section]` | Open documentation in browser |
| `ralph-tui help` | Show help message |

### Run Options

| Option | Description |
|--------|-------------|
| `--prd <path>` | PRD file path (auto-switches to json tracker) |
| `--epic <id>` | Epic ID for beads tracker |
| `--agent <name>` | Override agent plugin (e.g., `claude`, `opencode`) |
| `--model <name>` | Override model (see [Model Options](#model-options) below) |
| `--tracker <name>` | Override tracker plugin (e.g., `beads`, `beads-bv`, `json`) |
| `--iterations <n>` | Maximum iterations (0 = unlimited) |
| `--delay <ms>` | Delay between iterations in milliseconds |
| `--prompt <path>` | Custom prompt template file path |
| `--output-dir <path>` | Directory for iteration logs (default: .ralph-tui/iterations) |
| `--progress-file <path>` | Progress file for cross-iteration context (default: .ralph-tui/progress.md) |
| `--headless` | Run without TUI (alias: `--no-tui`) |
| `--no-setup` | Skip interactive setup even if no config exists |

### Model Options

The `--model` flag accepts different values depending on which agent you're using:

#### Claude Agent

```bash
ralph-tui run --agent claude --model <model>
```

| Model | Description |
|-------|-------------|
| `sonnet` | Claude Sonnet - balanced performance and cost |
| `opus` | Claude Opus - most capable, higher cost |
| `haiku` | Claude Haiku - fastest, lowest cost |

#### OpenCode Agent

```bash
ralph-tui run --agent opencode --model <provider>/<model>
```

Models use `provider/model` format. Valid providers:

| Provider | Example Models |
|----------|----------------|
| `anthropic` | `anthropic/claude-3-5-sonnet`, `anthropic/claude-3-opus` |
| `openai` | `openai/gpt-4o`, `openai/gpt-4-turbo` |
| `google` | `google/gemini-pro`, `google/gemini-1.5-pro` |
| `xai` | `xai/grok-1` |
| `ollama` | `ollama/llama3`, `ollama/codellama` |

> **Note:** Model names within each provider are validated by the provider's API. If you specify an invalid model name, you'll see an error from the underlying agent CLI.

### Create-PRD Options

| Option | Description |
|--------|-------------|
| `--chat`, `--ai` | Use AI-powered chat mode (recommended) |
| `--agent <name>` | Override agent for chat mode |
| `--output, -o <dir>` | Output directory for PRD files (default: ./tasks) |
| `--stories, -n <count>` | Number of user stories (template mode only) |
| `--force, -f` | Overwrite existing files |

### Convert Options

| Option | Description |
|--------|-------------|
| `--to <format>` | Target format: `json` |
| `--output, -o <path>` | Output file path (default: `./prd.json`) |
| `--branch, -b <name>` | Git branch name (prompts if not provided) |
| `--force, -f` | Overwrite existing files |

### Resume Options

| Option | Description |
|--------|-------------|
| `--cwd <path>` | Working directory |
| `--headless` | Run without TUI |
| `--force` | Override stale lock |

### Status Options

| Option | Description |
|--------|-------------|
| `--json` | Output in JSON format for CI/scripts |
| `--cwd <path>` | Working directory |

### Logs Options

| Option | Description |
|--------|-------------|
| `--iteration <n>` | View specific iteration |
| `--task <id>` | View logs for a specific task |
| `--clean` | Clean up old logs |
| `--keep <n>` | Number of recent logs to keep (with `--clean`) |
| `--dry-run` | Preview cleanup without deleting |
| `--verbose` | Show full output (not truncated) |

---

## TUI Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `s` | Start execution |
| `p` | Pause/Resume execution |
| `d` | Toggle progress dashboard |
| `i` | Toggle iteration history view |
| `v` | Toggle tasks/iterations view |
| `o` | Toggle details/output in panel |
| `h` | Toggle showing closed tasks |
| `l` | Load/switch epic |
| `u` | Toggle subagent tracing panel |
| `t` | Cycle subagent tracing detail level |
| `T` (Shift+T) | Toggle subagent tree panel |
| `,` | Open settings |
| `r` | Refresh task list |
| `j` / `Down` | Move selection down |
| `k` / `Up` | Move selection up |
| `Enter` | Drill into task/iteration details |
| `Escape` | Back (from detail views) / Quit (from task list) |
| `q` | Quit |
| `?` | Show help overlay |
| `Ctrl+C` | Interrupt current agent (with confirmation) |
| `Ctrl+C` x2 | Force quit immediately |

---

## Configuration

Ralph TUI uses TOML configuration files with layered overrides:

1. **Global config**: `~/.config/ralph-tui/config.toml`
2. **Project config**: `.ralph-tui/config.toml` (in project root)
3. **CLI flags**: Override everything

### Example Configuration

```toml
# .ralph-tui/config.toml

# Default tracker and agent
tracker = "json"
agent = "claude"

# Execution limits
maxIterations = 10

# Agent-specific options
[agentOptions]
model = "sonnet"

# Error handling
[errorHandling]
strategy = "skip"        # retry | skip | abort
maxRetries = 3
retryDelayMs = 5000
continueOnNonZeroExit = false

# Subagent tracing detail level
# off | minimal | moderate | full
subagentTracingDetail = "full"

# Custom prompt template path (relative to project root)
# prompt_template = "./my-prompt.hbs"
```

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `tracker` | string | Default tracker plugin (`json`, `beads`, `beads-bv`) |
| `agent` | string | Default agent plugin (`claude`, `opencode`) |
| `maxIterations` | number | Maximum iterations (0 = unlimited) |
| `iterationDelay` | number | Delay in ms between iterations |
| `prompt_template` | string | Path to custom Handlebars template |
| `outputDir` | string | Output directory for iteration logs |
| `progressFile` | string | Progress file path for cross-iteration context |
| `autoCommit` | boolean | Auto-commit after task completion |
| `fallbackAgents` | string[] | Fallback agents for rate limit handling |
| `rateLimitHandling` | object | Rate limit retry/fallback configuration |
| `subagentTracingDetail` | string | Subagent visibility: `off`, `minimal`, `moderate`, `full` |

---

## Agent & Tracker Plugins

### Built-in Agents

| Plugin | CLI Command | Description |
|--------|-------------|-------------|
| `claude` | `claude --print` | Claude Code CLI with streaming output |
| `opencode` | `opencode run` | OpenCode CLI |

### Built-in Trackers

| Plugin | Description | Features |
|--------|-------------|----------|
| `json` | prd.json file-based tracker | Simple JSON format, no external tools |
| `beads` | Beads issue tracker via `bd` CLI | Hierarchy, dependencies, labels |
| `beads-bv` | Beads + `bv` graph analysis | Intelligent selection via PageRank, critical path |

### Plugin Comparison Matrix

| Feature | json | beads | beads-bv |
|---------|------|-------|----------|
| External CLI | None | `bd` | `bd` + `bv` |
| Dependencies | Yes | Yes | Yes |
| Priority ordering | Yes | Yes | Yes |
| Hierarchy (epics) | No | Yes | Yes |
| Graph analysis | No | No | Yes |
| Sync with git | No | Yes | Yes |
| Setup complexity | Lowest | Medium | Highest |

---

## Best Practices

### 1. Start with JSON Mode

The `json` tracker has no external dependencies - just a `prd.json` file. Perfect for getting started quickly.

### 2. Use AI-Powered PRD Creation

```bash
ralph-tui create-prd --chat
```

The AI asks contextual questions and generates higher-quality PRDs than the template wizard.

### 3. Keep User Stories Small

Each story should be completable in one agent session (~one context window). If you can't describe it in 2-3 sentences, split it.

### 4. Include Quality Gates in PRDs

Always specify what commands must pass:

```markdown
## Quality Gates

These commands must pass for every user story:
- `bun run typecheck` - Type checking
- `bun run lint` - Linting
```

### 5. Start with Small Iterations

Set `maxIterations = 5` initially to monitor behavior before running longer sessions.

### 6. Review Iteration Logs

```bash
ralph-tui logs --iteration 3
ralph-tui logs --task US-005
```

### 7. Customize Your Prompt Template

```bash
ralph-tui template init
# Edit .ralph-tui-prompt.hbs to match your workflow
```

### 8. Handle Errors Gracefully

Configure error handling based on your needs:
- `retry`: For flaky operations (network issues)
- `skip`: For non-critical tasks
- `abort`: For critical workflows where any failure is unacceptable

---

## How It Works

### Execution Engine

The engine runs an iteration loop:

```
1. Get next task from tracker (respecting priority + dependencies)
2. Set task status to "in_progress"
3. Build prompt from Handlebars template + task data
4. Spawn agent process with prompt
5. Stream stdout/stderr to TUI
6. Parse output for <promise>COMPLETE</promise>
7. If complete: mark task done, move to next
8. If failed: apply error handling strategy (retry/skip/abort)
9. Repeat until no tasks remain or max iterations reached
```

### Session Persistence

Ralph saves state to `.ralph-tui-session.json`:
- Current iteration number
- Task statuses
- Iteration history
- Active task IDs (for crash recovery)

On resume, Ralph:
1. Loads the session file
2. Resets any stale "in_progress" tasks to "open"
3. Continues from where it left off

### Cross-Iteration Progress

Ralph maintains a progress file (`.ralph-tui/progress.md`) that accumulates notes from each iteration. This provides context for subsequent agent runs about what's been accomplished:

- **Automatic**: After each iteration, Ralph extracts insights and completion notes from agent output
- **Included in prompts**: Recent progress (last 5 iterations) is injected into the agent prompt via `{{recentProgress}}`
- **Fresh start per epic**: Progress file is cleared when starting a new session (not on resume)
- **Size-limited**: File is capped at ~50KB, with older entries automatically truncated

This helps the agent understand prior work without re-reading code, improving task execution quality.

### Subagent Tracing

When using Claude Code, Ralph can trace subagent activity:
- See when Claude spawns Task, Bash, Read, Write, etc.
- Track nested agent calls
- View timing and status of each subagent

Enable with `subagentTracingDetail = "full"` and press `u` to toggle the panel.

**Keyboard shortcuts for subagent tracing:**
- Press `t` to cycle detail levels (off -> minimal -> moderate -> full)
- Press `T` (Shift+T) to toggle the subagent tree panel

### Completion Detection

The agent signals task completion by outputting:
```
<promise>COMPLETE</promise>
```

Ralph watches for this token in stdout. When detected:
1. Task is marked as completed in the tracker
2. Session state is updated
3. Next iteration begins

---

## Parallel Execution Mode

Ralph TUI supports **parallel execution** for running multiple independent tasks simultaneously using git worktrees. This dramatically speeds up work on epics with many parallelizable tasks.

### How Parallel Execution Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PARALLEL EXECUTION FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────────┐                                                       │
│   │  TASK GRAPH      │  Analyze dependencies with bv                        │
│   │  ANALYZER        │  → Identify parallelizable work streams               │
│   └────────┬─────────┘                                                       │
│            │                                                                 │
│            ▼                                                                 │
│   ┌──────────────────┐                                                       │
│   │  WORKTREE POOL   │  Create isolated git worktrees                        │
│   │  MANAGER         │  → Resource-aware spawning (CPU/memory limits)        │
│   └────────┬─────────┘                                                       │
│            │                                                                 │
│            ▼                                                                 │
│   ┌────────────────────────────────────────────────────────────────┐        │
│   │                    PARALLEL EXECUTOR                            │        │
│   │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │        │
│   │  │ Worktree │  │ Worktree │  │ Worktree │  │ Worktree │       │        │
│   │  │   #1     │  │   #2     │  │   #3     │  │   #4     │       │        │
│   │  │ Task A   │  │ Task B   │  │ Task C   │  │ Task D   │       │        │
│   │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘       │        │
│   │       │             │             │             │              │        │
│   │       └─────────────┴──────┬──────┴─────────────┘              │        │
│   │                            │                                    │        │
│   │                   ┌────────┴─────────┐                         │        │
│   │                   │   COORDINATOR    │                         │        │
│   │                   │  Agent-to-Agent  │                         │        │
│   │                   │   Messaging      │                         │        │
│   │                   └──────────────────┘                         │        │
│   └────────────────────────────────────────────────────────────────┘        │
│            │                                                                 │
│            ▼                                                                 │
│   ┌──────────────────┐                                                       │
│   │  MERGE ENGINE    │  Consolidate branches back to main                    │
│   │                  │  → AI-powered conflict resolution                     │
│   │                  │  → Rollback capability if needed                      │
│   └──────────────────┘                                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Description |
|-----------|-------------|
| **Task Graph Analyzer** | Uses `bv` to analyze task dependencies and identify independent work streams |
| **Worktree Pool Manager** | Manages git worktrees with resource-aware spawning (CPU/memory limits) |
| **Parallel Executor** | Orchestrates concurrent task execution with continue-on-error semantics |
| **Coordinator** | Message broker for agent-to-agent communication during parallel runs |
| **Merge Engine** | Consolidates worktree branches with AI-powered conflict resolution |
| **Conflict Resolver** | AI-driven resolution of merge conflicts |
| **Broadcast Manager** | Shares discoveries between parallel agents |

### Starting Parallel Execution

```bash
# Start in parallel mode
ralph-tui run --prd ./prd.json --parallel

# With concurrency limit
ralph-tui run --prd ./prd.json --parallel --max-concurrency 4

# With Beads tracker
ralph-tui run --epic my-epic --parallel
```

### Parallel Execution Configuration

Add these options to your `.ralph-tui/config.toml`:

```toml
# .ralph-tui/config.toml

# Enable parallel execution by default
parallelMode = true

[parallel]
# Maximum concurrent task executions (default: 4)
maxConcurrency = 4

# Continue executing remaining tasks when one fails (default: true)
continueOnError = true

# Preserve failed worktree state for debugging (default: true)
preserveFailedWorktrees = true

# Timeout for individual task execution (default: 600000 = 10 minutes)
taskTimeoutMs = 600000

# Generate detailed failure reports (default: true)
generateDetailedReports = true

# Maximum output size to capture per task in bytes (default: 1MB)
maxOutputSizeBytes = 1048576

# Enable subagent tracing (default: true)
enableSubagentTracing = true

[parallel.worktreePool]
# Maximum worktrees in pool (default: matches maxConcurrency)
maxWorktrees = 4

# Minimum free memory required in MB (default: 512)
minFreeMemoryMB = 512

# Maximum CPU utilization percentage (default: 80)
maxCpuUtilization = 80

# Worktree directory relative to project root (default: ".worktrees")
worktreeDir = ".worktrees"

# Cleanup worktrees on successful merge (default: true)
cleanupOnSuccess = true

[parallel.merge]
# Create backup branch before merging (default: true)
createBackupBranch = true

# Backup branch prefix (default: "backup/pre-parallel-merge-")
backupBranchPrefix = "backup/pre-parallel-merge-"

# Delete worktree branches after successful merge (default: false)
deleteWorktreeBranchesOnSuccess = false

# Abort all merges on first conflict (default: false)
abortOnConflict = false

[parallel.merge.conflictResolution]
# Enable AI-powered conflict resolution (default: true)
autoResolve = true

# Maximum retries for AI resolution (default: 3)
maxRetries = 3

# Agent to use for conflict resolution
agentId = "claude"
```

### Parallel Mode Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `P` (Shift+P) | Toggle parallel execution mode |
| `m` | Open merge progress view |
| `M` (Shift+M) | Start merge session |
| `R` (Shift+R) | Rollback merge (if conflicts) |
| `w` | Toggle worktree status panel |
| `c` | View coordinator/messaging stats |
| `f` | View failure report (if any failures) |

### Understanding Parallel Execution Results

After parallel execution completes, you'll see:

1. **Success Summary**: Tasks completed, failed, and cancelled
2. **Merge Results**: Which worktree branches were merged successfully
3. **Conflict Report**: Any conflicts encountered with AI resolution attempts
4. **Preserved Worktrees**: Failed worktrees preserved for debugging

### Failure Handling

When tasks fail in parallel mode:

1. **Continue on Error**: By default, other tasks continue executing
2. **Worktree Preservation**: Failed worktrees are preserved at `.worktrees/task-<id>-<uuid>`
3. **Failure Report**: Detailed report with stdout/stderr, error phase, and attribution
4. **Rollback Option**: After merge, you can rollback to pre-merge state if needed

Example failure report:

```markdown
# Parallel Execution Failure Report

## Summary
- **Total Tasks**: 5
- **Completed**: 4
- **Failed**: 1
- **Success Rate**: 80.0%
- **Total Duration**: 45.32s

## Failure Details

### Task: Implement user auth
- **Task ID**: US-003
- **Agent ID**: agent-a1b2c3d4
- **Error Phase**: agent_execution
- **Error Message**: Type check failed
- **Preserved Worktree**: `.worktrees/task-US-003-a1b2c3d4`
```

### Merge Conflict Resolution

When merge conflicts occur:

1. **AI Resolution**: Claude attempts to resolve conflicts automatically
2. **User Prompt**: If AI cannot resolve, you'll be prompted
3. **Skip Option**: Skip the conflicting branch and continue
4. **Rollback**: Rollback all merges to pre-merge state

The AI conflict resolver analyzes:
- Both sides of the conflict
- Git blame for context
- Related file changes in the merge

---

## Troubleshooting

### "No tasks available"

- Check that your prd.json has tasks with `passes: false`
- Ensure tasks aren't blocked by incomplete dependencies
- For beads: check that your epic has open tasks: `bd list --epic your-epic`

### "Agent not found"

- Verify the agent CLI is installed: `which claude` or `which opencode`
- Check the agent is in your PATH
- Run `ralph-tui plugins agents` to see detected agents

### "Session lock exists"

Another Ralph instance may be running. Options:
- Wait for it to complete
- Use `ralph-tui resume --force` to override
- Manually delete `.ralph-tui-session.json`

### "Task stuck in_progress"

If Ralph crashed, tasks may be stuck:
```bash
# Resume will auto-reset stale tasks
ralph-tui resume

# Or manually reset via beads
bd update TASK-ID --status open
```

### "Agent output not streaming"

- Ensure the agent supports streaming (Claude Code does with `--print`)
- Check `subagentTracingDetail` isn't filtering output

### Logs and Debugging

```bash
# View iteration output
ralph-tui logs --iteration 5 --verbose

# Clean up old logs
ralph-tui logs --clean --keep 10

# Check session status
ralph-tui status --json
```

---

## Development

### Setup

```bash
# Clone the repo
git clone https://github.com/subsy/ralph-tui.git
cd ralph-tui

# Install dependencies
bun install

# Run in development mode
bun run ./src/cli.tsx

# Type check
bun run typecheck

# Lint
bun run lint
```

### Project Structure

```
ralph-tui/
├── src/
│   ├── cli.tsx           # CLI entry point
│   ├── commands/         # CLI commands (run, resume, status, logs, etc.)
│   ├── config/           # Configuration loading and validation (Zod schemas)
│   ├── engine/           # Execution engine (iteration loop, events)
│   ├── interruption/     # Signal handling and graceful shutdown
│   ├── logs/             # Iteration log persistence
│   ├── plugins/
│   │   ├── agents/       # Agent plugins (claude, opencode)
│   │   │   └── tracing/  # Subagent tracing parser
│   │   └── trackers/     # Tracker plugins (beads, beads-bv, json)
│   ├── session/          # Session persistence and lock management
│   ├── setup/            # Interactive setup wizard
│   ├── templates/        # Handlebars prompt templates
│   ├── chat/             # AI chat mode for PRD creation
│   ├── prd/              # PRD generation and parsing
│   └── tui/              # Terminal UI components (OpenTUI/React)
│       └── components/   # React components
├── skills/               # Bundled skills for PRD/task creation
│   ├── ralph-tui-prd/
│   ├── ralph-tui-create-json/
│   └── ralph-tui-create-beads/
```

### Key Technologies & Credits

Ralph TUI is built with:

- [Bun](https://bun.sh) - JavaScript runtime
- [OpenTUI](https://github.com/anomalyco/opentui) - Terminal UI framework
- [React](https://react.dev) - Component model for TUI
- [Handlebars](https://handlebarsjs.com) - Prompt templating
- [Zod](https://zod.dev) - Configuration validation
- [smol-toml](https://github.com/squirrelchat/smol-toml) - TOML parsing

Thanks to Geoffrey Huntley for the [original Ralph Wiggum loop concept](https://ghuntley.com/ralph/).

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---
