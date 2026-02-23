# Engine Improvements

## Overview
Eight improvements to the ralph-tui engine that collectively add verification, cost awareness, smarter model selection, and better completion detection. The theme: Ralph trusts the agent too much — these changes add "trust but verify" guardrails without sacrificing speed.

## Status
🟡 In Progress

**Progress:** 5/8 steps
**Branch:** feat/engine-improvements
**Depends on:** None

## Research Context

**Key architecture findings:**
- Main loop lives in `src/engine/index.ts` — `runLoop()` (line 521) drives the iteration cycle
- Completion detection uses single regex: `/<promise>\s*COMPLETE\s*<\/promise>/i` (line 67)
- Auto-commit already exists in `src/engine/auto-commit.ts` but is opt-in (`autoCommit: false` default)
- Config types in `src/config/types.ts` — `RalphConfig`, `StoredConfig`, `RuntimeOptions`
- Event system has 30+ event types in `src/engine/types.ts` — extensible via `EngineEventListener`
- Template system uses Handlebars with `TemplateVariables` in `src/templates/types.ts`
- Token usage extracted via `TokenUsageAccumulator` in `src/plugins/agents/usage.ts`
- JSON tracker in `src/plugins/trackers/builtin/json/index.ts` has `acceptanceCriteria` in schema but only passes them to prompts
- Session persistence in `src/session/` — saves after each iteration

**Extension points:**
- Post-completion hook: between `task:completed` event (line 1321) and iteration log save (line 1373)
- Agent selection: `getNextAvailableTask()` + agent config in `RalphConfig.agent`
- Prompt building: `renderPrompt()` in `src/templates/engine.ts` with `extendedContext`
- Iteration result: `IterationResult` type carries `usage`, `durationMs`, `taskCompleted`

**Codebase conventions:**
- All files start with `ABOUTME:` JSDoc comment
- Uses `runProcess()` utility for shell commands
- Write locks for atomic file operations
- Events emitted for all state transitions

## Architecture Decisions
1. **Verification as a new engine phase** — Add between completion detection and task marking, not as a separate plugin. Keeps the loop linear and debuggable.
2. **Model escalation in engine, not agent plugin** — Engine decides when to escalate; agent plugins just receive the model override. Keeps agent plugins stateless.
3. **Cost tracking via accumulator pattern** — Extend existing `TokenUsageAccumulator` with pricing data rather than building separate tracking.
4. **Completion detection as strategy pattern** — Multiple detectors tried in sequence, configurable. Current regex becomes one strategy.

## Dependencies Graph
```
Step 1 (verification) ─► Step 4 (AC validation)
         │
Step 2 (auto-commit) ──── independent
         │
Step 3 (model escalation) ─► Step 7 (cost tracking)
         │
Step 5 (completion detection) ── independent
         │
Step 6 (cross-iteration context) ── independent
         │
Step 8 (parallel first-class) ── independent
```

## Steps Overview

| # | Step | Status | Dependencies | Complexity |
|---|------|--------|--------------|------------|
| 1 | Verification gates | ✅ | None | M |
| 2 | Auto-commit defaults | ✅ | None | S |
| 3 | Model escalation strategy | ✅ | None | M |
| 4 | Cross-iteration context | ✅ | None | M |
| 5 | Completion detection hardening | ✅ | None | M |
| 6 | Acceptance criteria validation | ⬜ | Step 1 | M |
| 7 | Cost tracking | ⬜ | Step 3 | M |
| 8 | First-class parallel execution | ⬜ | None | S |

## Step Details

### Step 1: Verification Gates
- **Folder:** `./01-verification-gates/`
- **Branch:** `feat/engine-improvements-01-verification`
- **Dependencies:** None
- **Complexity:** M
- **Description:** Add configurable verification commands that run after an agent signals completion but before the task is marked done. If verification fails, retry the task with error output injected into the prompt.

### Step 2: Auto-Commit Defaults
- **Folder:** `./02-auto-commit-defaults/`
- **Branch:** `feat/engine-improvements-02-auto-commit`
- **Dependencies:** None
- **Complexity:** S
- **Description:** Make `autoCommit: true` the default. Improve commit messages to include iteration number and branch context. Add `--no-auto-commit` CLI flag for opt-out.

### Step 3: Model Escalation Strategy
- **Folder:** `./03-model-escalation/`
- **Branch:** `feat/engine-improvements-03-model-escalation`
- **Dependencies:** None
- **Complexity:** M
- **Description:** Start with a cheaper model (e.g., sonnet) and escalate to a more capable model (e.g., opus) on verification failure or retry. Configurable via `modelEscalation` config.

### Step 4: Cross-Iteration Context
- **Folder:** `./04-cross-iteration-context/`
- **Branch:** `feat/engine-improvements-04-cross-iteration-context`
- **Dependencies:** None
- **Complexity:** M
- **Description:** After each iteration, generate a structured diff summary (files changed, exports added, key patterns). Feed as structured context to subsequent iterations instead of raw output history.

### Step 5: Completion Detection Hardening
- **Folder:** `./05-completion-detection/`
- **Branch:** `feat/engine-improvements-05-completion-detection`
- **Dependencies:** None
- **Complexity:** M
- **Description:** Add multiple completion detection strategies: explicit tag (current), file-change heuristic, and post-execution probe. Configurable, with current behavior as default.

### Step 6: Acceptance Criteria Validation
- **Folder:** `./06-acceptance-criteria-validation/`
- **Branch:** `feat/engine-improvements-06-ac-validation`
- **Dependencies:** Step 1
- **Complexity:** M
- **Description:** After agent signals completion, parse acceptance criteria for executable assertions (shell commands, file existence checks). Run them as part of the verification gate. Non-executable criteria are skipped.

### Step 7: Cost Tracking
- **Folder:** `./07-cost-tracking/`
- **Branch:** `feat/engine-improvements-07-cost-tracking`
- **Dependencies:** Step 3
- **Complexity:** M
- **Description:** Track cumulative cost per session using model pricing lookup. Display running total in TUI dashboard. Add configurable cost alert threshold.

### Step 8: First-Class Parallel Execution
- **Folder:** `./08-parallel-first-class/`
- **Branch:** `feat/engine-improvements-08-parallel`
- **Dependencies:** None
- **Complexity:** S
- **Description:** Make `--parallel` a documented first-class CLI flag. Auto-detect independent tasks from dependency graph. Make conflict resolution timeout configurable.

## Files to Create/Modify
| File | Purpose |
|------|---------|
| `src/engine/index.ts` | Core loop: add verification phase, model escalation, cost tracking |
| `src/engine/verification.ts` | New: verification gate runner |
| `src/engine/model-escalation.ts` | New: model escalation logic |
| `src/engine/cost-tracker.ts` | New: cost accumulation and alerting |
| `src/engine/completion-strategies.ts` | New: pluggable completion detection |
| `src/engine/diff-summarizer.ts` | New: git diff → structured context |
| `src/engine/ac-validator.ts` | New: acceptance criteria → executable checks |
| `src/engine/auto-commit.ts` | Improve commit messages |
| `src/config/types.ts` | Add verification, escalation, cost config types |
| `src/templates/types.ts` | Add diff summary to template variables |
| `src/tui/` | Cost display in dashboard |

## Completion Log
| Step | Completed | Summary |
|------|-----------|---------|
| 1 | 2026-02-22 | Verification gates: configurable commands run post-completion, retry with error injection |
| 2 | 2026-02-22 | Auto-commit defaults: autoCommit=true default, improved commit messages with iteration |
| 3 | 2026-02-22 | Model escalation: start cheap, escalate on failure, configurable via config pipeline |
| 4 | 2026-02-22 | Cross-iteration context: git diff summaries fed as structured context to subsequent iterations |
| 5 | 2026-02-22 | Completion detection: pluggable strategies (promise-tag, relaxed-tag, heuristic) |
