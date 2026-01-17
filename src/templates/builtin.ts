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
 */
export const BEADS_TEMPLATE = `## Bead Details
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

{{#if recentProgress}}
## Previous Progress
{{recentProgress}}
{{/if}}

## Instructions
1. Implement the requirements (stay on current branch)
2. Run your project's quality checks (typecheck, lint, etc.)
3. Commit: feat: {{taskId}} - {{taskTitle}}
4. Close the bead when done: bd close {{taskId}} --db {{beadsDbPath}} --reason "Brief description"

**IMPORTANT**: If the work is already complete (implemented in a previous iteration or already exists), verify it works correctly and signal completion immediately.

When finished (or if already complete), signal completion with:
<promise>COMPLETE</promise>
`;

/**
 * Beads + bv tracker template - includes extra context from intelligent selection.
 */
export const BEADS_BV_TEMPLATE = `## Bead Details
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
## Previous Progress
{{recentProgress}}
{{/if}}

## Instructions
1. Implement the requirements (stay on current branch)
2. Run your project's quality checks (typecheck, lint, etc.)
3. Commit: feat: {{taskId}} - {{taskTitle}}
4. Close the bead when done: bd close {{taskId}} --db {{beadsDbPath}} --reason "Brief description"

**IMPORTANT**: If the work is already complete (implemented in a previous iteration or already exists), verify it works correctly and signal completion immediately.

When finished (or if already complete), signal completion with:
<promise>COMPLETE</promise>
`;

/**
 * JSON (prd.json) tracker template - structured for PRD user stories.
 */
export const JSON_TEMPLATE = `## User Story
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

{{#if notes}}
## Notes
{{notes}}
{{/if}}

{{#if dependsOn}}
**Prerequisites**: {{dependsOn}}
{{/if}}

{{#if recentProgress}}
## Previous Progress
{{recentProgress}}
{{/if}}

## Instructions
1. Implement this user story following the acceptance criteria
2. Run your project's quality checks (typecheck, lint, etc.)
3. Commit your changes with a descriptive message
4. The story will be marked as complete when you signal completion

**IMPORTANT**: If the work is already complete (implemented in a previous iteration or already exists), verify it meets the acceptance criteria and signal completion immediately.

When finished (or if already complete), signal completion with:
<promise>COMPLETE</promise>
`;
