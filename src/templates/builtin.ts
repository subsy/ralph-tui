/**
 * ABOUTME: Built-in prompt templates as embedded strings.
 * These templates are bundled with the package and used as defaults.
 */

/**
 * Default template - used when no tracker-specific template is available.
 */
export const DEFAULT_TEMPLATE = `## Task
**ID**: {{taskId}}
**Title**: {{taskTitle}}

{{#if taskDescription}}
## Description
{{taskDescription}}
{{/if}}

{{#if acceptanceCriteria}}
## Acceptance Criteria
{{acceptanceCriteria}}
{{/if}}

{{#if labels}}
**Labels**: {{labels}}
{{/if}}

{{#if dependsOn}}
**Dependencies**: {{dependsOn}}
{{/if}}

{{#if recentProgress}}
## Previous Progress
{{recentProgress}}
{{/if}}

## Instructions
Complete the task described above.

**IMPORTANT**: If the work is already complete (implemented in a previous iteration or already exists), verify it works correctly and signal completion immediately.

When finished (or if already complete), signal completion with:
<promise>COMPLETE</promise>
`;

/**
 * Beads tracker template - optimized for bead-based workflows.
 * Context-first structure: PRD → Patterns → Task → Workflow
 */
export const BEADS_TEMPLATE = `{{!-- Full PRD for project context (agent studies this first) --}}
{{#if prdContent}}
## PRD: {{prdName}}
{{#if prdDescription}}
{{prdDescription}}
{{/if}}

### Progress: {{prdCompletedCount}}/{{prdTotalCount}} tasks complete

<details>
<summary>Full PRD Document (click to expand)</summary>

{{prdContent}}

</details>
{{/if}}

{{!-- Learnings from previous iterations (patterns first) --}}
{{#if codebasePatterns}}
## Codebase Patterns (Study These First)
{{codebasePatterns}}
{{/if}}

## Bead Details
- **ID**: {{taskId}}
- **Title**: {{taskTitle}}
{{#if epicId}}
- **Epic**: {{epicId}}{{#if epicTitle}} - {{epicTitle}}{{/if}}
{{/if}}
{{#if taskDescription}}
- **Description**: {{taskDescription}}
{{/if}}

{{#if acceptanceCriteria}}
## Acceptance Criteria
{{acceptanceCriteria}}
{{/if}}

{{#if dependsOn}}
**Prerequisites**: {{dependsOn}}
{{/if}}

{{#if recentProgress}}
## Recent Progress
{{recentProgress}}
{{/if}}

## Workflow
1. Study the PRD context above to understand the bigger picture (if available)
2. Study \`.ralph-tui/progress.md\` to understand overall status, implementation progress, and learnings including codebase patterns and gotchas
3. Implement the requirements (stay on current branch)
4. Run your project's quality checks (typecheck, lint, etc.)
5. Commit: \`feat: {{taskId}} - {{taskTitle}}\`
6. Close the bead: \`bd close {{taskId}} --db {{beadsDbPath}} --reason "Brief description"\`
7. Document learnings (see below)
8. Signal completion

## Before Completing
APPEND to \`.ralph-tui/progress.md\`:
\`\`\`
## [Date] - {{taskId}}
- What was implemented
- Files changed
- **Learnings:**
  - Patterns discovered
  - Gotchas encountered
---
\`\`\`

If you discovered a **reusable pattern**, also add it to the \`## Codebase Patterns\` section at the TOP of progress.md.

## Stop Condition
**IMPORTANT**: If the work is already complete (implemented in a previous iteration or already exists), verify it works correctly and signal completion immediately.

When finished (or if already complete), signal completion with:
<promise>COMPLETE</promise>
`;

/**
 * Beads + bv tracker template - includes extra context from intelligent selection.
 * Context-first structure: PRD → Selection Context → Patterns → Task → Workflow
 */
export const BEADS_BV_TEMPLATE = `{{!-- Full PRD for project context (agent studies this first) --}}
{{#if prdContent}}
## PRD: {{prdName}}
{{#if prdDescription}}
{{prdDescription}}
{{/if}}

### Progress: {{prdCompletedCount}}/{{prdTotalCount}} tasks complete

<details>
<summary>Full PRD Document (click to expand)</summary>

{{prdContent}}

</details>
{{/if}}

{{!-- Why this task was selected (bv context) --}}
{{#if selectionReason}}
## Why This Task Was Selected
{{selectionReason}}
{{/if}}

{{!-- Learnings from previous iterations (patterns first) --}}
{{#if codebasePatterns}}
## Codebase Patterns (Study These First)
{{codebasePatterns}}
{{/if}}

## Bead Details
- **ID**: {{taskId}}
- **Title**: {{taskTitle}}
{{#if epicId}}
- **Epic**: {{epicId}}{{#if epicTitle}} - {{epicTitle}}{{/if}}
{{/if}}
{{#if taskDescription}}
- **Description**: {{taskDescription}}
{{/if}}

{{#if acceptanceCriteria}}
## Acceptance Criteria
{{acceptanceCriteria}}
{{/if}}

{{#if dependsOn}}
## Dependencies
This task depends on: {{dependsOn}}
{{/if}}

{{#if blocks}}
## Impact
Completing this task will unblock: {{blocks}}
{{/if}}

{{#if recentProgress}}
## Recent Progress
{{recentProgress}}
{{/if}}

## Workflow
1. Study the PRD context above to understand the bigger picture (if available)
2. Study \`.ralph-tui/progress.md\` to understand overall status, implementation progress, and learnings including codebase patterns and gotchas
3. Implement the requirements (stay on current branch)
4. Run your project's quality checks (typecheck, lint, etc.)
5. Commit: \`feat: {{taskId}} - {{taskTitle}}\`
6. Close the bead: \`bd close {{taskId}} --db {{beadsDbPath}} --reason "Brief description"\`
7. Document learnings (see below)
8. Signal completion

## Before Completing
APPEND to \`.ralph-tui/progress.md\`:
\`\`\`
## [Date] - {{taskId}}
- What was implemented
- Files changed
- **Learnings:**
  - Patterns discovered
  - Gotchas encountered
---
\`\`\`

If you discovered a **reusable pattern**, also add it to the \`## Codebase Patterns\` section at the TOP of progress.md.

## Stop Condition
**IMPORTANT**: If the work is already complete (implemented in a previous iteration or already exists), verify it works correctly and signal completion immediately.

When finished (or if already complete), signal completion with:
<promise>COMPLETE</promise>
`;

/**
 * JSON (prd.json) tracker template - structured for PRD user stories.
 * Context-first structure: PRD → Patterns → Task → Workflow
 */
export const JSON_TEMPLATE = `{{!-- Full PRD for project context (agent studies this first) --}}
{{#if prdContent}}
## PRD: {{prdName}}
{{#if prdDescription}}
{{prdDescription}}
{{/if}}

### Progress: {{prdCompletedCount}}/{{prdTotalCount}} stories complete

<details>
<summary>Full PRD Document (click to expand)</summary>

{{prdContent}}

</details>
{{/if}}

{{!-- Learnings from previous iterations (patterns first) --}}
{{#if codebasePatterns}}
## Codebase Patterns (Study These First)
{{codebasePatterns}}
{{/if}}

{{!-- Task details --}}
## Your Task: {{taskId}} - {{taskTitle}}

{{#if taskDescription}}
### Description
{{taskDescription}}
{{/if}}

{{#if acceptanceCriteria}}
### Acceptance Criteria
{{acceptanceCriteria}}
{{/if}}

{{#if notes}}
### Notes
{{notes}}
{{/if}}

{{#if dependsOn}}
**Prerequisites**: {{dependsOn}}
{{/if}}

{{#if recentProgress}}
## Recent Progress
{{recentProgress}}
{{/if}}

## Workflow
1. Study the PRD context above to understand the bigger picture
2. Study \`.ralph-tui/progress.md\` to understand overall status, implementation progress, and learnings including codebase patterns and gotchas
3. Implement this single story following acceptance criteria
4. Run quality checks: typecheck, lint, etc.
5. Commit with message: \`feat: {{taskId}} - {{taskTitle}}\`
6. Document learnings (see below)
7. Signal completion

## Before Completing
APPEND to \`.ralph-tui/progress.md\`:
\`\`\`
## [Date] - {{taskId}}
- What was implemented
- Files changed
- **Learnings:**
  - Patterns discovered
  - Gotchas encountered
---
\`\`\`

If you discovered a **reusable pattern**, also add it to the \`## Codebase Patterns\` section at the TOP of progress.md.

## Stop Condition
**IMPORTANT**: If the work is already complete (implemented in a previous iteration or already exists), verify it meets the acceptance criteria and signal completion immediately.

When finished (or if already complete), signal completion with:
<promise>COMPLETE</promise>
`;
