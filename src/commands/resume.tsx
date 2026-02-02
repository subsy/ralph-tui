/**
 * ABOUTME: Resume command for ralph-tui.
 * Continues execution from a previously interrupted or paused session.
 * Supports cross-directory resume via session registry.
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
  listResumableSessions,
  getSessionById,
  getSessionByCwd,
  findSessionsByPrefix,
  updateRegistryStatus,
  unregisterSession,
  cleanupStaleRegistryEntries,
  getRegistryFilePath,
  type PersistedSessionState,
  type SessionRegistryEntry,
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
 * Parsed resume command arguments
 */
export interface ResumeArgs {
  /** Working directory (overrides session registry) */
  cwd: string;
  /** Run in headless mode */
  headless: boolean;
  /** Force resume even if locked */
  force: boolean;
  /** List available sessions */
  list: boolean;
  /** Clean up stale registry entries */
  cleanup: boolean;
  /** Session ID to resume (can be partial prefix) */
  sessionId?: string;
}

/**
 * Parse CLI arguments for the resume command
 */
export function parseResumeArgs(args: string[]): ResumeArgs {
  let cwd = process.cwd();
  let headless = false;
  let force = false;
  let list = false;
  let cleanup = false;
  let sessionId: string | undefined;

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

      case '--list':
      case '-l':
        list = true;
        break;

      case '--cleanup':
        cleanup = true;
        break;

      default:
        // Positional argument: session ID
        if (!arg.startsWith('-') && !sessionId) {
          sessionId = arg;
        }
        break;
    }
  }

  return { cwd, headless, force, list, cleanup, sessionId };
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
 * Format a session entry for display
 */
export function formatSessionEntry(entry: SessionRegistryEntry, index?: number): string {
  const prefix = index !== undefined ? `${index + 1}. ` : '';
  const shortId = entry.sessionId.slice(0, 8);
  const statusIcon = entry.status === 'paused' ? '⏸' :
                     entry.status === 'running' ? '▶' :
                     entry.status === 'interrupted' ? '⚠' : '•';
  const sandboxTag = entry.sandbox ? ' [sandbox]' : '';
  const trackerInfo = entry.epicId ? `epic:${entry.epicId}` :
                      entry.prdPath ? `prd:${entry.prdPath}` : entry.trackerPlugin;

  return `${prefix}${statusIcon} ${shortId}  ${entry.status.padEnd(11)}  ${entry.agentPlugin.padEnd(10)}  ${trackerInfo}${sandboxTag}\n   ${entry.cwd}`;
}

/**
 * List available resumable sessions
 */
export async function listSessions(): Promise<void> {
  const sessions = await listResumableSessions();

  if (sessions.length === 0) {
    console.log('No resumable sessions found.');
    console.log('');
    console.log('Start a new session with: ralph-tui run');
    return;
  }

  console.log('Resumable sessions:');
  console.log('');
  console.log('   ID        Status       Agent       Tracker');
  console.log('   ─────────────────────────────────────────────────');

  for (let i = 0; i < sessions.length; i++) {
    console.log(formatSessionEntry(sessions[i], i));
    console.log('');
  }

  console.log('To resume a session:');
  console.log('  ralph-tui resume <session-id>    # Resume by ID (first 8 chars is enough)');
  console.log('  ralph-tui resume                 # Resume session in current directory');
}

/**
 * Clean up stale registry entries
 */
export async function cleanupRegistry(): Promise<void> {
  console.log('Cleaning up stale session registry entries...');

  const cleaned = await cleanupStaleRegistryEntries(hasPersistedSession);

  if (cleaned === 0) {
    console.log('No stale entries found.');
  } else {
    console.log(`Removed ${cleaned} stale session${cleaned !== 1 ? 's' : ''} from registry.`);
  }

  console.log(`Registry file: ${getRegistryFilePath()}`);
}

/**
 * Resolve session to resume - either from session ID, current directory, or registry
 */
export async function resolveSession(args: ResumeArgs): Promise<{
  cwd: string;
  registryEntry?: SessionRegistryEntry;
} | null> {
  // If session ID provided, look it up in registry
  if (args.sessionId) {
    // Try exact match first
    let entry = await getSessionById(args.sessionId);

    // Try prefix match if exact match fails
    if (!entry) {
      const matches = await findSessionsByPrefix(args.sessionId);
      if (matches.length === 1) {
        entry = matches[0];
      } else if (matches.length > 1) {
        console.error(`Multiple sessions match prefix '${args.sessionId}':`);
        console.error('');
        for (const match of matches) {
          console.error(`  ${match.sessionId.slice(0, 8)}  ${match.cwd}`);
        }
        console.error('');
        console.error('Please provide a more specific session ID.');
        return null;
      }
    }

    if (!entry) {
      console.error(`Session '${args.sessionId}' not found in registry.`);
      console.error('');
      console.error('Use "ralph-tui resume --list" to see available sessions.');
      return null;
    }

    // Validate the session file still exists at the entry's cwd
    const sessionFileExists = await hasPersistedSession(entry.cwd);
    if (!sessionFileExists) {
      console.error(`Session '${args.sessionId}' found in registry, but session file is missing.`);
      console.error(`Expected session file at: ${entry.cwd}/.ralph-tui/session.json`);
      console.error('');
      console.error('The session file may have been deleted. Run --cleanup to update the registry.');
      return null;
    }

    return { cwd: entry.cwd, registryEntry: entry };
  }

  // Check current directory for session
  const hasSession = await hasPersistedSession(args.cwd);
  if (hasSession) {
    // Also try to get registry entry for this cwd
    const registryEntry = await getSessionByCwd(args.cwd) ?? undefined;
    return { cwd: args.cwd, registryEntry };
  }

  // No session in current directory - check registry for helpful suggestions
  const registryEntry = await getSessionByCwd(args.cwd);
  if (registryEntry) {
    // Registry has an entry but session file is missing
    console.error('Session file not found, but registry entry exists.');
    console.error(`Expected session file at: ${args.cwd}/.ralph-tui/session.json`);
    console.error('');
    console.error('The session file may have been deleted. Run --cleanup to update the registry.');
    return null;
  }

  // Check if there are any sessions available
  const sessions = await listResumableSessions();

  console.error('No session to resume in current directory.');
  console.error(`Looked for session at: ${args.cwd}/.ralph-tui/session.json`);
  console.error('');

  if (sessions.length > 0) {
    console.error('Available sessions in other directories:');
    console.error('');
    for (const session of sessions.slice(0, 3)) {
      console.error(`  ${session.sessionId.slice(0, 8)}  ${session.cwd}`);
    }
    if (sessions.length > 3) {
      console.error(`  ... and ${sessions.length - 3} more`);
    }
    console.error('');
    console.error('Use "ralph-tui resume <session-id>" to resume a specific session.');
    console.error('Use "ralph-tui resume --list" to see all sessions.');
  } else {
    console.error('Start a new session with: ralph-tui run');
  }

  return null;
}

/**
 * Run the execution engine with TUI (resume mode)
 */
async function runWithTui(
  engine: ExecutionEngine,
  cwd: string,
  initialState: PersistedSessionState,
  trackerType?: string,
  currentModel?: string
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
      currentState = { ...currentState, status: 'running', isPaused: false, pausedAt: undefined };
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
    />
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
  initialState: PersistedSessionState
): Promise<PersistedSessionState> {
  let currentState = initialState;

  engine.on((event) => {
    switch (event.type) {
      case 'engine:started':
        console.log(`\nResumed Ralph. Total tasks: ${event.totalTasks}`);
        break;

      case 'iteration:started':
        console.log(`\n--- Iteration ${event.iteration}: ${event.task.title} ---`);
        break;

      case 'iteration:completed':
        console.log(
          `Iteration ${event.result.iteration} completed. ` +
            `Task ${event.result.taskCompleted ? 'DONE' : 'in progress'}. ` +
            `Duration: ${Math.round(event.result.durationMs / 1000)}s`
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
        currentState = { ...currentState, status: 'running', isPaused: false, pausedAt: undefined };
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

  const parsedArgs = parseResumeArgs(args);

  // Handle --list
  if (parsedArgs.list) {
    await listSessions();
    return;
  }

  // Handle --cleanup
  if (parsedArgs.cleanup) {
    await cleanupRegistry();
    return;
  }

  // Resolve which session to resume
  const resolved = await resolveSession(parsedArgs);
  if (!resolved) {
    process.exit(1);
  }

  const { cwd, registryEntry } = resolved;
  const { headless, force } = parsedArgs;

  // Detect and recover stale sessions EARLY
  // This fixes the issue where killing the TUI mid-task leaves activeTaskIds populated
  const staleRecovery = await detectAndRecoverStaleSession(cwd, checkLock);
  if (staleRecovery.wasStale) {
    console.log('');
    console.log('⚠️  Recovered stale session');
    if (staleRecovery.clearedTaskCount > 0) {
      console.log(`   Cleared ${staleRecovery.clearedTaskCount} stuck in-progress task(s)`);
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
      console.error('Session has already completed. Start a new session with: ralph-tui run');
    } else {
      console.error('Session cannot be resumed. Start a new session with: ralph-tui run --force');
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

  // Set session ID on config for use in iteration log filenames
  config.sessionId = summary.sessionId;

  console.log(`Session:    ${summary.sessionId.slice(0, 8)}...`);
  console.log(`Agent:      ${summary.agentPlugin}`);
  console.log(`Tracker:    ${summary.trackerPlugin}`);
  console.log(`Progress:   ${summary.tasksCompleted}/${summary.totalTasks} tasks complete`);
  console.log(`Iteration:  ${summary.currentIteration}${summary.maxIterations > 0 ? `/${summary.maxIterations}` : ''}`);
  console.log('');

  // Create and initialize engine
  const engine = new ExecutionEngine(config);

  try {
    await engine.initialize();
  } catch (error) {
    console.error(
      'Failed to initialize engine:',
      error instanceof Error ? error.message : error
    );
    await releaseLock(cwd);
    process.exit(1);
  }

  // Validate tracker state matches session expectations
  // See: https://github.com/subsy/ralph-tui/issues/247
  const engineState = engine.getState();
  const sessionTotalTasks = resumedState.trackerState.totalTasks;
  if (engineState.totalTasks === 0 && sessionTotalTasks > 0) {
    console.warn('\nWarning: Session has task history but tracker returned no tasks.');
    console.warn('This may happen if:');
    if (resumedState.trackerState.epicId) {
      console.warn(`  - The epic ID "${resumedState.trackerState.epicId}" no longer exists`);
    }
    if (resumedState.trackerState.prdPath) {
      console.warn(`  - The PRD file "${resumedState.trackerState.prdPath}" is missing or empty`);
    }
    console.warn('\nTo fix, provide the tracker source explicitly:');
    console.warn('  ralph-tui run --prd <path-to-prd.json>');
    console.warn('  ralph-tui run --epic <epic-id>');
    console.warn('');
  }

  // Restore engine state from persisted session
  // The engine will start fresh but the session tracks what was already done
  // Task statuses are read from the tracker which should be in sync

  // Run with TUI or headless
  let finalState: PersistedSessionState;
  try {
    if (!headless && config.showTui) {
      finalState = await runWithTui(engine, cwd, resumedState, config.tracker.plugin, config.model);
    } else {
      finalState = await runHeadless(engine, cwd, resumedState);
    }
  } catch (error) {
    console.error(
      'Execution error:',
      error instanceof Error ? error.message : error
    );
    await releaseLock(cwd);
    process.exit(1);
  }

  // Clean up session file on successful completion
  if (finalState.status === 'completed') {
    await deletePersistedSession(cwd);
    // Remove from registry on completion
    if (registryEntry) {
      await unregisterSession(registryEntry.sessionId);
    }
    console.log('Session completed and cleaned up.');
  } else if (finalState.status === 'paused') {
    // Update registry status
    if (registryEntry) {
      await updateRegistryStatus(registryEntry.sessionId, 'paused');
    }
    console.log('\nSession paused. Use "ralph-tui resume" to continue.');
  } else {
    // Update registry with current status
    if (registryEntry) {
      await updateRegistryStatus(registryEntry.sessionId, finalState.status);
    }
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

Usage: ralph-tui resume [session-id] [options]

Arguments:
  session-id        Session ID to resume (first 8 characters is enough)
                    If not provided, resumes session in current directory

Options:
  --list, -l        List all resumable sessions
  --cleanup         Remove stale entries from session registry
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

  Cross-directory Resume:
  Sessions are registered in a global registry (~/.config/ralph-tui/sessions.json)
  allowing you to resume sessions from any directory using the session ID.

  Completed or failed sessions cannot be resumed. Use 'ralph-tui run --force'
  to start a new session.

Examples:
  ralph-tui resume              # Resume session in current directory
  ralph-tui resume --list       # List all resumable sessions
  ralph-tui resume a1b2c3d4     # Resume session by ID (from any directory)
  ralph-tui resume --headless   # Resume without TUI
  ralph-tui resume --force      # Force resume (override stale lock)
  ralph-tui resume --cleanup    # Clean up stale registry entries
`);
}
