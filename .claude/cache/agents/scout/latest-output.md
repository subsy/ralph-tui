# Codebase Report: ralph-tui Sessions and Plans Architecture
Generated: 2026-01-14 12:30 PST

## Summary

Ralph TUI is an **AI Agent Loop Orchestrator** that automates AI coding agents (Claude Code, OpenCode) to work through task lists autonomously. It manages **one session at a time** with a single plan/tracker, but supports **pausing/resuming** and **switching between different trackers or epics** across sessions. Sessions are persisted to `.ralph-tui/session.json` for crash recovery and resume functionality.

**Key Finding:** Ralph operates with **one active session at a time**, but you can have **multiple plans** (PRDs, epics) and switch between them across sessions.

---

## Project Structure

```
ralph-tui/
├── src/
│   ├── cli.tsx                    # CLI entry point, command routing
│   ├── commands/                  # CLI commands
│   │   ├── run.tsx                # Start new session
│   │   ├── resume.tsx             # Resume paused session
│   │   ├── create-prd.tsx         # Create PRD with AI
│   │   ├── convert.ts             # Convert PRD to tasks
│   │   └── status.ts              # Check session status
│   ├── session/                   # Session management
│   │   ├── persistence.ts         # Session file operations
│   │   ├── lock.ts                # Process locking
│   │   ├── types.ts               # Session types
│   │   └── index.ts               # Session API
│   ├── engine/                    # Execution loop
│   │   ├── index.ts               # ExecutionEngine class
│   │   └── types.ts               # Engine events, state
│   ├── plugins/
│   │   ├── agents/                # Agent plugins (Claude, OpenCode)
│   │   └── trackers/              # Tracker plugins (JSON, Beads)
│   │       ├── builtin/
│   │       │   ├── json.ts        # prd.json tracker
│   │       │   ├── beads.ts       # Beads CLI tracker
│   │       │   └── beads-bv.ts    # Beads + bv graph analysis
│   ├── tui/                       # Terminal UI
│   │   └── components/
│   │       ├── RunApp.js          # Main TUI app
│   │       └── EpicSelectionApp.js
│   └── config/                    # Configuration
│       ├── schema.ts              # Zod validation
│       └── types.ts               # Config types
├── .ralph-tui/                    # Session & runtime files (created on first run)
│   ├── session.json               # Active session state
│   ├── session.lock               # Process lock file
│   ├── config.toml                # Project config
│   ├── iterations/                # Per-iteration logs
│   └── progress.md                # Cross-iteration context
└── skills/                        # Bundled Claude Code skills
    ├── ralph-tui-prd/             # PRD creation skill
    ├── ralph-tui-create-json/     # Convert PRD → prd.json
    └── ralph-tui-create-beads/    # Convert PRD → Beads issues
```

---

## Questions Answered

### Q1: What is ralph-tui? What does it do?

**Ralph TUI is an AI Agent Loop Orchestrator** that automates the cycle of:
1. **Select Task** → picks highest-priority task from tracker
2. **Build Prompt** → renders Handlebars template with task data
3. **Execute Agent** → spawns AI agent (Claude Code / OpenCode)
4. **Detect Completion** → checks for `<promise>COMPLETE</promise>` token
5. **Update Tracker** → marks task complete, moves to next

**Core Workflow:**
```
┌─────────────────────────────────────────────────────────────────┐
│                     AUTONOMOUS LOOP                             │
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
└─────────────────────────────────────────────────────────────────┘
```

**Key Features:**
- **Autonomous execution** - no manual copy/paste of tasks to AI
- **Session persistence** - pause/resume, crash recovery
- **Multiple trackers** - prd.json (file-based), Beads (git-backed)
- **TUI visibility** - real-time agent output, task status, iteration history
- **Error handling** - configurable retry/skip/abort strategies
- **Cross-iteration context** - progress.md tracks what's been done

---

### Q2: How does it handle "sessions" and "plans"?

#### Sessions

**One active session at a time**, persisted to `.ralph-tui/session.json`:

**File Location:** `<project>/.ralph-tui/session.json`

**Session State Structure:**
```typescript
interface PersistedSessionState {
  version: 1;                      // Schema version
  sessionId: string;               // UUID for this session
  status: SessionStatus;           // running | paused | completed | failed | interrupted
  
  // Timing
  startedAt: string;               // ISO 8601
  updatedAt: string;
  pausedAt?: string;
  
  // Progress tracking
  currentIteration: number;        // 0-based internally, 1-based for display
  maxIterations: number;           // 0 = unlimited
  tasksCompleted: number;
  
  // Agent & tracker info
  agentPlugin: string;             // 'claude' | 'opencode'
  model?: string;                  // e.g., 'opus', 'sonnet'
  trackerState: TrackerStateSnapshot;
  
  // Iteration history
  iterations: PersistedIterationResult[];
  
  // Crash recovery
  activeTaskIds: string[];         // Tasks set to in_progress by this session
  skippedTaskIds: string[];        // Tasks skipped due to errors
  
  // UI state
  subagentPanelVisible?: boolean;  // Persist TUI panel state
  
  cwd: string;                     // Working directory
}
```

**Session Lifecycle:**
```
ralph-tui run
    ↓
[Check for .ralph-tui/session.json]
    ↓
┌─────────────────────────────────┐
│ Existing session found?         │
├─────────────────────────────────┤
│ YES: status = 'paused'?         │
│   → Prompt: Resume or New?      │
│ YES: status = 'running'?        │
│   → Stale session recovery      │
│ NO: Create new session          │
└─────────────────────────────────┘
    ↓
Create session.lock (PID-based)
    ↓
Initialize ExecutionEngine
    ↓
Run iteration loop
    ↓
Save state after each iteration
    ↓
On graceful exit:
  - Reset activeTaskIds → 'open'
  - Delete session.json
  - Release lock
```

**Session Commands:**
| Command | Effect |
|---------|--------|
| `ralph-tui run` | Start new session OR resume if paused |
| `ralph-tui resume` | Resume paused session (explicit) |
| `ralph-tui status` | Check session status without TUI |
| `ralph-tui status --json` | JSON output for CI/scripts |

**Session Status Flow:**
```
                    start()
    idle  ────────────────────▶  running
     ▲                              │
     │                         pause()
     │                              ▼
     │                           pausing
     │                              │
     │                      (iteration completes)
     │                              ▼
     └──────── resume() ───────  paused
     
                    stop()
    running ────────────────▶  stopping ────▶ idle
```

#### Plans

**Plans = Task Lists** from a tracker plugin. Ralph supports **three tracker types**:

**1. JSON Tracker** (`prd.json`)
- **File-based** - no external dependencies
- **Single plan per file**
- **Use case:** Quick start, simple projects

**Structure:**
```json
{
  "project": "My Project",
  "description": "Project description",
  "userStories": [
    {
      "id": "US-001",
      "title": "Add login",
      "description": "Implement user login",
      "priority": 2,
      "status": "open",
      "dependsOn": [],
      "passes": false
    }
  ]
}
```

**2. Beads Tracker** (`bd` CLI)
- **Git-backed** - issues in `.beads/beads.jsonl`
- **Multiple epics** - hierarchical structure
- **Use case:** Larger projects, git-synced workflows

**3. Beads-BV Tracker** (`bd` + `bv`)
- **Graph analysis** - PageRank, critical path, cycle detection
- **Intelligent selection** - picks tasks with highest impact
- **Use case:** Complex dependency graphs

**Multiple Plans Pattern:**
```bash
# Plan 1: Feature A
ralph-tui run --epic feature-a-epic
  → Works on tasks under feature-a-epic
  → Pause when done

# Plan 2: Feature B (different session)
ralph-tui run --epic feature-b-epic
  → Works on tasks under feature-b-epic
```

**Each session tracks its plan:**
```typescript
trackerState: {
  plugin: 'beads',
  epicId: 'feature-a-epic',    // Which plan we're executing
  totalTasks: 12,
  tasks: [ /* task snapshots */ ]
}
```

---

### Q3: Can you have multiple sessions or plans? Or only one at a time?

**Answer:**
- **Sessions:** **ONE at a time** (enforced by `.ralph-tui/session.lock`)
- **Plans:** **MULTIPLE plans exist**, but **ONE active plan per session**

**Lock Enforcement:**
```typescript
// File: src/session/lock.ts
interface LockFile {
  pid: number;           // Process ID
  sessionId: string;     // UUID
  acquiredAt: string;    // ISO 8601
  cwd: string;
  hostname: string;
}

// Lock file: .ralph-tui/session.lock
```

**If you try to start a second session:**
```bash
$ ralph-tui run --epic another-epic
Error: Another Ralph session is running (PID 12345)
Use 'ralph-tui resume --force' to override a stale lock.
```

**Switching Plans Across Sessions:**
```bash
# Session 1: Work on Epic A
$ ralph-tui run --epic epic-a
  ... works on epic-a tasks ...
  [Press 'p' to pause]

# Session 2: Work on Epic B (new session)
$ ralph-tui run --epic epic-b
  ... works on epic-b tasks ...
```

**Dynamic Epic Switching (within session):**
```bash
# Start with epic-a
$ ralph-tui run --epic epic-a

# In TUI: Press 'l' to load different epic
  → Shows epic selection UI
  → Switch to epic-b mid-session
  → Continues with epic-b tasks
```

**Implementation:**
```typescript
// File: src/plugins/trackers/types.ts
interface TrackerPlugin {
  // Set epic ID dynamically
  setEpicId?(epicId: string): void;
  
  // Get current epic ID
  getEpicId?(): string;
  
  // Get available epics
  getEpics(): Promise<TrackerTask[]>;
}
```

---

## Conventions Discovered

### Naming

| Type | Convention | Example |
|------|------------|---------|
| Files | kebab-case | `session-persistence.ts` |
| React Components | PascalCase | `RunApp.js`, `EpicSelectionApp.js` |
| Interfaces | PascalCase | `PersistedSessionState`, `TrackerPlugin` |
| Functions | camelCase | `loadPersistedSession()`, `hasPersistedSession()` |
| Constants | UPPER_SNAKE_CASE | `SESSION_FILE`, `PROMISE_COMPLETE_PATTERN` |

### Patterns

| Pattern | Usage | Example |
|---------|-------|---------|
| **Plugin System** | Agents & trackers | `TrackerPlugin`, `AgentPlugin` interfaces |
| **Event-Driven** | Engine emits events | `engine:started`, `iteration:completed` |
| **State Machines** | Session & engine status | `idle → running → pausing → paused` |
| **Builder Pattern** | Config construction | `buildConfig()`, `validateConfig()` |
| **Repository Pattern** | Plugin registries | `AgentRegistry`, `TrackerRegistry` |
| **Factory Pattern** | Plugin creation | `TrackerPluginFactory`, `AgentPluginFactory` |

### Testing

- **Test location:** Not visible in current structure (no `__tests__/` or `spec/`)
- **Type checking:** `bun run typecheck` (no emit)
- **Linting:** `bun run lint` (ESLint)

---

## Architecture Map

### Data Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                          USER LAYER                              │
├──────────────────────────────────────────────────────────────────┤
│ CLI (cli.tsx)                                                    │
│   ├─ run [options]         → Start new session                  │
│   ├─ resume                → Resume paused session               │
│   ├─ create-prd            → Create PRD with AI                 │
│   └─ status                → Check session status                │
└───────────────┬──────────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────────┐
│                       COMMAND LAYER                              │
├──────────────────────────────────────────────────────────────────┤
│ commands/                                                        │
│   ├─ run.tsx               → Parse args, load config, start TUI │
│   ├─ resume.tsx            → Load session, resume engine        │
│   └─ create-prd.tsx        → AI chat → PRD → tasks             │
└───────────────┬──────────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────────┐
│                      SESSION LAYER                               │
├──────────────────────────────────────────────────────────────────┤
│ session/                                                         │
│   ├─ persistence.ts        → CRUD for session.json              │
│   ├─ lock.ts               → PID-based process locking          │
│   └─ index.ts              → createSession(), resumeSession()   │
└───────────────┬──────────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────────┐
│                       ENGINE LAYER                               │
├──────────────────────────────────────────────────────────────────┤
│ engine/                                                          │
│   └─ index.ts (ExecutionEngine)                                 │
│       ├─ start()           → Initialize, run loop               │
│       ├─ runIteration()    → Select task, execute agent         │
│       ├─ pause()           → Set pausing flag                   │
│       ├─ resume()          → Continue from paused               │
│       └─ stop()            → Interrupt, cleanup                 │
└───────────────┬──────────────────────────────────────────────────┘
                │
                ├──────────────────────┬───────────────────────────┐
                ▼                      ▼                           ▼
┌───────────────────────┐  ┌───────────────────────┐  ┌──────────────────┐
│   TRACKER PLUGINS     │  │   AGENT PLUGINS       │  │   TUI LAYER      │
├───────────────────────┤  ├───────────────────────┤  ├──────────────────┤
│ JSON Tracker          │  │ Claude Agent          │  │ RunApp (React)   │
│   → prd.json          │  │   → claude CLI        │  │   - Task list    │
│                       │  │                       │  │   - Agent output │
│ Beads Tracker         │  │ OpenCode Agent        │  │   - Iteration    │
│   → bd CLI            │  │   → opencode CLI      │  │     history      │
│                       │  │                       │  │   - Dashboard    │
│ Beads-BV Tracker      │  │                       │  │                  │
│   → bd + bv CLI       │  │                       │  │                  │
└───────────────────────┘  └───────────────────────┘  └──────────────────┘
```

### Session State Machine

```
                    start()
    ┌─────┐    ──────────────▶    ┌─────────┐
    │IDLE │                       │ RUNNING │
    └─────┘    ◀──────────────    └─────────┘
                    stop()              │
                                   pause()
                                        │
                                        ▼
                                  ┌─────────┐
                                  │ PAUSING │
                                  └─────────┘
                                        │
                                (iteration completes)
                                        │
                                        ▼
                   resume()       ┌─────────┐
                    ────────────▶ │ PAUSED  │
                                  └─────────┘
                                        │
                                   stop()
                                        │
                                        ▼
                                  ┌──────────┐
                                  │ STOPPING │
                                  └──────────┘
                                        │
                                        ▼
                                    ┌─────┐
                                    │IDLE │
                                    └─────┘
```

---

## Key Files

| File | Purpose | Entry Points |
|------|---------|--------------|
| `src/cli.tsx` | CLI entry, command routing | `main()` |
| `src/commands/run.tsx` | Start session command | `executeRunCommand()` |
| `src/commands/resume.tsx` | Resume session command | `executeResumeCommand()` |
| `src/session/persistence.ts` | Session CRUD operations | `loadPersistedSession()`, `savePersistedSession()` |
| `src/session/lock.ts` | Process locking | `acquireLock()`, `releaseLock()` |
| `src/engine/index.ts` | Execution loop | `ExecutionEngine.start()` |
| `src/plugins/trackers/builtin/json.ts` | prd.json tracker | `JsonTrackerPlugin` |
| `src/plugins/trackers/builtin/beads.ts` | Beads tracker | `BeadsTrackerPlugin` |
| `src/plugins/agents/builtin/claude.ts` | Claude agent | `ClaudeAgentPlugin` |
| `src/tui/components/RunApp.js` | Main TUI component | `RunApp` (React) |

---

## Session vs Plan: Design Decision

**Why one session at a time?**

1. **Process Safety:** Single session.lock prevents race conditions
2. **Resource Management:** One agent process at a time (no concurrent API calls)
3. **TUI Clarity:** User focuses on one task stream
4. **State Consistency:** Session.json always reflects single coherent state

**Why multiple plans?**

1. **Project Organization:** Different features/epics live independently
2. **Prioritization:** Switch focus between urgent work without losing progress
3. **Team Coordination:** Different epics can be worked on sequentially

**The Trade-off:**

Ralph sacrifices **concurrent execution** for **simplicity and safety**. You can't work on multiple epics simultaneously, but you can:
- **Pause** epic-a mid-session
- **Start new session** for urgent epic-b
- **Resume** epic-a later

This aligns with the **single-threaded nature of AI agents** and **human attention**.

---

## Open Questions

1. **Can you run multiple ralph-tui instances in different project directories?**
   - **Likely YES** - lock file is `.ralph-tui/session.lock` (project-local)
   - Would need to verify no global locks exist

2. **What happens if you edit prd.json while session is running?**
   - Tasks are loaded at session start into `trackerState.tasks[]`
   - Mid-session edits probably won't be picked up until next session
   - Beads tracker may sync changes (needs testing)

3. **Can you create a new prd.json for a different plan while a session is running?**
   - Session holds lock only for `.ralph-tui/session.lock`
   - Creating a new `prd-feature-b.json` should be safe
   - But can't **run** it until current session ends

---

## Final Answer: Multiple Sessions or Plans?

### Sessions
**ONE at a time** - enforced by:
- `.ralph-tui/session.lock` (PID-based)
- Only one `ExecutionEngine` instance per project directory
- Attempting second session → error or resume prompt

### Plans
**MULTIPLE plans supported** - but:
- **ONE plan active per session** (via `epicId` or `prdPath`)
- Can **switch plans** by:
  - Pausing current session
  - Starting new session with different `--epic` or `--prd`
  - Pressing `l` in TUI to switch epics dynamically (for Beads tracker)

**Analogy:**
- **Session** = Your current coding session (one editor window)
- **Plan** = Your to-do list (can have many, but only work one at a time)

You can have 10 different PRDs or epics, but Ralph will only work on one at a time within a single session.

---

**Report complete.** Ralph TUI's architecture clearly enforces **one active session** but allows **multiple plans** that can be worked on sequentially.
