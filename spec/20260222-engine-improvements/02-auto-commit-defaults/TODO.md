# Step 2: Auto-Commit Defaults - Todo

## Status: ⬜ Not Started

## Tasks
- [ ] Change `autoCommit` default from `false` to `true` in `src/config/types.ts`
- [ ] Find CLI command file (likely `src/commands/run.ts` or `src/cli.tsx`)
- [ ] Add `--no-auto-commit` flag to disable auto-commit
- [ ] Add `--auto-commit` flag to explicitly enable auto-commit
- [ ] Update commit message format in `src/engine/auto-commit.ts` to include iteration number
- [ ] Add `iteration` parameter to `performAutoCommit()` function
- [ ] Update existing auto-commit tests to verify new message format
- [ ] Write tests for: default config has `autoCommit: true`, `--no-auto-commit` flag overrides
- [ ] Manual verification: run without flags (should commit), run with `--no-auto-commit` (no commit), check iteration in messages
- [ ] Run `bun run typecheck`, `bun run build`, `bun test`

## Notes
[Add during implementation]

## Blockers
[Document any blockers]
