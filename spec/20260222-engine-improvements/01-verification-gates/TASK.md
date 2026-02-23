# Step 1: Verification Gates

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this task.

## Quick Reference
- **Branch:** `feat/engine-improvements-01-verification`
- **Complexity:** M
- **Dependencies:** None
- **Estimated files:** 5

## Objective
Add configurable verification commands that run after an agent signals `<promise>COMPLETE</promise>` but before the task is marked done in the tracker. If any verification command fails, the task is NOT marked complete — instead, the engine retries the task with the verification error output injected into the prompt context.

## Context from Research
- Completion detection happens at `src/engine/index.ts:1302-1310`
- Task is marked complete at `src/engine/index.ts:1317-1320`
- Auto-commit happens at `src/engine/index.ts:1334-1336`
- The `runProcess()` utility in `src/utils/process.ts` handles shell execution
- Config types live in `src/config/types.ts` — add `VerificationConfig` there
- Error handling strategy (`retry`/`skip`/`abort`) already exists in config
- The engine emits events for all state transitions — add verification events

## Prerequisites
- [ ] ralph-tui builds and tests pass on current main

## Implementation

**Read these files first** (in parallel):
- `src/engine/index.ts` — understand iteration flow around lines 1302-1390
- `src/config/types.ts` — understand config structure for adding new fields
- `src/engine/types.ts` — understand event system for new events
- `src/utils/process.ts` — understand `runProcess()` for running commands

### 1. Add config types

In `src/config/types.ts`, add:

```typescript
/**
 * Configuration for post-completion verification commands.
 * Commands run after agent signals completion but before task is marked done.
 */
export interface VerificationConfig {
  /** Whether verification is enabled (default: false) */
  enabled?: boolean;

  /** Shell commands to run for verification. All must pass (exit code 0). */
  commands?: string[];

  /** Timeout per command in milliseconds (default: 60000) */
  timeoutMs?: number;

  /** Maximum verification retries before skipping task (default: 2) */
  maxRetries?: number;
}

export const DEFAULT_VERIFICATION_CONFIG: Required<VerificationConfig> = {
  enabled: false,
  commands: [],
  timeoutMs: 60_000,
  maxRetries: 2,
};
```

Add `verification?: VerificationConfig` to both `StoredConfig` and `RalphConfig`.

### 2. Create verification runner

Create `src/engine/verification.ts`:

```typescript
/**
 * ABOUTME: Verification gate runner for post-completion checks.
 * Runs configurable shell commands after agent signals task completion.
 * All commands must pass (exit 0) for the task to be marked done.
 */

import { runProcess } from '../utils/process.js';
import type { VerificationConfig } from '../config/types.js';

export interface VerificationResult {
  passed: boolean;
  results: CommandResult[];
  durationMs: number;
}

export interface CommandResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  passed: boolean;
  durationMs: number;
}

export async function runVerification(
  cwd: string,
  config: Required<VerificationConfig>,
): Promise<VerificationResult> {
  const startedAt = Date.now();
  const results: CommandResult[] = [];

  for (const command of config.commands) {
    const cmdStart = Date.now();
    const result = await runProcess('sh', ['-c', command], {
      cwd,
      timeout: config.timeoutMs,
    });
    results.push({
      command,
      exitCode: result.exitCode ?? 1,
      stdout: result.stdout,
      stderr: result.stderr,
      passed: result.success,
      durationMs: Date.now() - cmdStart,
    });

    // Stop on first failure
    if (!result.success) break;
  }

  return {
    passed: results.every(r => r.passed),
    results,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Format verification failures into a string suitable for injection
 * into the agent's retry prompt context.
 */
export function formatVerificationErrors(result: VerificationResult): string {
  const failures = result.results.filter(r => !r.passed);
  if (failures.length === 0) return '';

  return failures.map(f =>
    `Verification command failed: \`${f.command}\`\nExit code: ${f.exitCode}\nstderr:\n${f.stderr}\nstdout:\n${f.stdout}`
  ).join('\n\n');
}
```

### 3. Add verification events to engine types

In `src/engine/types.ts`, add to the `EngineEvent` union:

```typescript
export interface VerificationStartedEvent {
  type: 'verification:started';
  timestamp: string;
  task: TrackerTask;
  commands: string[];
}

export interface VerificationPassedEvent {
  type: 'verification:passed';
  timestamp: string;
  task: TrackerTask;
  durationMs: number;
}

export interface VerificationFailedEvent {
  type: 'verification:failed';
  timestamp: string;
  task: TrackerTask;
  failures: string[];
  retriesRemaining: number;
}
```

### 4. Integrate into engine loop

In `src/engine/index.ts`, modify the post-completion flow (around line 1302-1336):

```typescript
// After completion detection (line 1310)
const taskCompleted = promiseComplete;

// NEW: Run verification if task appears complete
if (taskCompleted && this.config.verification?.enabled) {
  const verifyResult = await runVerification(
    this.config.cwd,
    { ...DEFAULT_VERIFICATION_CONFIG, ...this.config.verification },
  );

  this.emit({
    type: verifyResult.passed ? 'verification:passed' : 'verification:failed',
    timestamp: new Date().toISOString(),
    task,
    ...(verifyResult.passed
      ? { durationMs: verifyResult.durationMs }
      : {
          failures: verifyResult.results.filter(r => !r.passed).map(r => r.command),
          retriesRemaining: /* track retries */,
        }),
  });

  if (!verifyResult.passed) {
    // Store verification errors for next iteration's prompt context
    this.lastVerificationErrors = formatVerificationErrors(verifyResult);
    // Don't mark task as complete — loop will retry
    taskCompleted = false; // need to change const to let
  }
}
```

Also inject `lastVerificationErrors` into the prompt template context when building prompts for retried tasks.

### 5. Add to prompt template

In `src/templates/types.ts`, add `verificationErrors?: string` to `TemplateVariables`.

In the JSON tracker template (`src/plugins/trackers/builtin/json/template.hbs`), add a conditional block:

```handlebars
{{#if verificationErrors}}

## Previous Verification Failures

The previous attempt signaled completion but verification commands failed. Fix these issues:

{{{verificationErrors}}}
{{/if}}
```

## Files to Create/Modify

### `src/engine/verification.ts` (NEW)
Verification gate runner with `runVerification()` and `formatVerificationErrors()`.

### `src/config/types.ts` (MODIFY)
Add `VerificationConfig` interface, `DEFAULT_VERIFICATION_CONFIG`, add to `StoredConfig` and `RalphConfig`.

### `src/engine/types.ts` (MODIFY)
Add `VerificationStartedEvent`, `VerificationPassedEvent`, `VerificationFailedEvent` to `EngineEvent` union.

### `src/engine/index.ts` (MODIFY)
Insert verification phase between completion detection and task completion marking.

### `src/templates/types.ts` (MODIFY)
Add `verificationErrors` to `TemplateVariables`.

### `src/plugins/trackers/builtin/json/template.hbs` (MODIFY)
Add verification errors block to prompt template.

## Verification

### Automated Checks (ALL must pass)
```bash
bun run typecheck    # Type check
bun run build        # Build check
bun test             # All existing tests pass
```

### Test Cases to Write
```typescript
// tests/engine/verification.test.ts
import { runVerification, formatVerificationErrors } from '../../src/engine/verification';

// - All commands pass → result.passed === true
// - First command fails → stops, result.passed === false
// - Timeout → result.passed === false with timeout error
// - Empty commands array → result.passed === true (vacuously true)
// - Format errors → readable multi-line string
```

### Manual Verification
- [ ] Create a project with `verification.commands: ["bun run typecheck"]` in ralph config
- [ ] Run a task that produces type errors — verify it retries with error context
- [ ] Run a task that passes verification — verify it completes normally
- [ ] Verify `--no-verify` or `verification.enabled: false` skips the gate

## Success Criteria
- [ ] Verification commands run after agent signals completion
- [ ] Failed verification prevents task from being marked done
- [ ] Verification errors are injected into the retry prompt
- [ ] Existing behavior unchanged when verification is disabled (default)
- [ ] New events emitted for TUI observability
- [ ] All existing tests still pass

## Scope Boundaries
**Do:** Verification gate, retry with error context, config, events
**Don't:** TUI display of verification status (that's TUI work), complex retry strategies, per-task verification overrides
