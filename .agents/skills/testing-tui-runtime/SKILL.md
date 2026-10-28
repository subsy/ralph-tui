---
name: testing-tui-runtime
description: How to drive the ralph-tui TUI (`run`, watch mode, pause/quit paths) end-to-end in a real terminal with a fake agent and a scratch beads tracker, without AI credentials.
---

# Runtime/E2E testing of the ralph-tui TUI

Use this when a change must be proven in the real TUI (watch mode, engine status labels,
pause/resume, shutdown/quit paths) rather than with unit tests.

## Build & run

```bash
cd /path/to/ralph-tui && bun run build      # produces dist/cli.js
```

Run the built CLI (not `bun run dev`) so behaviour matches shipped code:

```bash
bun /path/to/ralph-tui/dist/cli.js run [flags]
```

## Scratch tracker (never touch the repo's own .beads)

Create a throwaway project dir with its own beads store and drive scenarios with `bd`:

```bash
export RALPH_TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ralph-tui-run.XXXXXX")" && cd "$RALPH_TEST_DIR"
bd init            # or `bd create ...` which bootstraps the store
bd create "Watch mode epic" --type epic -p 1          # note the epic id bd prints
bd create "Alpha task" --type task -p 2 --parent <epic-id>
```

A **fresh** dir per run, not a fixed one: a reused dir carries over `.beads` tasks, the
`.ralph-tui` session file, locks and guards — exactly the things most scenarios here assert on, so
a `Recovered stale session` banner or a stale-lock prompt from the *previous* run reads as a
finding of the build under test. The unique dir also gives the run a unique epic id, which is how
you address its process (see the signal trap below).

Gotchas:
- `bd` commands must be run **with the scratch dir as the working directory**, otherwise you get
  "no beads database found".
- With `--tracker beads`, the TUI **requires `--epic <id>`**; without it the TUI shows
  "No epics found" and interactive epic selection blocks automation.
- `br` (beads-rust) may not be installed even though AGENTS.md references it; `bd` works.

## Fake agents (no AI credentials needed)

Put plugins in `~/.config/ralph-tui/plugins/agents/`:
- `echo.ts` — returns `echo-agent: local fake response\n<promise>COMPLETE</promise>` instantly.
- `slowecho.ts` — same but sleeps ~25s in interruptible 500 ms chunks. Essential for testing
  quit/pause **mid-iteration**; an instant agent gives you no window to interrupt.

Select with `--agent echo` / `--agent slowecho`.

## Making timing visible on screen

Wrap the CLI so quit latency is provable in the recording:

```bash
#!/bin/bash
cd "${RALPH_TEST_DIR:?export RALPH_TEST_DIR to the scratch dir first}"
export PATH="$PATH:$HOME/.local/bin"
echo "START $(date +%H:%M:%S.%3N)  args: $*"
bun /path/to/ralph-tui/dist/cli.js run "$@"
echo "=== PROCESS EXITED code=$? at $(date +%H:%M:%S.%3N) ==="
exec bash
```

Typical invocation:
`./runwatch.sh --watch --poll 60 --agent echo --tracker beads --epic <epic-id> --no-setup --force`

Use a long `--poll` (60s) to make a stalled pause/quit obvious, and a short one (10s) when you
want auto-pickup to happen quickly.

## TUI keys

`s` start · `p` pause/resume · `q` → quit dialog → `y` · `d` dashboard · `r` refresh.
Header status labels: `Waiting` (watch idle), `Selecting`, `Executing`, `Paused`, `Complete`.
Dashboard shows `Waiting for new tasks` when watch-idle.

## Known traps

- **Interrupt (Ctrl+C) path**: on builds that include the #431 fix (`src/tui/utils/keyboard-shortcuts.ts`
  + `onInterruptRequest` in `RunApp.tsx` + `exitSignals: ['SIGQUIT','SIGABRT']` in `run.tsx`),
  keyboard Ctrl+C and external `kill -INT <pid>` both render the `⚠ Interrupt Ralph?` dialog with
  the display intact; `n`/`Esc` cancel, `y` exits code 0 in ~2s and resets the active task to
  `open`, and a second Ctrl+C within ~1s force-quits via `process.exit(1)` (wrapper `code=1`,
  terminal left un-repainted; on builds whose `exit` handler calls `releaseLockSync` the force quit
  no longer leaves a lock file behind, on older ones it does).
  On older builds Ctrl+C is a complete no-op and `kill -INT` blanks the display and hangs, so
  always confirm which build you are on before blaming a change.
- **Ctrl+Shift+C is indistinguishable from Ctrl+C in most terminals**: konsole sends byte `0x03`
  for both (verify with `stty -isig; cat -v` — Ctrl+Shift+C prints `^C`, Alt+C prints `^[c`), so the
  "copy" shortcut opens the interrupt dialog whenever the terminal does not consume it itself
  (konsole only consumes it when a konsole-level text selection exists). Alt+C is safely distinct.
  Clipboard *contents* cannot be verified on a box without `xclip`/`xsel`/`wl-paste` (that is what
  `src/utils/clipboard.ts` shells out to on Linux) — record the clipboard write as untested.
- **Early-startup signals need timing, and are quirky**: the app's SIGINT/SIGTERM handlers are not
  installed for roughly the first ~0.7s. Drive it with
  `( sleep 0.5; kill -INT "$(pgrep -f "cli\.js run.*--epic $EPIC_ID")" ) & ./runwatch.sh ...`,
  where `$EPIC_ID` is this run's epic — check the pattern matches exactly one pid
  (`pgrep -cf ...`) before signalling, and note the wrapper script is a *different* process from
  the CLI it launches, so signal the pid you matched rather than the wrapper. Do not use
  `pkill -f 'dist/cli.js run'`: it hits every ralph run on the box, including a parallel test or a
  `main` worktree build you are comparing against, and mutates their session and task state.
  Historic behaviour (before
  the #434 fix in `src/session/lock.ts`): SIGINT in that window exited `130` but left a stale lock,
  and SIGTERM was *delivered but ignored* (the TUI mounted and kept running). On builds where
  `registerLockCleanupHandlers` owns the startup signals (guarded by
  `process.listenerCount(signal) > 1`), expect `code=143` for SIGTERM / `code=130` for SIGINT at
  every delay in the window, with `.ralph-tui/ralph.lock` removed; a signal landing *before*
  `acquireLockWithPrompt` (~0.05s) uses default disposition but cannot leave a lock. Always sweep
  several delays (0.05/0.2/0.3/0.4/0.5/0.7s), log that the signal was actually sent, and check
  `ls .ralph-tui/ralph.lock` plus the next launch's banner each time. Two signals in quick
  succession inside the window should still yield a single clean 130/143, never `code=1`.
- **`Recovered stale session` is not the same thing as `Stale lock detected`**: the lock file can be
  correctly removed while `.ralph-tui/session.json` keeps `status: "running"`, in which case *every*
  next launch prints `⚠ Recovered stale session / Session status set to "interrupted" (resumable)`
  — even after a graceful `q`/`y` exit (`code=0`). Check `jq .status .ralph-tui/session.json` and
  `session-meta.json` before attributing that banner to a lock/signal change; it may be an
  independent session-persistence bug.
- **In TUI mode the process does not exit by itself** when all tasks are done in non-watch mode;
  it parks on `Complete` until you quit. To prove "exits when work runs out", use headless mode:
  `--no-tui` (alias `--headless`) exits with code 0 and prints a run summary. Headless watch mode
  logs `[watch] All tasks complete — polling every Ns` and stays alive.
- **Killed sessions may leave a stale lock** (older builds; fixed once the lock layer owns
  startup signals and the `exit` handler releases synchronously): the next launch prompts
  "Remove the stale lock and continue? (Y/n)" *before* the TUI starts. Answer `y` first; keys you
  send too early (e.g. `s`) land in that prompt. Prefer graceful `q`/`y` exits to avoid this.
- After creating a task externally, allow up to one full poll interval plus a few seconds before
  concluding auto-pickup failed.
- **Lock guard file (`.ralph-tui/ralph.lock.guard`) and `lockId`**: on builds that serialize lock
  mutations, `.ralph-tui/ralph.lock` carries a `lockId` nonce and every create/stale-clean/
  `--force`/release goes through a guard file created with `O_EXCL`. Useful observer helper:
  print the lock's `pid`/`lockId`, whether the guard exists (and its contents), and `pgrep`ed
  ralph pids, and sample it before/after every scenario. The guard should never be observed
  present while a run merely executes — only during a mutation. Things worth planting by hand:
  an empty or `not-json` guard (should be reclaimed as malformed after ~250ms and the run starts
  normally), a guard naming a *dead* pid (reclaimed), and a guard naming a *live* pid (respected:
  acquire fails after ~2s with `Timed out waiting for the session lock (another ralph-tui process
  may be starting or exiting)`). On such builds a guard held past the sync budget at exit time is
  expected to leave the lock behind (later recovered as stale) rather than unlink it — a lock left
  behind there is a pass; a hang, a multi-second stall, or a *live* process's lock disappearing is
  the bug. Make sure the "live pid" in a planted guard is really alive (`kill -0`); a pid that has
  already exited silently converts the test into the dead-pid case.
- **`run --resume` may fail where standalone `resume` works**: `run.tsx` acquires the session lock
  before calling `resumeSession`, which acquires again and refuses because a lock exists — observed
  as `Resuming previous session... / Failed to resume session` with exit 1, while
  `ralph-tui resume` on the same interrupted session starts fine. Reproduced on `main` too, so
  treat it as pre-existing unless the build under test claims to fix it; always cross-check against
  a `git worktree` build of `main` before calling it a regression.
- **Watch for an orphaned run with no lock file**: observed once — the TUI painted nothing at all
  yet the engine kept executing iterations and `.ralph-tui/ralph.lock` was absent. That is the
  signature of an uncaught exception handler that releases the lock without exiting. It did not
  reproduce in follow-up attempts; if you hit a blank TUI, capture stdout/stderr by wrapping the
  run in `script -q -c "./runwatch.sh ..." /tmp/run.log` (this preserves the TTY, unlike a pipe)
  before killing it. Note `runwatch.sh` ends with `exec bash`, so a `script`-wrapped run leaves you
  in an inner shell — type `exit` to continue a scripted loop.

## Devin Secrets Needed

None — the fake agent plugins and the local `bd` store avoid all external credentials.
