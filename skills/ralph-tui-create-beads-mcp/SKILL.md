---
name: ralph-tui-create-beads-mcp
description: "Convert PRDs to beads using MCP server for ralph-tui execution. Creates an epic with child beads for each user story. REQUIRES beads MCP server to be configured. Use when you have a PRD and want to use ralph-tui with beads as the task source. Triggers on: create beads, convert prd to beads, beads for ralph, ralph beads."
---

# Ralph TUI - Create Beads (MCP Version)

Converts PRDs to beads (epic + child tasks) for ralph-tui autonomous execution using the beads MCP server.

> **CRITICAL REQUIREMENT:** This skill requires the beads MCP server to be configured and available. If the MCP server is not available, this skill will abort and instruct you to use the CLI-based `ralph-tui-create-beads` skill instead.

---

## Prerequisites Check

Before executing this skill, Claude MUST verify that the beads MCP server is available.

**Discovery Process:**

1. **First, check for beads tools** by looking for tools with names starting with `beads_`
2. **If tools are found**, use `beads_discover_tools` and `beads_get_tool_info` to get accurate tool signatures
3. **If no tools are found**, abort with error message

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

## CRITICAL: Tool Discovery Required

**You MUST run tool discovery before creating beads:**

1. Run `beads_discover_tools()` to see all available tools
2. Run `beads_get_tool_info(tool_name="create")` to get the exact parameter names for creating issues
3. Run `beads_get_tool_info(tool_name="dep")` to get the exact parameter names for dependencies

**Why this is critical:**

- Tool parameter names may vary between MCP versions
- The `create` tool is accessed as `beads_create` in Claude
- Parameter names like `parent` vs `deps` vary by implementation
- Discovery ensures you use the correct, current tool signatures

---

## PRD Format Requirements

Your PRD markdown file should follow this structure for proper parsing:

### Required Sections

**1. Feature Name (H1 heading)**

```markdown
# Feature Name

Brief description of the feature
```

**2. User Stories (H3 headings with US-XXX format)**

```markdown
### US-001: Story Title

**Description:** As a [user], I want to [goal] so that [benefit].

**Acceptance Criteria:**

- [ ] First criterion
- [ ] Second criterion
- [ ] Third criterion

**Priority:** P1

**Depends on:** US-000 (optional)
```

### Optional Sections

**Quality Gates Section**

```markdown
## Quality Gates

These commands must pass for every user story:

- `pnpm typecheck` - Type checking
- `pnpm lint` - Linting

For UI stories, also include:

- Verify in browser using dev-browser skill
```

If no Quality Gates section exists, the skill will ask the user what commands should pass.

### Parsing Rules

The skill will extract:

- **Story ID**: From `### US-XXX:` headings
- **Story Title**: Text after `US-XXX:` in the heading
- **Description**: From `**Description:**` line (or the first paragraph if not present)
- **Acceptance Criteria**: From checklist items `- [ ]` under `**Acceptance Criteria:**`
- **Priority**: From `**Priority:**` lines (P1-P4, defaults to P2/medium if not specified)
  - P1 → priority 1 (high)
  - P2 → priority 2 (medium)
  - P3 → priority 3 (normal)
  - P4 → priority 4 (low)
- **Dependencies**: From `**Depends on:**` lines (comma-separated story IDs)

---

## The Job

Take a PRD (markdown file or text) and create beads using MCP server tools:

1. **Verify MCP availability** and **discover tool signatures** (MANDATORY)
2. **Parse the PRD** following the structure above
3. **Extract Quality Gates** from the "Quality Gates" section (if present)
4. Create an **epic** bead using `beads_create` with `issue_type="epic"`
5. Create **child beads** for each user story using `beads_create`
6. **Link tasks to epic** using `beads_dep` with `dep_type="parent-child"`
7. **Append quality gates** to each story's acceptance criteria
8. Set up **story dependencies** using `beads_dep` with `dep_type="blocks"`
9. Output ready for `ralph-tui run --tracker beads`

---

## Step 1: Verify MCP Server and Discover Tools

**FIRST STEP - MANDATORY:**

```python
# 1. Discover all available tools
tools = beads_discover_tools()

# 2. Get the create tool signature
create_info = beads_get_tool_info(tool_name="create")
# This will show you the EXACT parameter names

# 3. Get the dep tool signature
dep_info = beads_get_tool_info(tool_name="dep")
# This will show you the EXACT parameter names and dep_type options

# 4. If NO beads tools are found, STOP IMMEDIATELY
```

**Critical Notes:**

- The tool is called `beads_create` in Claude, but `create` in the MCP server
- Use the discovered parameter names, NOT the ones in this document
- The `beads_dep` tool supports multiple `dep_type` values:
  - `"blocks"` - for story dependencies (blocker relationships)
  - `"parent-child"` - for epic-to-task hierarchy
  - `"related"` - for related issues
  - `"discovered-from"` - for traceability

---

## Step 2: Parse the PRD

**Extract the following from the PRD markdown:**

1. **Feature name and description** (from H1 heading and following text)
2. **Quality Gates section** (look for `## Quality Gates`)
   - Universal gates that apply to all stories
   - UI-specific gates (mentioned separately)
3. **User Stories** (from `### US-XXX:` headings)
   - Story ID (e.g., `US-001`)
   - Story title
   - Description (from `**Description:**` or first paragraph)
   - Acceptance criteria (from `- [ ]` items under `**Acceptance Criteria:**`)
   - Priority (from `**Priority:**` P1-P4, default to P2 if missing)
   - Dependencies (from `**Depends on:**` lines)

**If Quality Gates section is missing:**

- Ask the user what commands should pass
- Or use sensible defaults like `npm run typecheck`

**If no user stories are found:**

- Error: "No user stories found in the PRD"
- Suggest: "Make sure your PRD has sections like: ### US-001: Title"

---

## Step 3: Create Epic Using MCP

Use `beads_create` with `issue_type="epic"`:

```python
# Example MCP call
epic_result = beads_create(
    title="[Feature Name from H1]",
    description="[Feature description from PRD]\n\nSource: [PRD path]",
    issue_type="epic",
    labels=["ralph", "feature"],
    priority=1,
    external_ref="prd:[PRD path]"  # If supported by your MCP version
)

epic_id = epic_result["id"]  # e.g., "adcompass-dft"
```

**Important:**

- Check if `external_ref` parameter is supported (from tool discovery)
- If NOT supported, put the PRD path in the description
- Capture the epic ID for linking child tasks

---

## Step 4: Create Child Beads with Quality Gates

Create tasks as standalone issues (they'll be linked to epic in Step 5):

```python
# Build description with acceptance criteria + quality gates
description = f"""{story_description}

## Acceptance Criteria
{format_acceptance_criteria(story.acceptanceCriteria)}

## Quality Gates
{format_quality_gates(universal_gates)}
{format_ui_gates_if_applicable(story)}
"""

# Create the task
story_result = beads_create(
    title=f"{story.id}: {story.title}",
    description=description,
    priority=story.priority,  # P1→1, P2→2, P3→3, P4→4
    labels=["ralph", "task"],
    external_ref=f"prd:{prd_path}"  # If supported
)

story_ids[story.id] = story_result["id"]  # Map for later steps
```

**Priority Mapping:**

- `P1` → `priority=1` (high)
- `P2` → `priority=2` (medium, default)
- `P3` → `priority=3` (normal)
- `P4` → `priority=4` (low)

**Acceptance Criteria Format:**

```markdown
## Acceptance Criteria

- [ ] First criterion from PRD
- [ ] Second criterion from PRD

## Quality Gates

- [ ] pnpm typecheck passes
- [ ] pnpm lint passes
- [ ] Verify in browser using dev-browser skill (UI stories only)
```

---

## Step 5: Link Tasks to Epic (Parent-Child Hierarchy)

**CRITICAL: Use `beads_dep` with `dep_type="parent-child"` to create the epic hierarchy:**

```python
# Link each task to the epic as a child
for story in user_stories:
    task_id = story_ids[story.id]

    beads_dep(
        issue_id=task_id,
        depends_on_id=epic_id,
        dep_type="parent-child"
    )
```

**This creates:**

- Epic: adcompass-dft
  - Child: adcompass-pqw (US-001)
  - Child: adcompass-2gm (US-002)
  - Child: adcompass-2ut (US-003)
  - etc.

**Important:**

- Do this BEFORE setting up story dependencies
- `issue_id` is the child (task)
- `depends_on_id` is the parent (epic)
- `dep_type="parent-child"` establishes the hierarchy

---

## Step 6: Set Up Story Dependencies

Use `beads_dep` with `dep_type="blocks"` for story-to-story dependencies:

```python
# For each story with dependencies
for story in user_stories:
    current_task_id = story_ids[story.id]

    # Handle explicit dependencies from PRD
    if story.dependsOn:  # e.g., ["US-001", "US-002"]
        for dep_story_id in story.dependsOn:
            blocker_task_id = story_ids.get(dep_story_id)
            if blocker_task_id:
                beads_dep(
                    issue_id=current_task_id,
                    depends_on_id=blocker_task_id,
                    dep_type="blocks"
                )
            else:
                print(f"⚠️  Warning: {story.id} depends on {dep_story_id}, but {dep_story_id} not found")
```

**Dependency Types:**

- `dep_type="parent-child"` - Epic ← Task (hierarchy)
- `dep_type="blocks"` - Task → Task (blocker relationship)
- Use `"blocks"` for sequential dependencies between stories

---

## Story Size: The #1 Rule

**Each story must be completable in ONE ralph-tui iteration (~one agent context window).**

When reviewing the parsed stories, check if any need to be split:

### Right-sized stories:

- Add a database column + migration
- Add a UI component to an existing page
- Update a server action with new logic
- Add a filter dropdown to a list

### Too big (suggest splitting):

- "Build the entire dashboard" → Split into: schema, queries, UI components, filters
- "Add authentication" → Split into: schema, middleware, login UI, session handling
- "Refactor the API" → Split into one story per endpoint

**Rule of thumb:** If you can't describe the change in 2-3 sentences, it's too big.

---

## Conversion Rules Summary

1. ✅ **Verify MCP server** (abort if unavailable)
2. 🔍 **Discover tools** (MANDATORY - get exact parameter names)
3. 📝 **Parse PRD** following the format requirements
4. 🎯 **Extract Quality Gates** (or ask user if missing)
5. 🏗️ **Create epic** with `issue_type="epic"` and `external_ref` (if supported)
6. 📋 **Create child beads** as standalone tasks
   - Story acceptance criteria
   - Quality gates appended
   - Correct priority mapping (P1→1, P2→2, etc.)
7. 🔗 **Link tasks to epic** using `beads_dep(task_id, epic_id, "parent-child")`
8. 🔗 **Set up story dependencies** using `beads_dep(task_id, blocker_id, "blocks")`
9. ✅ **Display summary** with hierarchy and run command

---

## Example Execution

**Input PRD:**

```markdown
# Friends Outreach

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

**Priority:** P1

### US-002: Add type toggle to investor list rows

**Description:** As Ryan, I want to toggle investor type directly from the list.

**Acceptance Criteria:**

- [ ] Each row has Cold | Friend toggle
- [ ] Switching shows confirmation dialog
- [ ] On confirm: updates type in database

**Priority:** P2

**Depends on:** US-001

### US-003: Filter investors by type

**Description:** As Ryan, I want to filter the list to see just friends or cold.

**Acceptance Criteria:**

- [ ] Filter dropdown: All | Cold | Friend
- [ ] Filter persists in URL params

**Priority:** P3

**Depends on:** US-002
```

**MCP Execution:**

```python
# Step 1: Discover tools (MANDATORY)
tools = beads_discover_tools()
create_info = beads_get_tool_info(tool_name="create")
dep_info = beads_get_tool_info(tool_name="dep")

# Step 2: Parse PRD (done above)

# Step 3: Create Epic
epic = beads_create(
    title="Friends Outreach",
    description="Add ability to mark investors as 'friends' for warm outreach.\n\nSource: ./tasks/friends-outreach-prd.md",
    issue_type="epic",
    labels=["ralph", "feature"],
    priority=1,
    external_ref="prd:./tasks/friends-outreach-prd.md"  # If supported
)
epic_id = epic["id"]  # e.g., "adcompass-abc"

# Step 4: Create US-001 (P1 → priority 1)
us001 = beads_create(
    title="US-001: Add investorType field to investor table",
    description="""As a developer, I need to categorize investors as 'cold' or 'friend'.

## Acceptance Criteria
- [ ] Add investorType column: 'cold' | 'friend' (default 'cold')
- [ ] Generate and run migration successfully

## Quality Gates
- [ ] pnpm typecheck passes
- [ ] pnpm lint passes""",
    priority=1,
    labels=["ralph", "task"],
    external_ref="prd:./tasks/friends-outreach-prd.md"  # If supported
)
us001_id = us001["id"]

# Step 5: Create US-002 (P2 → priority 2, UI story)
us002 = beads_create(
    title="US-002: Add type toggle to investor list rows",
    description="""As Ryan, I want to toggle investor type directly from the list.

## Acceptance Criteria
- [ ] Each row has Cold | Friend toggle
- [ ] Switching shows confirmation dialog
- [ ] On confirm: updates type in database

## Quality Gates
- [ ] pnpm typecheck passes
- [ ] pnpm lint passes
- [ ] Verify in browser using dev-browser skill""",
    priority=2,
    labels=["ralph", "task"],
    external_ref="prd:./tasks/friends-outreach-prd.md"  # If supported
)
us002_id = us002["id"]

# Step 6: Create US-003 (P3 → priority 3, UI story)
us003 = beads_create(
    title="US-003: Filter investors by type",
    description="""As Ryan, I want to filter the list to see just friends or cold.

## Acceptance Criteria
- [ ] Filter dropdown: All | Cold | Friend
- [ ] Filter persists in URL params

## Quality Gates
- [ ] pnpm typecheck passes
- [ ] pnpm lint passes
- [ ] Verify in browser using dev-browser skill""",
    priority=3,
    labels=["ralph", "task"],
    external_ref="prd:./tasks/friends-outreach-prd.md"  # If supported
)
us003_id = us003["id"]

# Step 7: Link all tasks to epic (parent-child hierarchy)
beads_dep(issue_id=us001_id, depends_on_id=epic_id, dep_type="parent-child")
beads_dep(issue_id=us002_id, depends_on_id=epic_id, dep_type="parent-child")
beads_dep(issue_id=us003_id, depends_on_id=epic_id, dep_type="parent-child")

# Step 8: Add story dependencies (blocks)
beads_dep(issue_id=us002_id, depends_on_id=us001_id, dep_type="blocks")
beads_dep(issue_id=us003_id, depends_on_id=us002_id, dep_type="blocks")
```

**Output Summary:**

```
✅ Conversion complete!

Summary:
  PRD: Friends Outreach
  Epic: adcompass-abc
  Stories: 3

Created bead IDs:
  Epic: adcompass-abc
  - Child: adcompass-def (US-001)
  - Child: adcompass-ghi (US-002)
  - Child: adcompass-jkl (US-003)

Story Dependencies:
  adcompass-ghi depends on adcompass-def (blocks)
  adcompass-jkl depends on adcompass-ghi (blocks)

Task Hierarchy:
  Epic: adcompass-abc (Friends Outreach)
    ├─ adcompass-def (US-001: Add investorType field)
    ├─ adcompass-ghi (US-002: Add type toggle) [blocked by US-001]
    └─ adcompass-jkl (US-003: Filter by type) [blocked by US-002]

Run with: ralph-tui run --tracker beads --epic adcompass-abc
```

---

## Multi-Repository Support

Use `workspace_root` parameter if supported (check via tool discovery):

```python
beads_create(
    title="Feature A",
    description="...",
    workspace_root="/Users/you/project-a"
)
```

---

## After Creation

After all beads are created:

```bash
# Work on a specific epic
ralph-tui run --tracker beads --epic adcompass-abc

# Or let it pick the best task
ralph-tui run --tracker beads
```

---

## Checklist Before Creating Beads

- [ ] **MCP server availability verified** (abort if unavailable)
- [ ] **Tool signatures discovered** (MANDATORY - don't skip this!)
- [ ] **PRD parsed successfully** (feature name, stories found)
- [ ] **Quality Gates extracted** (or user provided defaults)
- [ ] **Each story is right-sized** (completable in one iteration)
- [ ] **Priorities mapped correctly** (P1→1, P2→2, P3→3, P4→4)
- [ ] **Quality gates appended** to all acceptance criteria
- [ ] **UI stories have browser verification** (if specified)
- [ ] **Epic created** with `issue_type="epic"` and `external_ref` (if supported)
- [ ] **Tasks created** as standalone issues
- [ ] **Parent-child links created** using `beads_dep(..., dep_type="parent-child")`
- [ ] **Story dependencies created** using `beads_dep(..., dep_type="blocks")`
- [ ] **external_ref added to tasks** (if supported, for PRD traceability)

---

## Error Handling

**If MCP server unavailable:**

```
❌ CRITICAL ERROR: Cannot proceed without beads MCP server.
Use 'ralph-tui-create-beads' (CLI version) instead.
```

**If PRD parsing fails:**

```
❌ No user stories found in the PRD.
Make sure your PRD has sections like: ### US-001: Title
```

**If dependency references missing story:**

```
⚠️  Warning: Story US-005 depends on US-999, but US-999 not found in PRD.
Skipping this dependency.
```

**If tool parameter not supported:**

```
ℹ️  Note: 'external_ref' parameter not supported in your MCP version.
PRD path added to description instead.
```

---

## Summary

This skill provides **MCP-based** PRD-to-beads conversion with proper hierarchy:

1. ✅ Verify MCP server availability
2. 🔍 **Discover tool signatures (MANDATORY!)**
3. 📝 Parse PRD using standard format
4. 🎯 Extract quality gates
5. 🏗️ Create epic with `external_ref` (if supported)
6. 📋 Create tasks as standalone issues
7. 🔗 **Link tasks to epic** using `beads_dep(..., dep_type="parent-child")`
8. 🔗 Set up story dependencies using `beads_dep(..., dep_type="blocks")`
9. 🚀 Ready for ralph-tui execution

**PRD Format Reminder:**

- H1 for feature name
- H3 for user stories: `### US-XXX: Title`
- `**Description:**`, `**Acceptance Criteria:**`, `**Priority:**`, `**Depends on:**`
- Optional `## Quality Gates` section

**Key Insight: Use `beads_dep` with different `dep_type` values:**

- `dep_type="parent-child"` for epic-task hierarchy
- `dep_type="blocks"` for story dependencies
