## [ERR-20260113-001] bd create

**Logged**: 2026-01-13T00:00:00Z
**Priority**: high
**Status**: pending
**Area**: docs

### Summary
bd create failed because no beads database exists for this repo

### Error
```
Error: no beads database found

Found JSONL file: /Users/dalecarman/Groove Jones Dropbox/Dale Carman/Projects/dev/ralph-tui/.beads/issues.jsonl
This looks like a fresh clone or JSONL-only project.

Options:
  • Run 'bd init' to create database and import issues
  • Use 'bd --no-db create' for JSONL-only mode
  • Add 'no-db: true' to .beads/config.yaml for permanent JSONL-only mode
```

### Context
- Command attempted: `bd create --title="Fix TUI mouse capture on exit" --type=bug --priority=1`
- Repo has JSONL-only beads data under `.beads/`

### Suggested Fix
Use `bd --no-db create` for JSONL-only projects or run `bd init` first.

### Metadata
- Reproducible: yes
- Related Files: .beads/issues.jsonl
- See Also: none

---
## [ERR-20260113-002] bd --no-db create

**Logged**: 2026-01-13T00:00:00Z
**Priority**: high
**Status**: pending
**Area**: docs

### Summary
bd --no-db create failed due to mixed issue prefixes in .beads/issues.jsonl

### Error
```
Error initializing --no-db mode: failed to detect prefix: issues have mixed prefixes, please set issue-prefix in .beads/config.yaml
```

### Context
- Command attempted: `bd --no-db create --title="Fix TUI mouse capture on exit" --type=bug --priority=1`
- Repo uses JSONL-only beads with mixed prefixes

### Suggested Fix
Set `issue-prefix` in `.beads/config.yaml` or run `bd init` to normalize.

### Metadata
- Reproducible: yes
- Related Files: .beads/issues.jsonl, .beads/config.yaml
- See Also: ERR-20260113-001

---
## [ERR-20260113-003] bun run typecheck

**Logged**: 2026-01-13T00:00:00Z
**Priority**: high
**Status**: pending
**Area**: config

### Summary
TypeScript typecheck failed because @types/node is missing

### Error
```
error TS2688: Cannot find type definition file for 'node'.
  The file is in the program because:
    Entry point of type library 'node' specified in compilerOptions
```

### Context
- Command attempted: `bun run typecheck`
- Ran in /Users/dalecarman/Groove Jones Dropbox/Dale Carman/Projects/dev/ralph-tui

### Suggested Fix
Run `bun install` or ensure node type definitions are available in node_modules.

### Metadata
- Reproducible: yes
- Related Files: tsconfig.json, package.json
- See Also: none

---
## [ERR-20260113-004] bun run typecheck

**Logged**: 2026-01-13T00:00:00Z
**Priority**: high
**Status**: pending
**Area**: config

### Summary
TypeScript typecheck failed because node-notifier dependency was missing

### Error
```
src/notifications.ts(8,22): error TS2307: Cannot find module 'node-notifier' or its corresponding type declarations.
```

### Context
- Command attempted: `bun run typecheck`
- After rebasing with upstream changes

### Suggested Fix
Run `bun install` to pull new dependencies from package.json.

### Metadata
- Reproducible: yes
- Related Files: package.json, src/notifications.ts
- See Also: ERR-20260113-003

---
