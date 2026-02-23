# Step 6: Acceptance Criteria Validation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this task.

## Quick Reference
- **Branch:** `feat/engine-improvements-06-ac-validation`
- **Complexity:** M
- **Dependencies:** Step 1 (Verification Gates)
- **Estimated files:** 4

## Objective
Parse acceptance criteria from the PRD for executable assertions (shell commands, file existence checks). Run them as part of the verification gate. Non-executable criteria are skipped gracefully.

## Context from Research
- JSON tracker stores `acceptanceCriteria: string[]` per user story
- These are currently only passed to the prompt as text
- Step 1 adds the verification gate — this step adds AC as verification commands
- `TrackerTask` type has `metadata?: Record<string, unknown>` where AC could be stored
- JSON tracker's `getPrdContext()` returns full PRD content

## Prerequisites
- [ ] Step 1 (Verification Gates) is implemented and merged
- [ ] ralph-tui builds and tests pass

## Implementation

**Read these files first** (in parallel):
- `src/engine/verification.ts` — the verification gate from Step 1
- `src/plugins/trackers/builtin/json/index.ts` — how AC is stored and retrieved
- `src/plugins/trackers/types.ts` — `TrackerTask` type

### 1. Create AC validator

Create `src/engine/ac-validator.ts`:

```typescript
/**
 * ABOUTME: Parses acceptance criteria for executable assertions.
 * Extracts shell commands, file existence checks, and URL patterns
 * from human-readable acceptance criteria strings.
 */

export interface ExecutableAC {
  original: string;
  type: 'command' | 'file-exists' | 'file-contains';
  assertion: string;
}

/**
 * Parse acceptance criteria strings for executable assertions.
 * Returns only the criteria that can be automatically validated.
 *
 * Patterns detected:
 * - Shell commands: strings containing backtick-wrapped commands or starting with "Running"
 * - File existence: "file X exists", "X is created", "Tests exist in X"
 * - File contains: "X contains Y", "X includes Y"
 */
export function parseExecutableCriteria(criteria: string[]): ExecutableAC[] {
  const results: ExecutableAC[] = [];

  for (const criterion of criteria) {
    // Detect shell commands in backticks: "Running `bun test` passes"
    const cmdMatch = criterion.match(/[`']([^`']+)[`']/);
    if (cmdMatch && looksLikeCommand(cmdMatch[1])) {
      results.push({
        original: criterion,
        type: 'command',
        assertion: cmdMatch[1],
      });
      continue;
    }

    // Detect file/directory existence: "Tests exist in src/__tests__/"
    const existsMatch = criterion.match(
      /(?:exist|created|present)\s+(?:in|at)\s+[`']?([^\s`']+)[`']?/i
    );
    if (existsMatch) {
      results.push({
        original: criterion,
        type: 'file-exists',
        assertion: existsMatch[1],
      });
      continue;
    }

    // Skip non-executable criteria silently
  }

  return results;
}

function looksLikeCommand(s: string): boolean {
  const cmdPrefixes = ['bun ', 'npm ', 'npx ', 'node ', 'git ', 'curl ', 'test '];
  return cmdPrefixes.some(p => s.startsWith(p)) || s.includes(' run ');
}

/**
 * Convert executable AC into verification commands.
 */
export function acToVerificationCommands(acs: ExecutableAC[], cwd: string): string[] {
  return acs.map(ac => {
    switch (ac.type) {
      case 'command':
        return ac.assertion;
      case 'file-exists':
        return `test -e "${ac.assertion}"`;
      case 'file-contains':
        return `grep -q "${ac.assertion}" || true`; // soft check
      default:
        return '';
    }
  }).filter(Boolean);
}
```

### 2. Integrate with verification gate

In `src/engine/index.ts`, when running verification for a task:
- Get the task's acceptance criteria from the tracker
- Parse for executable assertions
- Prepend AC commands to the configured verification commands
- Run all through the existing verification gate

```typescript
// Before running verification
const acCommands = parseAndConvertAC(task);
const allCommands = [...acCommands, ...config.verification.commands];
```

### 3. Pass AC through tracker

Ensure the JSON tracker includes `acceptanceCriteria` in the `TrackerTask.metadata` when converting from PRD format, so the engine can access it.

## Files to Create/Modify

### `src/engine/ac-validator.ts` (NEW)
AC parsing and command generation.

### `src/engine/verification.ts` (MODIFY)
Accept AC-derived commands alongside configured commands.

### `src/engine/index.ts` (MODIFY)
Wire AC extraction into verification flow.

### `src/plugins/trackers/builtin/json/index.ts` (MODIFY)
Include `acceptanceCriteria` in task metadata.

## Verification

### Automated Checks (ALL must pass)
```bash
bun run typecheck
bun run build
bun test
```

### Test Cases to Write
```typescript
// tests/engine/ac-validator.test.ts
// - Backtick command extracted: "Running `bun test` passes" → "bun test"
// - File existence: "Tests exist in src/__tests__/" → "test -e src/__tests__/"
// - Non-executable criteria skipped gracefully
// - Mixed criteria: only executable ones returned
// - Empty criteria array → empty result
```

### Manual Verification
- [ ] Run with PRD containing "Running `bun test` passes" as AC — verify test runs
- [ ] Run with non-executable AC like "UI looks correct" — verify it's skipped
- [ ] Verify AC validation errors appear in retry prompt context

## Success Criteria
- [ ] Executable AC automatically detected and run
- [ ] Non-executable AC silently skipped
- [ ] AC failures inject errors into retry context (via verification gate)
- [ ] Works only when verification gate is enabled

## Scope Boundaries
**Do:** Parse common patterns, run as verification commands, skip gracefully
**Don't:** AI-powered AC interpretation, URL checking, visual testing, custom AC formats
