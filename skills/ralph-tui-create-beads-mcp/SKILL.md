---
name: ralph-tui-create-beads-mcp
description: "Convert PRDs to beads using MCP server for ralph-tui execution. Creates an epic with child beads for each user story. REQUIRES beads MCP server to be configured. Use when you have a PRD and want to use ralph-tui with beads as the task source. Triggers on: create beads, convert prd to beads, beads for ralph, ralph beads."
---

# Ralph TUI - Create Beads (MCP Version)

Converts PRDs to beads (epic + child tasks) for ralph-tui autonomous execution using the beads MCP server.

> **CRITICAL REQUIREMENT:** This skill requires the beads MCP server to be configured and available. If the MCP server is not available, this skill will abort and instruct you to use the CLI-based `ralph-tui-create-beads` skill instead.

---

## Prerequisites Check

Before executing this skill, Claude MUST verify that the beads MCP server is available by checking for MCP tools with names starting with `beads_`.

**If MCP server is NOT available:**

```
❌ ERROR: Beads MCP server is not configured or unavailable.

This skill (ralph-tui-create-beads-mcp) requires the beads MCP server to be installed and configured in your Claude Desktop config.

Please either:
1. Install and configure the beads MCP server (see installation instructions below), OR
2. Use the CLI-based skill instead: ralph-tui-create-beads

Installation Instructions:
- Install: pip install beads-mcp
- Add to Claude Desktop config:
  {
    "mcpServers": {
      "beads": {
        "command": "beads-mcp"
      }
    }
  }
- Restart Claude Desktop

For more details, see: https://github.com/steveyegge/beads
```

**DO NOT PROCEED** if the MCP server is unavailable. Stop immediately and show the error message above.

---

## The Job

Take a PRD (markdown file or text) and create beads using MCP server tools:

1. **Extract Quality Gates** from the PRD's "Quality Gates" section
2. Create an **epic** bead for the feature using `beads_create_issue`
3. Create **child beads** for each user story using `beads_create_issue` with parent reference
4. Set up **dependencies** between beads using `beads_dep`
5. Output ready for ralph-tui run --tracker beads

---

## Step 1: Verify MCP Server Availability

**FIRST STEP - MANDATORY:**

Check if beads MCP tools are available. Look for tools like:

- `beads_create_issue`
- `beads_dep`
- `beads_list_issues`
- `beads_show_issue`

If these tools are NOT available, **STOP IMMEDIATELY** and display the error message from the Prerequisites Check section above.

---

## Step 2: Extract Quality Gates

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

- **Universal gates:** Commands that apply to ALL stories (e.g., pnpm typecheck)
- **UI gates:** Commands that apply only to UI stories (e.g., browser verification)

**If no Quality Gates section exists:** Ask the user what commands should pass, or use a sensible default like `npm run typecheck`.

---

## Step 3: Create Epic Using MCP

Use the `beads_create_issue` MCP tool with `issue_type="epic"`:

```python
# Example MCP call
beads_create_issue(
    title="[Feature Name]",
    description="[Feature description from PRD]",
    issue_type="epic",
    labels=["ralph", "feature"],
    external_ref="prd:./tasks/feature-name-prd.md",
    workspace_root="/path/to/project"  # Optional, for multi-repo setups
)
```

**Capture the returned issue ID** (e.g., `ralph-tui-001`) - you'll need it as the parent for child beads.
If you can't provide the external_ref then put it in description that it can be read by providing the relative path.

---

## Step 4: Create Child Beads Using MCP

For each user story, use `beads_create_issue` with the epic as parent:

```python
# Example MCP call
beads_create_issue(
    title="US-001: [Story Title]",
    description="""As a [user], I want to [goal].

## Acceptance Criteria
- [ ] [Story-specific criterion 1]
- [ ] [Story-specific criterion 2]
- [ ] pnpm typecheck passes
- [ ] pnpm lint passes
- [ ] Verify in browser using dev-browser skill  # Only for UI stories
""",
    parent="ralph-tui-001",  # Epic ID from Step 3
    priority=1,  # 1-4 based on dependency order
    labels=["ralph", "task"],
    workspace_root="/path/to/project"  # Optional
)
```

**Capture each child issue ID** (e.g., `ralph-tui-002`, `ralph-tui-003`) for setting up dependencies.

---

## Step 5: Set Up Dependencies Using MCP

Use the `beads_dep` MCP tool to establish dependency relationships:

```python
# Syntax: beads_dep(issue, blocker, relationship, workspace_root)
# The "issue" depends on (is blocked by) the "blocker"

# Example: US-002 depends on US-001
beads_dep(
    issue="ralph-tui-002",
    blocker="ralph-tui-001",
    relationship="blocks",
    workspace_root="/path/to/project"  # Optional
)

# Example: US-003 depends on US-002
beads_dep(
    issue="ralph-tui-003",
    blocker="ralph-tui-002",
    relationship="blocks",
    workspace_root="/path/to/project"  # Optional
)
```

**Dependency order:**

1. Schema/database changes (no dependencies)
2. Backend logic (depends on schema)
3. UI components (depends on backend)
4. Integration/polish (depends on UI)

---

## Story Size: The #1 Rule

**Each story must be completable in ONE ralph-tui iteration (~one agent context window).**

ralph-tui spawns a fresh agent instance per iteration with no memory of previous work. If a story is too big, the agent runs out of context before finishing.

### Right-sized stories:

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

## Story Ordering: Dependencies First

Stories execute in dependency order. Earlier stories must not depend on later ones.

**Correct order:**

1. Schema/database changes (migrations)
2. Server actions / backend logic
3. UI components that use the backend
4. Dashboard/summary views that aggregate data

**Wrong order:**

1. ❌ UI component (depends on schema that doesn't exist yet)
2. ❌ Schema change

---

## Acceptance Criteria: Quality Gates + Story-Specific

Each bead's description should include acceptance criteria with:

1. **Story-specific criteria** from the PRD (what this story accomplishes)
2. **Quality gates** from the PRD's Quality Gates section (appended at the end)

### Good criteria (verifiable):

- "Add investorType column to investor table with default 'cold'"
- "Filter dropdown has options: All, Cold, Friend"
- "Clicking toggle shows confirmation dialog"

### Bad criteria (vague):

- ❌ "Works correctly"
- ❌ "User can do X easily"
- ❌ "Good UX"
- ❌ "Handles edge cases"

---

## Conversion Rules

1. **Verify MCP server is available** (CRITICAL - stop if not available)
2. **Extract Quality Gates** from PRD first
3. **Create epic** using `beads_create_issue` with `issue_type="epic"`
4. **Each user story → one child bead** using `beads_create_issue` with `parent=epic_id`
5. **First story**: No dependencies (creates foundation)
6. **Subsequent stories**: Add dependencies using `beads_dep` (UI depends on backend, etc.)
7. **Priority**: Based on dependency order, then document order (1=high, 2=medium, 3=normal, 4=low)
8. **Labels**: Epic gets `["ralph", "feature"]`; Tasks get `["ralph", "task"]`
9. **Acceptance criteria**: Story criteria + quality gates appended
10. **UI stories**: Also append UI-specific gates (browser verification)

---

## Splitting Large PRDs

If a PRD has big features, split them:

**Original:**

> "Add friends outreach track with different messaging"

**Split into:**

1. US-001: Add investorType field to database
2. US-002: Add type toggle to investor list UI
3. US-003: Create friend-specific phase progression logic
4. US-004: Create friend message templates
5. US-005: Wire up task generation for friends
6. US-006: Add filter by type
7. US-007: Update new investor form
8. US-008: Update dashboard counts

Each is one focused change that can be completed and verified independently.

---

## Example Execution

**Input PRD:**

```markdown
# PRD: Friends Outreach

Add ability to mark investors as "friends" for warm outreach.

## Quality Gates

These commands must pass for every user story:

- `pnpm typecheck` - Type checking
- `pnpm lint` - Linting

For UI stories, also include:

- Verify in browser using dev-browser skill

## User Stories

### US-001: Add investorType field to investor table

**Description:** As a developer, I need to categorize investors as 'cold' or 'friend'.

**Acceptance Criteria:**

- [ ] Add investorType column: 'cold' | 'friend' (default 'cold')
- [ ] Generate and run migration successfully

### US-002: Add type toggle to investor list rows

**Description:** As Ryan, I want to toggle investor type directly from the list.

**Acceptance Criteria:**

- [ ] Each row has Cold | Friend toggle
- [ ] Switching shows confirmation dialog
- [ ] On confirm: updates type in database

### US-003: Filter investors by type

**Description:** As Ryan, I want to filter the list to see just friends or cold.

**Acceptance Criteria:**

- [ ] Filter dropdown: All | Cold | Friend
- [ ] Filter persists in URL params
```

**MCP Execution Steps:**

```python
# Step 1: Check MCP availability (MANDATORY)
# If beads_create_issue, beads_dep not available → ABORT with error message

# Step 2: Create Epic
epic_result = beads_create_issue(
    title="Friends Outreach Track",
    description="Warm outreach for deck feedback",
    issue_type="epic",
    labels=["ralph", "feature"],
    external_ref="prd:./tasks/friends-outreach-prd.md"
)
epic_id = epic_result.id  # e.g., "ralph-tui-001"
If you can't provide the external_ref then put it in description that it can be read by providing the relative path.

# Step 3: Create US-001 (no dependencies)
us001_result = beads_create_issue(
    title="US-001: Add investorType field to investor table",
    description="""As a developer, I need to categorize investors as 'cold' or 'friend'.

## Acceptance Criteria
- [ ] Add investorType column: 'cold' | 'friend' (default 'cold')
- [ ] Generate and run migration successfully
- [ ] pnpm typecheck passes
- [ ] pnpm lint passes""",
    parent=epic_id,
    priority=1,
    labels=["ralph", "task"]
)
us001_id = us001_result.id  # e.g., "ralph-tui-002"

# Step 4: Create US-002 (UI story - includes browser verification)
us002_result = beads_create_issue(
    title="US-002: Add type toggle to investor list rows",
    description="""As Ryan, I want to toggle investor type directly from the list.

## Acceptance Criteria
- [ ] Each row has Cold | Friend toggle
- [ ] Switching shows confirmation dialog
- [ ] On confirm: updates type in database
- [ ] pnpm typecheck passes
- [ ] pnpm lint passes
- [ ] Verify in browser using dev-browser skill""",
    parent=epic_id,
    priority=2,
    labels=["ralph", "task"]
)
us002_id = us002_result.id  # e.g., "ralph-tui-003"

# Step 5: Add dependency - US-002 depends on US-001
beads_dep(
    issue=us002_id,
    blocker=us001_id,
    relationship="blocks"
)

# Step 6: Create US-003 (UI story)
us003_result = beads_create_issue(
    title="US-003: Filter investors by type",
    description="""As Ryan, I want to filter the list to see just friends or cold.

## Acceptance Criteria
- [ ] Filter dropdown: All | Cold | Friend
- [ ] Filter persists in URL params
- [ ] pnpm typecheck passes
- [ ] pnpm lint passes
- [ ] Verify in browser using dev-browser skill""",
    parent=epic_id,
    priority=3,
    labels=["ralph", "task"]
)
us003_id = us003_result.id  # e.g., "ralph-tui-004"

# Step 7: Add dependency - US-003 depends on US-002
beads_dep(
    issue=us003_id,
    blocker=us002_id,
    relationship="blocks"
)
```

---

## Multi-Repository Support

The beads MCP server supports multi-repository setups. Use the `workspace_root` parameter to target specific projects:

```python
# Create beads in project A
beads_create_issue(
    title="Feature A",
    description="...",
    workspace_root="/Users/you/project-a"
)

# Create beads in project B
beads_create_issue(
    title="Feature B",
    description="...",
    workspace_root="/Users/you/project-b"
)
```

**Note:** The MCP server automatically routes to per-project local daemons, ensuring complete database isolation between projects.

---

## After Creation

After all beads are created, the user can run ralph-tui:

```bash
# Work on a specific epic
ralph-tui run --tracker beads --epic ralph-tui-001

# Or let it pick the best task automatically
ralph-tui run --tracker beads
```

ralph-tui will:

1. Work on beads within the specified epic (or select the best available task)
2. Close each bead when complete
3. Close the epic when all children are done
4. Output `<promise>COMPLETE</promise>` when epic is done

---

## Checklist Before Creating Beads

- [ ] **MCP server availability verified** (CRITICAL - abort if not available)
- [ ] Extracted Quality Gates from PRD (or asked user if missing)
- [ ] Each story is completable in one iteration (small enough)
- [ ] Stories are ordered by dependency (schema → backend → UI)
- [ ] Quality gates appended to every bead's acceptance criteria
- [ ] UI stories have browser verification (if specified in Quality Gates)
- [ ] Acceptance criteria are verifiable (not vague)
- [ ] No story depends on a later story (only earlier stories)
- [ ] Dependencies added with `beads_dep` after creating beads
- [ ] Epic created with `issue_type="epic"`
- [ ] All child beads have `parent` set to epic ID

---

## Error Handling

**If MCP server is not available:**

```
❌ CRITICAL ERROR: Cannot proceed without beads MCP server.

This skill requires the beads MCP server to be installed and configured.
Please use the CLI-based skill 'ralph-tui-create-beads' instead, or install
the MCP server following the instructions above.
```

**If MCP tool calls fail:**

- Display the error message from the MCP server
- Suggest checking the beads daemon status
- Provide troubleshooting steps (restart daemon, check workspace path, etc.)

---

## Differences from CLI Version

This MCP version differs from the CLI-based `ralph-tui-create-beads` skill:

1. **Uses MCP tools** instead of bash commands (`bd create`, `bd dep add`)
2. **Requires MCP server** to be configured (strictly enforced)
3. **Returns issue objects** from MCP calls (not just command output)
4. **Supports multi-repo** via `workspace_root` parameter
5. **Lower latency** in MCP-enabled environments (no shell overhead)

**When to use MCP version:**

- Claude Desktop with MCP server configured
- Multi-repository workflows
- When you want structured responses from bead creation

**When to use CLI version:**

- Claude Code, Cursor, Windsurf (shell access available)
- Environments without MCP server
- Lower token usage requirements (~1-2k vs 10-50k)

---

## Summary

This skill provides a **strict MCP-based** workflow for converting PRDs to beads:

1. ✅ **Verify** MCP server availability (abort if missing)
2. 📝 **Extract** quality gates from PRD
3. 🎯 **Create** epic using `beads_create_issue`
4. 📋 **Create** child beads for each user story
5. 🔗 **Link** dependencies using `beads_dep`
6. 🚀 Ready for `ralph-tui run --tracker beads`

**Remember:** If the MCP server is not available, this skill will ABORT and instruct you to use `ralph-tui-create-beads` (CLI version) instead.
