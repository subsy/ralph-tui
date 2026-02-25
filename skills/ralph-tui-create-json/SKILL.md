---
name: ralph-tui-create-json
description: "Convert PRDs to prd.json format for ralph-tui execution. Creates JSON task files with user stories, acceptance criteria, and dependencies. Triggers on: create prd.json, convert to json, ralph json, create json tasks."
---

# Ralph TUI - Create JSON Tasks

Converts PRDs to prd.json format for ralph-tui autonomous execution.

> **Note:** This skill is bundled with ralph-tui's JSON tracker plugin. Future tracker plugins (Linear, GitHub Issues, etc.) will bundle their own task creation skills.

> **⚠️ CRITICAL:** The output MUST be a FLAT JSON object with "name" and "userStories" at the ROOT level. DO NOT wrap content in a "prd" object or use "tasks" array. See [ANTI_PATTERNS.md](ANTI_PATTERNS.md) for common mistakes.

---

## The Job

Take a PRD (markdown file or text) and create a prd.json file:
1. **Extract Quality Gates** from the PRD's "Quality Gates" section
2. Parse user stories from the PRD
3. Append quality gates to each story's acceptance criteria
4. Set up dependencies between stories
5. Output ready for `ralph-tui run --prd <path>`

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

The JSON file MUST be a FLAT object at the root level with "name" and "userStories":

```json
{
  "name": "[Project name from PRD or directory]",
  "branchName": "ralph/[feature-name-kebab-case]",
  "description": "[Feature description from PRD]",
  "userStories": [
    {
      "id": "US-001",
      "title": "[Story title]",
      "description": "As a [user], I want [feature] so that [benefit]",
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
      "title": "[UI Story that depends on US-001]",
      "description": "...",
      "acceptanceCriteria": [
        "...",
        "pnpm typecheck passes",
        "pnpm lint passes",
        "Verify in browser using dev-browser skill"
      ],
      "priority": 2,
      "passes": false,
      "notes": "",
      "dependsOn": ["US-001"]
    }
  ]
}
```

---

## Story Size: The #1 Rule

Each story must be completable in ONE ralph-tui iteration. Right-sized: single column/component/endpoint. Too big: entire dashboard/auth system (split these).

---

## Dependencies with `dependsOn`

Use the `dependsOn` array to specify which stories must complete first. Ralph-tui will show stories as "blocked" until dependencies complete.

```json
{
  "id": "US-002",
  "title": "Create API endpoints",
  "dependsOn": ["US-001"],
  ...
}
```

**Correct dependency order:** Schema/database → backend → UI → integration.

---

## Acceptance Criteria: Quality Gates + Story-Specific

Each story's acceptance criteria should include story-specific criteria from the PRD, plus quality gates appended from the Quality Gates section.

---

## Conversion Rules

1. **Extract Quality Gates** from PRD first
2. **Each user story → one JSON entry**
3. **IDs**: Sequential (US-001, US-002, etc.)
4. **Priority**: Based on dependency order (1 = highest)
5. **dependsOn**: Array of story IDs this story requires
6. **All stories**: `passes: false` and empty `notes`
7. **branchName**: Derive from feature name, kebab-case, prefixed with `ralph/`
8. **Acceptance criteria**: Story criteria + quality gates appended
9. **UI stories**: Also append UI-specific gates (browser verification)

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

See [EXAMPLES.md](EXAMPLES.md) for a complete PRD-to-JSON conversion example.

---

## Running with ralph-tui

After creating prd.json:
```bash
ralph-tui run --prd ./tasks/prd.json
```

---

## Checklist Before Saving

- [ ] Extracted Quality Gates from PRD
- [ ] Stories ordered by dependency (schema → backend → UI)
- [ ] `dependsOn` correctly set for each story
