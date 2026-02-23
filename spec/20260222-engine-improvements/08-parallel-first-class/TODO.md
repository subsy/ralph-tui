# Step 8: First-Class Parallel Execution - Todo

## Status: ⬜ Not Started

## Tasks
- [ ] Change parallel mode default from `'never'` to `'auto'` in `src/config/types.ts` `ParallelConfig.mode`
- [ ] Verify parallel coordinator auto-detects independent tasks when `mode: 'auto'`
- [ ] Verify parallel coordinator falls back to serial when all tasks are sequential
- [ ] Ensure `ConflictResolutionConfig.timeoutMs` is wired through (not hardcoded) in conflict resolver
- [ ] Add/update CLI help text to highlight `--parallel [N]` option
- [ ] Add CLI help section: "Parallel Execution" with `--parallel`, `--serial`, `--direct-merge`
- [ ] Add `--conflict-timeout <ms>` CLI flag
- [ ] Write tests: default parallel mode is 'auto', auto detects independent tasks, auto falls back to serial, `--serial` overrides, `--conflict-timeout` passed through
- [ ] Manual verification: run with independent tasks (verify parallel), run with sequential tasks (verify serial fallback), verify `--serial` overrides
- [ ] Run `bun run typecheck`, `bun run build`, `bun test`

## Notes
[Add during implementation]

## Blockers
[Document any blockers]
