---
name: ralph-tui-create-json
description: "Convert PRDs to prd.json format for ralph-tui execution. Creates JSON task files with user stories, acceptance criteria, and dependencies. Triggers on: create prd.json, convert to json, ralph json, create json tasks."
---

# Ralph TUI - Create JSON Tasks

Converts PRDs to prd.json format for ralph-tui autonomous execution.

> **Note:** This skill is bundled with ralph-tui's JSON tracker plugin. Future tracker plugins (Linear, GitHub Issues, etc.) will bundle their own task creation skills.

---

## The Job

Take a PRD (markdown file or text) and create a prd.json file:
1. **Extract Quality Gates** from the PRD's "Quality Gates" section
2. Parse work items from the PRD
3. Map work item prefixes to `type` field (US-xxx → story, TA-xxx → task)
4. Append quality gates to each item's acceptance criteria
5. Set up dependencies between items
6. Output ready for `ralph-tui run --prd <path>`

---

## Step 1: Extract Quality Gates

Look for the "Quality Gates" section in the PRD:

```markdown
## Quality Gates

These commands must pass for every user story:
- `pnpm typecheck` - Type checking
- `pnpm lint` - Linting

For UI stories, also include:
- Verify in browser using dev-browser skill
```

Extract:
- **Universal gates:** Commands that apply to ALL stories (e.g., `pnpm typecheck`)
- **UI gates:** Commands that apply only to UI stories (e.g., browser verification)

**If no Quality Gates section exists:** Ask the user what commands should pass, or use a sensible default like `npm run typecheck`.

---

## Output Format

```json
{
  "name": "[Project name from PRD or directory]",
  "branchName": "ralph/[feature-name-kebab-case]",
  "description": "[Feature description from PRD]",
  "workItems": [
    {
      "id": "TA-001",
      "title": "[Task title]",
      "type": "task",
      "description": "Add [X] to support [feature Y]",
      "acceptanceCriteria": [
        "Criterion 1 from PRD",
        "Criterion 2 from PRD",
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
      "title": "[Story that depends on TA-001]",
      "type": "story",
      "description": "As a [user], I want [X] so that [Y]",
      "acceptanceCriteria": [
        "...",
        "pnpm typecheck passes",
        "pnpm lint passes",
        "Verify in browser using dev-browser skill"
      ],
      "priority": 2,
      "passes": false,
      "notes": "",
      "dependsOn": ["TA-001"]
    }
  ]
}
```

---

## Type Mapping

Map work item prefixes to the `type` field (case-insensitive):

| Prefix | `type` | Notes |
|--------|--------|-------|
| US-xxx | story | User-facing features ("As a user, I want...") |
| TA-xxx | task | Technical work (schema, backend, refactoring, bugs, maintenance) |
| other | task | Default for unknown prefixes (including legacy FR-xxx) |

**Backward compatibility:** The tracker also accepts `userStories` as an alias for `workItems` when reading, and `project` as an alias for `name`.

---

## Work Item Size: The #1 Rule

**Each work item must be completable in ONE ralph-tui iteration (~one agent context window).**

Ralph-tui spawns a fresh agent instance per iteration with no memory of previous work. If an item is too big, the agent runs out of context before finishing.

### Right-sized items:
- Add a database column + migration
- Add a UI component to an existing page
- Update a server action with new logic
- Add a filter dropdown to a list

### Too big (split these):
- "Build the entire dashboard" → Split into: schema, queries, UI components, filters
- "Add authentication" → Split into: schema, middleware, login UI, session handling
- "Refactor the API" → Split into one story per endpoint or pattern

**Rule of thumb:** If you can't describe the change in 2-3 sentences, it's too big.

---

## Dependencies with `dependsOn`

Use the `dependsOn` array to specify which items must complete first:

```json
{
  "id": "US-002",
  "title": "Create API endpoints",
  "type": "story",
  "dependsOn": ["TA-001"],  // Won't be selected until TA-001 passes
  ...
}
```

Ralph-tui will:
- Show US-002 as "blocked" until TA-001 completes
- Never select US-002 for execution while TA-001 is open
- Include "Prerequisites: TA-001" in the prompt when working on US-002

**Correct dependency order:**
1. Schema/database changes (no dependencies)
2. Backend logic (depends on schema)
3. UI components (depends on backend)
4. Integration/polish (depends on UI)

---

## Acceptance Criteria: Quality Gates + Item-Specific

Each item's acceptance criteria should include:
1. **Item-specific criteria** from the PRD (what this work item accomplishes)
2. **Quality gates** from the PRD's Quality Gates section (appended at the end)

### Good criteria (verifiable):
- "Add `status` column to tasks table with default 'open'"
- "Filter dropdown has options: All, Open, Closed"
- "Clicking delete shows confirmation dialog"

### Bad criteria (vague):
- ❌ "Works correctly"
- ❌ "User can do X easily"
- ❌ "Good UX"
- ❌ "Handles edge cases"

---

## Conversion Rules

1. **Extract Quality Gates** from PRD first
2. **Each work item → one JSON entry**
3. **IDs**: Use global counter with type prefix (US-001, TA-002, US-003)
4. **Type**: Map prefix to type (US-xxx → story, TA-xxx → task)
5. **Priority**: Based on dependency order (1 = highest)
6. **dependsOn**: Array of item IDs this item requires
7. **All items**: `passes: false` and empty `notes`
8. **branchName**: Derive from feature name, kebab-case, prefixed with `ralph/`
9. **Acceptance criteria**: Item criteria + quality gates appended
10. **UI items**: Also append UI-specific gates (browser verification)

---

## Output Location

Default: `./tasks/prd.json` (alongside the PRD markdown files)

This keeps all PRD-related files together in the `tasks/` directory.

Or specify a different path - ralph-tui will use it with:
```bash
ralph-tui run --prd ./path/to/prd.json
```

---

## Example

**Input PRD:**
```markdown
# PRD: Task Priority System

Add priority levels to tasks.

## Quality Gates

These commands must pass for every work item:
- `pnpm typecheck` - Type checking
- `pnpm lint` - Linting

For UI items, also include:
- Verify in browser using dev-browser skill

## Work Items

### TA-001: Add priority field to database
**Type:** task
**Description:** Add priority column to store task priority levels.

**Acceptance Criteria:**
- [ ] Add priority column: 1-4 (default 2)
- [ ] Migration runs successfully

### US-002: Display priority badge on task cards
**Type:** story
**Description:** As a user, I want to see task priority at a glance so I can focus on high-priority work.

**Acceptance Criteria:**
- [ ] Badge shows P1/P2/P3/P4 with colors
- [ ] Badge visible without hovering
**Depends on:** TA-001

### US-003: Add priority filter dropdown
**Type:** story
**Description:** As a user, I want to filter tasks by priority so I can focus on urgent items.

**Acceptance Criteria:**
- [ ] Filter dropdown: All, P1, P2, P3, P4
- [ ] Filter persists in URL
**Depends on:** US-002
```

**Output prd.json:**
```json
{
  "name": "my-app",
  "branchName": "ralph/task-priority",
  "description": "Add priority levels to tasks",
  "workItems": [
    {
      "id": "TA-001",
      "title": "Add priority field to database",
      "type": "task",
      "description": "Add priority column to store task priority levels.",
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
      "type": "story",
      "description": "As a user, I want to see task priority at a glance so I can focus on high-priority work.",
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
      "dependsOn": ["TA-001"]
    },
    {
      "id": "US-003",
      "title": "Add priority filter dropdown",
      "type": "story",
      "description": "As a user, I want to filter tasks by priority so I can focus on urgent items.",
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

---

## Running with ralph-tui

After creating prd.json:
```bash
ralph-tui run --prd ./tasks/prd.json
```

Ralph-tui will:
1. Load items from prd.json
2. Select the highest-priority item with `passes: false` and no blocking dependencies
3. Generate a prompt with item details + acceptance criteria
4. Run the agent to implement the item
5. Mark `passes: true` on completion
6. Repeat until all items pass

---

## Checklist Before Saving

- [ ] Extracted Quality Gates from PRD (or asked user if missing)
- [ ] Each work item completable in one iteration
- [ ] Work items ordered by dependency (schema → backend → UI)
- [ ] Mapped item prefixes to `type` field (US-xxx → story, TA-xxx → task)
- [ ] `dependsOn` correctly set for each item
- [ ] Quality gates appended to every item's acceptance criteria
- [ ] UI items have browser verification (if specified in Quality Gates)
- [ ] Acceptance criteria are verifiable (not vague)
- [ ] No circular dependencies
