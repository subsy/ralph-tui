---
name: ralph-tui-create-beads-rust
description: "Convert PRDs to beads for ralph-tui execution using beads-rust (br CLI). Creates an epic with child beads for each user story. Use when you have a PRD and want to use ralph-tui with beads-rust as the task source. Triggers on: create beads, convert prd to beads, beads for ralph, ralph beads, br beads."
---

# Ralph TUI - Create Beads (beads-rust)

Converts PRDs to beads (epic + child tasks) for ralph-tui autonomous execution using **beads-rust** (`br` CLI).

> **Note:** This skill uses the `br` command from beads-rust. If you have the original beads (`bd`) installed instead, use the `ralph-tui-create-beads` skill.

---

## The Job

Take a PRD (markdown file or text) and create beads using `br` commands:
1. **Extract Quality Gates** from the PRD's "Quality Gates" section
2. Create an **epic** bead for the feature
3. Create **child beads** for each user story (with quality gates appended)
4. Set up **dependencies** between beads (schema → backend → UI)
5. Output ready for `ralph-tui run --tracker beads-rust`

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

Beads use `br create` command with **HEREDOC syntax** to safely handle special characters:

```bash
# Create epic (link back to source PRD)
br create --type=epic \
  --title="[Feature Name]" \
  --description="$(cat <<'EOF'
[Feature description from PRD]
EOF
)" \
  --external-ref="prd:./tasks/feature-name-prd.md"

# Create child bead (with quality gates in acceptance criteria)
br create \
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

Each story must be completable in ONE ralph-tui iteration. Right-sized: single column/component/endpoint. Too big: entire dashboard/auth system (split these).

---

## Dependencies with `br dep add`

Stories execute in dependency order (schema → backend → UI). Use `br dep add` to specify which beads must complete first:

```bash
# Create the beads first
br create --parent=epic-123 --title="US-001: Add schema" ...
br create --parent=epic-123 --title="US-002: Create API" ...
br create --parent=epic-123 --title="US-003: Build UI" ...

# Then add dependencies (issue depends-on blocker)
br dep add ralph-tui-002 ralph-tui-001  # US-002 depends on US-001
br dep add ralph-tui-003 ralph-tui-002  # US-003 depends on US-002
```

**Syntax:** `br dep add <issue> <depends-on>` — the issue depends on (is blocked by) depends-on.

ralph-tui will show blocked beads as "blocked" until dependencies complete and include dependency context in the prompt when working on a bead.

---

## Acceptance Criteria: Quality Gates + Story-Specific

Each bead's description should include story-specific acceptance criteria from the PRD, plus quality gates appended from the Quality Gates section.

---

## Conversion Rules

1. **Extract Quality Gates** from PRD first
2. **Each user story → one bead**
3. **Dependencies**: Schema/database → backend → UI → integration (use `br dep add` after creating beads)
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

See [EXAMPLES.md](EXAMPLES.md) for a complete PRD-to-beads conversion.

---

## Syncing Changes

After creating beads, sync to export to JSONL (for git tracking):

```bash
br sync --flush-only
```

This exports the SQLite database to `.beads/issues.jsonl` for version control.

---

## Output Location

Beads are stored in: `.beads/` directory (SQLite DB + JSONL export)

After creation, run ralph-tui:
```bash
# Work on a specific epic
ralph-tui run --tracker beads-rust --epic ralph-tui-abc

# Or let it pick the best task automatically
ralph-tui run --tracker beads-rust
```

ralph-tui will work on beads, close each when complete, and output `<promise>COMPLETE</promise>` when the epic is done.

See [REFERENCE.md](REFERENCE.md) for differences from the Go version of beads.

---

## Checklist Before Creating Beads

- [ ] Extracted Quality Gates from PRD
- [ ] Stories ordered by dependency (schema → backend → UI)
- [ ] Dependencies added with `br dep add` after creating beads
- [ ] Ran `br sync --flush-only` to export for git tracking
