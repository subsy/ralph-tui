---
name: ralph-tui-create-beads
description: "Convert PRDs to beads for ralph-tui execution. Creates an epic with child beads for each user story. Use when you have a PRD and want to use ralph-tui with beads as the task source. Triggers on: create beads, convert prd to beads, beads for ralph, ralph beads."
---

# Ralph TUI - Create Beads

Converts PRDs to beads (epic + child tasks) for ralph-tui autonomous execution.

> **Note:** This skill is bundled with ralph-tui's Beads tracker plugin. Future tracker plugins (Linear, GitHub Issues, etc.) will bundle their own task creation skills.

---

## The Job

Take a PRD (markdown file or text) and create beads in `.beads/beads.jsonl`:
1. **Extract Quality Gates** from the PRD's "Quality Gates" section
2. Create an **epic** bead for the feature
3. Create **child beads** for each user story (with quality gates appended)
4. Set up **dependencies** between beads (schema → backend → UI)
5. Output ready for `ralph-tui run --tracker beads`

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

Beads use `bd create` command with **HEREDOC syntax** to safely handle special characters:

```bash
# Create epic (link back to source PRD)
bd create --type=epic \
  --title="[Feature Name]" \
  --description="$(cat <<'EOF'
[Feature description from PRD]
EOF
)" \
  --external-ref="prd:./tasks/feature-name-prd.md"

# Create child bead (with quality gates in acceptance criteria)
bd create \
  --parent=EPIC_ID \
  --title="[Story Title]" \
  --description="$(cat <<'EOF'
[Story description with acceptance criteria INCLUDING quality gates]
EOF
)" \
  --priority=[1-4]
```

> **CRITICAL:** Always use `<<'EOF'` (single-quoted) for the HEREDOC delimiter. This prevents shell interpretation of backticks, `$variables`, and `()` in descriptions.

---

## Story Size: The #1 Rule

Each story must be completable in ONE ralph-tui iteration (~one agent context window). ralph-tui spawns a fresh agent per iteration with no memory of previous work.

**Right-sized:** Add a database column + migration. Add a UI component. Update a server action. Add a filter dropdown.

**Too big (split these):** "Build the entire dashboard" → schema, queries, UI, filters. "Add authentication" → schema, middleware, login UI, sessions.

**Rule of thumb:** If you can't describe the change in 2-3 sentences, it's too big.

---

## Dependencies with `bd dep add`

Stories execute in dependency order (schema → backend → UI → integration). Use `bd dep add` to specify which beads must complete first:

```bash
# Create the beads first
bd create --parent=epic-123 --title="US-001: Add schema" ...
bd create --parent=epic-123 --title="US-002: Create API" ...
bd create --parent=epic-123 --title="US-003: Build UI" ...

# Then add dependencies (issue depends-on blocker)
bd dep add ralph-tui-002 ralph-tui-001  # US-002 depends on US-001
bd dep add ralph-tui-003 ralph-tui-002  # US-003 depends on US-002
```

**Syntax:** `bd dep add <issue> <depends-on>` — the issue depends on (is blocked by) depends-on.

ralph-tui will show blocked beads as "blocked" until dependencies complete, and include dependency context in the prompt when working on a bead.

---

## Acceptance Criteria: Quality Gates + Story-Specific

Each bead's description should include story-specific acceptance criteria from the PRD, plus quality gates appended from the Quality Gates section.

Criteria must be verifiable: "Add `investorType` column with default 'cold'" is good. "Works correctly" or "Good UX" is bad.

---

## Conversion Rules

1. **Extract Quality Gates** from PRD first
2. **Each user story → one bead**
3. **Dependencies**: Schema/database → backend → UI → integration (use `bd dep add` after creating beads)
4. **Priority**: Based on dependency order, then document order (0=critical, 2=medium, 4=backlog)
5. **All stories**: `status: "open"`
6. **Acceptance criteria**: Story criteria + quality gates appended
7. **UI stories**: Also append UI-specific gates (browser verification)

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

## Example

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

**Output beads:**
```bash
# Create epic (link back to source PRD)
bd create --type=epic \
  --title="Friends Outreach Track" \
  --description="$(cat <<'EOF'
Warm outreach for deck feedback
EOF
)" \
  --external-ref="prd:./tasks/friends-outreach-prd.md"

# US-001: No deps (first - creates schema)
bd create --parent=ralph-tui-abc \
  --title="US-001: Add investorType field to investor table" \
  --description="$(cat <<'EOF'
As a developer, I need to categorize investors as 'cold' or 'friend'.

## Acceptance Criteria
- [ ] Add investorType column: 'cold' | 'friend' (default 'cold')
- [ ] Generate and run migration successfully
- [ ] pnpm typecheck passes
- [ ] pnpm lint passes
EOF
)" \
  --priority=1

# US-002: UI story (gets browser verification too)
bd create --parent=ralph-tui-abc \
  --title="US-002: Add type toggle to investor list rows" \
  --description="$(cat <<'EOF'
As Ryan, I want to toggle investor type directly from the list.

## Acceptance Criteria
- [ ] Each row has Cold | Friend toggle
- [ ] Switching shows confirmation dialog
- [ ] On confirm: updates type in database
- [ ] pnpm typecheck passes
- [ ] pnpm lint passes
- [ ] Verify in browser using dev-browser skill
EOF
)" \
  --priority=2

# Add dependency: US-002 depends on US-001
bd dep add ralph-tui-002 ralph-tui-001

# US-003: UI story
bd create --parent=ralph-tui-abc \
  --title="US-003: Filter investors by type" \
  --description="$(cat <<'EOF'
As Ryan, I want to filter the list to see just friends or cold.

## Acceptance Criteria
- [ ] Filter dropdown: All | Cold | Friend
- [ ] Filter persists in URL params
- [ ] pnpm typecheck passes
- [ ] pnpm lint passes
- [ ] Verify in browser using dev-browser skill
EOF
)" \
  --priority=3

# Add dependency: US-003 depends on US-002
bd dep add ralph-tui-003 ralph-tui-002
```

---

## Output Location

Beads are written to: `.beads/beads.jsonl`

After creation, run ralph-tui:
```bash
# Work on a specific epic
ralph-tui run --tracker beads --epic ralph-tui-abc

# Or let it pick the best task automatically
ralph-tui run --tracker beads
```

ralph-tui will work on beads, close each when complete, and output `<promise>COMPLETE</promise>` when the epic is done.

---

## Checklist Before Creating Beads

- [ ] Extracted Quality Gates from PRD
- [ ] Each story is completable in one iteration
- [ ] Stories ordered by dependency (schema → backend → UI)
- [ ] Quality gates appended to every bead's acceptance criteria
- [ ] Dependencies added with `bd dep add` after creating beads
