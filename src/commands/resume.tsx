/**
 * ABOUTME: Resume command for ralph-tui.
 * Continues execution from a previously interrupted or paused session.
 */

import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import {
  hasPersistedSession,
  loadPersistedSession,
  isSessionResumable,
  getSessionSummary,
  resumePersistedSession,
  savePersistedSession,
  deletePersistedSession,
  pauseSession,
  updateSessionAfterIteration,
  setSubagentPanelVisible,
  acquireLock,
  releaseLock,
  checkSession,
  cleanStaleLock,
  checkLock,
  detectAndRecoverStaleSession,
  type PersistedSessionState,
} from '../session/index.js';
import { buildConfig, validateConfig } from '../config/index.js';
import type { RuntimeOptions } from '../config/types.js';
import { ExecutionEngine } from '../engine/index.js';
import { registerBuiltinAgents } from '../plugins/agents/builtin/index.js';
import { registerBuiltinTrackers } from '../plugins/trackers/builtin/index.js';
import { getAgentRegistry } from '../plugins/agents/registry.js';
import { getTrackerRegistry } from '../plugins/trackers/registry.js';
import { RunApp } from '../tui/components/RunApp.js';

/**
 * Parse CLI arguments for the resume command
 */
export function parseResumeArgs(args: string[]): {
  cwd: string;
  headless: boolean;
  force: boolean;
} {
  let cwd = process.cwd();
  let headless = false;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--cwd':
        if (nextArg && !nextArg.startsWith('-')) {
          cwd = nextArg;
          i++;
        }
        break;

      case '--headless':
        headless = true;
        break;

      case '--force':
        force = true;
        break;
    }
  }

  return { cwd, headless, force };
}

/**
 * Initialize plugin registries
 */
async function initializePlugins(): Promise<void> {
  registerBuiltinAgents();
  registerBuiltinTrackers();

  const agentRegistry = getAgentRegistry();
  const trackerRegistry = getTrackerRegistry();

  await Promise.all([agentRegistry.initialize(), trackerRegistry.initialize()]);
}

/**
 * Run the execution engine with TUI (resume mode)
 */
async function runWithTui(
  engine: ExecutionEngine,
  cwd: string,
  initialState: PersistedSessionState,
  trackerType?: string,
  currentModel?: string,
): Promise<PersistedSessionState> {
  let currentState = initialState;

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
  });

  const root = createRoot(renderer);

  // Subscribe to engine events to save state
  engine.on((event) => {
    if (event.type === 'iteration:completed') {
      currentState = updateSessionAfterIteration(currentState, event.result);
      savePersistedSession(currentState).catch(() => {
        // Log but don't fail on save errors
      });
    } else if (event.type === 'engine:paused') {
      // Save paused state to session file
      currentState = pauseSession(currentState);
      savePersistedSession(currentState).catch(() => {
        // Log but don't fail on save errors
      });
    } else if (event.type === 'engine:resumed') {
      // Clear paused state when resuming
      currentState = {
        ...currentState,
        status: 'running',
        isPaused: false,
        pausedAt: undefined,
      };
      savePersistedSession(currentState).catch(() => {
        // Log but don't fail on save errors
      });
    }
  });

  const cleanup = async (): Promise<void> => {
    await engine.dispose();
    renderer.destroy();
    await releaseLock(cwd);
  };

  const handleSignal = async (): Promise<void> => {
    // Save interrupted state
    currentState = { ...currentState, status: 'interrupted' };
    await savePersistedSession(currentState);
    await cleanup();
    process.exit(0);
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  // Handler to update persisted state and save it
  const handleSubagentPanelVisibilityChange = (visible: boolean): void => {
    currentState = setSubagentPanelVisible(currentState, visible);
    savePersistedSession(currentState).catch(() => {
      // Log but don't fail on save errors
    });
  };

  root.render(
    <RunApp
      engine={engine}
      cwd={cwd}
      onQuit={async () => {
        // Save interrupted state
        currentState = { ...currentState, status: 'interrupted' };
        await savePersistedSession(currentState);
        await cleanup();
        process.exit(0);
      }}
      trackerType={trackerType}
      initialSubagentPanelVisible={initialState.subagentPanelVisible ?? false}
      onSubagentPanelVisibilityChange={handleSubagentPanelVisibilityChange}
      currentModel={currentModel}
    />,
  );

  await engine.start();
  await cleanup();
  return currentState;
}

/**
 * Run in headless mode (resume)
 */
async function runHeadless(
  engine: ExecutionEngine,
  cwd: string,
  initialState: PersistedSessionState,
): Promise<PersistedSessionState> {
  let currentState = initialState;

  engine.on((event) => {
    switch (event.type) {
      case 'engine:started':
        console.log(`\nResumed Ralph. Total tasks: ${event.totalTasks}`);
        break;

      case 'iteration:started':
        console.log(
          `\n--- Iteration ${event.iteration}: ${event.task.title} ---`,
        );
        break;

      case 'iteration:completed':
        console.log(
          `Iteration ${event.result.iteration} completed. ` +
            `Task ${event.result.taskCompleted ? 'DONE' : 'in progress'}. ` +
            `Duration: ${Math.round(event.result.durationMs / 1000)}s`,
        );
        // Save state after each iteration
        currentState = updateSessionAfterIteration(currentState, event.result);
        savePersistedSession(currentState).catch(() => {
          // Log but don't fail on save errors
        });
        break;

      case 'iteration:failed':
        console.error(`Iteration ${event.iteration} FAILED: ${event.error}`);
        break;

      case 'engine:paused':
        console.log('\nPaused. Use "ralph-tui resume" to continue.');
        currentState = pauseSession(currentState);
        savePersistedSession(currentState).catch(() => {
          // Log but don't fail on save errors
        });
        break;

      case 'engine:resumed':
        console.log('\nResumed...');
        currentState = {
          ...currentState,
          status: 'running',
          isPaused: false,
          pausedAt: undefined,
        };
        savePersistedSession(currentState).catch(() => {
          // Log but don't fail on save errors
        });
        break;

      case 'engine:stopped':
        console.log(`\nRalph stopped. Reason: ${event.reason}`);
        console.log(`Total iterations: ${event.totalIterations}`);
        console.log(`Tasks completed: ${event.tasksCompleted}`);
        break;

      case 'all:complete':
        console.log('\nAll tasks complete!');
        break;
    }
  });

  const handleSignal = async (): Promise<void> => {
    console.log('\nInterrupted, stopping...');
    // Save interrupted state
    currentState = { ...currentState, status: 'interrupted' };
    await savePersistedSession(currentState);
    await engine.dispose();
    await releaseLock(cwd);
    process.exit(0);
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  await engine.start();
  await engine.dispose();
  await releaseLock(cwd);
  return currentState;
}

/**
 * Execute the resume command
 */
export async function executeResumeCommand(args: string[]): Promise<void> {
  // Check for help
  if (args.includes('--help') || args.includes('-h')) {
    printResumeHelp();
    return;
  }

  const { cwd, headless, force } = parseResumeArgs(args);

  // Check for existing session
  const hasSession = await hasPersistedSession(cwd);
  if (!hasSession) {
    console.error('No session to resume.');
    console.error('');
    console.error('Start a new session with: ralph-tui run');
    process.exit(1);
  }

  // Detect and recover stale sessions EARLY
  // This fixes the issue where killing the TUI mid-task leaves activeTaskIds populated
  const staleRecovery = await detectAndRecoverStaleSession(cwd, checkLock);
  if (staleRecovery.wasStale) {
    console.log('');
    console.log('⚠️  Recovered stale session');
    if (staleRecovery.clearedTaskCount > 0) {
      console.log(
        `   Cleared ${staleRecovery.clearedTaskCount} stuck in-progress task(s)`,
      );
    }
    console.log('   Session status set to "interrupted" (resumable)');
    console.log('');
  }

  // Load session
  const persistedState = await loadPersistedSession(cwd);
  if (!persistedState) {
    console.error('Failed to load session data.');
    process.exit(1);
  }

  // Check if resumable
  if (!isSessionResumable(persistedState)) {
    const summary = getSessionSummary(persistedState);
    console.error(`Cannot resume session in '${summary.status}' state.`);
    console.error('');
    if (summary.status === 'completed') {
      console.error(
        'Session has already completed. Start a new session with: ralph-tui run',
      );
    } else {
      console.error(
        'Session cannot be resumed. Start a new session with: ralph-tui run --force',
      );
    }
    process.exit(1);
  }

  // Check for lock conflicts
  const sessionCheck = await checkSession(cwd);
  if (sessionCheck.isLocked && !sessionCheck.isStale && !force) {
    console.error('Another Ralph instance is already running.');
    console.error(`  PID: ${sessionCheck.lock?.pid}`);
    console.error('Use --force to override.');
    process.exit(1);
  }

  // Clean stale lock if needed
  if (sessionCheck.isStale) {
    await cleanStaleLock(cwd);
  }

  console.log('Resuming Ralph TUI session...');
  console.log('');

  // Initialize plugins
  await initializePlugins();

  // Build config from persisted state
  const options: RuntimeOptions = {
    agent: persistedState.agentPlugin,
    tracker: persistedState.trackerState.plugin,
    epicId: persistedState.trackerState.epicId,
    prdPath: persistedState.trackerState.prdPath,
    iterations: persistedState.maxIterations,
    cwd,
    headless,
    resume: true,
  };

  const config = await buildConfig(options);
  if (!config) {
    process.exit(1);
  }

  // Validate configuration
  const validation = await validateConfig(config);
  if (!validation.valid) {
    console.error('Configuration errors:');
    for (const error of validation.errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  // Acquire lock
  const lockAcquired = await acquireLock(cwd, persistedState.sessionId);
  if (!lockAcquired && !force) {
    console.error('Failed to acquire session lock.');
    process.exit(1);
  }

  // Update persisted state to running
  const resumedState = resumePersistedSession(persistedState);
  await savePersistedSession(resumedState);

  const summary = getSessionSummary(resumedState);

  console.log(`Session:    ${summary.sessionId.slice(0, 8)}...`);
  console.log(`Agent:      ${summary.agentPlugin}`);
  console.log(`Tracker:    ${summary.trackerPlugin}`);
  console.log(
    `Progress:   ${summary.tasksCompleted}/${summary.totalTasks} tasks complete`,
  );
  console.log(
    `Iteration:  ${summary.currentIteration}${summary.maxIterations > 0 ? `/${summary.maxIterations}` : ''}`,
  );
  console.log('');

  // Create and initialize engine
  const engine = new ExecutionEngine(config);

  try {
    await engine.initialize();
  } catch (error) {
    console.error(
      'Failed to initialize engine:',
      error instanceof Error ? error.message : error,
    );
    await releaseLock(cwd);
    process.exit(1);
  }

  // Restore engine state from persisted session
  // The engine will start fresh but the session tracks what was already done
  // Task statuses are read from the tracker which should be in sync

  // Run with TUI or headless
  let finalState: PersistedSessionState;
  try {
    if (!headless && config.showTui) {
      finalState = await runWithTui(
        engine,
        cwd,
        resumedState,
        config.tracker.plugin,
        config.model,
      );
    } else {
      finalState = await runHeadless(engine, cwd, resumedState);
    }
  } catch (error) {
    console.error(
      'Execution error:',
      error instanceof Error ? error.message : error,
    );
    await releaseLock(cwd);
    process.exit(1);
  }

  // Clean up session file on successful completion
  if (finalState.status === 'completed') {
    await deletePersistedSession(cwd);
    console.log('Session completed and cleaned up.');
  } else if (finalState.status === 'paused') {
    console.log('\nSession paused. Use "ralph-tui resume" to continue.');
  } else {
    console.log('\nSession state saved. Use "ralph-tui resume" to continue.');
  }

  console.log('\nRalph TUI finished.');
}

/**
 * Print resume command help
 */
export function printResumeHelp(): void {
  console.log(`
ralph-tui resume - Continue from a previous session

Usage: ralph-tui resume [options]

Options:
  --cwd <path>      Working directory (default: current directory)
  --headless        Run without TUI
  --force           Force resume even if another instance appears to be running

Description:
  Resumes execution from a previously interrupted or paused session.
  The session state is stored in .ralph-tui/session.json.

  Sessions can be resumed if they are in one of these states:
  - paused: Manually paused by user
  - running: Crashed or interrupted unexpectedly
  - interrupted: Stopped by signal (Ctrl+C)

  Completed or failed sessions cannot be resumed. Use 'ralph-tui run --force'
  to start a new session.

Examples:
  ralph-tui resume              # Resume session in current directory
  ralph-tui resume --headless   # Resume without TUI
  ralph-tui resume --force      # Force resume (override stale lock)
`);
}
