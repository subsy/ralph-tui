# Examples

## Full PRD-to-JSON Conversion Example

**Input PRD:**
```markdown
# PRD: Task Priority System

Add priority levels to tasks.

## Quality Gates

These commands must pass for every user story:
- `pnpm typecheck` - Type checking
- `pnpm lint` - Linting

For UI stories, also include:
- Verify in browser using dev-browser skill

## User Stories

### US-001: Add priority field to database
**Description:** As a developer, I need to store task priority.

**Acceptance Criteria:**
- [ ] Add priority column: 1-4 (default 2)
- [ ] Migration runs successfully

### US-002: Display priority badge on task cards
**Description:** As a user, I want to see task priority at a glance.

**Acceptance Criteria:**
- [ ] Badge shows P1/P2/P3/P4 with colors
- [ ] Badge visible without hovering

### US-003: Add priority filter dropdown
**Description:** As a user, I want to filter tasks by priority.

**Acceptance Criteria:**
- [ ] Filter dropdown: All, P1, P2, P3, P4
- [ ] Filter persists in URL
```

**Output prd.json:**
```json
{
  "name": "Task Priority System",
  "branchName": "ralph/task-priority",
  "description": "Add priority levels to tasks",
  "userStories": [
    {
      "id": "US-001",
      "title": "Add priority field to database",
      "description": "As a developer, I need to store task priority.",
      "acceptanceCriteria": [
        "Add priority column: 1-4 (default 2)",
        "Migration runs successfully",
        "pnpm typecheck passes",
        "pnpm lint passes"
      ],
      "priority": 1,
      "passes": false,
      "notes": "",
      "dependsOn": []
    },
    {
      "id": "US-002",
      "title": "Display priority badge on task cards",
      "description": "As a user, I want to see task priority at a glance.",
      "acceptanceCriteria": [
        "Badge shows P1/P2/P3/P4 with colors",
        "Badge visible without hovering",
        "pnpm typecheck passes",
        "pnpm lint passes",
        "Verify in browser using dev-browser skill"
      ],
      "priority": 2,
      "passes": false,
      "notes": "",
      "dependsOn": ["US-001"]
    },
    {
      "id": "US-003",
      "title": "Add priority filter dropdown",
      "description": "As a user, I want to filter tasks by priority.",
      "acceptanceCriteria": [
        "Filter dropdown: All, P1, P2, P3, P4",
        "Filter persists in URL",
        "pnpm typecheck passes",
        "pnpm lint passes",
        "Verify in browser using dev-browser skill"
      ],
      "priority": 3,
      "passes": false,
      "notes": "",
      "dependsOn": ["US-002"]
    }
  ]
}
```
