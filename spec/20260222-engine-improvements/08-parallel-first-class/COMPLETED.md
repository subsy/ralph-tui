/**
 * ABOUTME: Completion summary for Step 8 — First-Class Parallel Execution.
 */

# Step 8: First-Class Parallel Execution — COMPLETED

## Summary

All four implementation items from TASK.md have been implemented.

## Changes Made

### `src/commands/run.tsx`

1. **Default parallel mode changed to 'auto'** — `resolveParallelMode` now returns `'auto'` when no CLI flags are set and no stored config overrides it (was `'never'`).

2. **`--conflict-timeout` flag added** — Parsed in `parseRunArgs`, stored in `ExtendedRuntimeOptions.conflictTimeout`, and wired through to `createAiResolver` via the `conflictResolution.timeoutMs` field. CLI value takes precedence over stored config.

3. **Improved CLI help text** — Added a dedicated `Parallel Execution:` section in `printRunHelp()` with clear descriptions for `--parallel [N]`, `--serial`, `--sequential`, `--direct-merge`, and `--conflict-timeout`.

4. **Exported `resolveParallelMode`** — Made the function public for testability.

### `src/commands/run.test.ts`

Added 14 new test cases covering:
- `resolveParallelMode` defaults to `'auto'` with no flags or config
- `--serial` returns `'never'` (overrides auto/config)
- `--parallel` returns `'always'` (overrides config)
- Stored config mode is respected when no CLI flags
- Auto mode detects independent tasks as parallelizable
- Auto mode falls back to serial for fully sequential dependency chains
- `--conflict-timeout` parses valid numeric values
- `--conflict-timeout` ignores invalid/missing values

## Verification

- `bun run typecheck` — passes
- `bun run build` — passes
- `bun test src/commands/run.test.ts` — 65 pass, 0 fail
- `bun test` (full suite) — 3350 pass, 4 pre-existing failures unrelated to this change

## Notes

The `ConflictResolver` class itself had no hardcoded timeout — the timeout was already read from config in `ai-resolver.ts` via `config.conflictResolution?.timeoutMs ?? DEFAULT_TIMEOUT_MS`. The wiring change ensures the CLI `--conflict-timeout` flag flows into that config path.
