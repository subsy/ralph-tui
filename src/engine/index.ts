/**
 * ABOUTME: Execution engine for Ralph TUI agent loop.
 * Handles the iteration cycle: select task → inject prompt → run agent → check result → update tracker.
 * Supports configurable error handling strategies: retry, skip, abort.
 */

import type {
  ActiveAgentState,
  ActiveAgentReason,
  AgentRecoveryAttemptedEvent,
  AgentSwitchedEvent,
  AllAgentsLimitedEvent,
  EngineEvent,
  EngineEventListener,
  EngineState,
  EngineStatus,
  EngineSubagentState,
  ErrorHandlingConfig,
  ErrorHandlingStrategy,
  IterationResult,
  IterationStatus,
  IterationRateLimitedEvent,
  RateLimitState,
  SubagentTreeNode,
  TaskAutoCommittedEvent,
  TaskAutoCommitFailedEvent,
} from './types.js';
import { toEngineSubagentState } from './types.js';
import type { RalphConfig, RateLimitHandlingConfig } from '../config/types.js';
import { DEFAULT_RATE_LIMIT_HANDLING } from '../config/types.js';
import { RateLimitDetector, type RateLimitDetectionResult } from './rate-limit-detector.js';
import type { TrackerPlugin, TrackerTask } from '../plugins/trackers/types.js';
import type { AgentPlugin, AgentExecutionHandle } from '../plugins/agents/types.js';
import { getAgentRegistry } from '../plugins/agents/registry.js';
import { getTrackerRegistry } from '../plugins/trackers/registry.js';
import { SubagentTraceParser } from '../plugins/agents/tracing/parser.js';
import type { SubagentEvent } from '../plugins/agents/tracing/types.js';
import type { ClaudeJsonlMessage } from '../plugins/agents/builtin/claude.js';
import { createDroidStreamingJsonlParser, isDroidJsonlMessage, toClaudeJsonlMessages } from '../plugins/agents/droid/outputParser.js';
import {
  isOpenCodeTaskTool,
  openCodeTaskToClaudeMessages,
} from '../plugins/agents/opencode/outputParser.js';
import { updateSessionIteration, updateSessionStatus, updateSessionMaxIterations } from '../session/index.js';
import { saveIterationLog, buildSubagentTrace, getRecentProgressSummary, getCodebasePatternsForPrompt } from '../logs/index.js';
import { performAutoCommit } from './auto-commit.js';
import type { AgentSwitchEntry } from '../logs/index.js';
import { renderPrompt } from '../templates/index.js';

/**
 * Pattern to detect completion signal in agent output
 */
const PROMISE_COMPLETE_PATTERN = /<promise>\s*COMPLETE\s*<\/promise>/i;

/**
 * Timeout for primary agent recovery test (5 seconds).
 * This is intentionally short to avoid delays when testing if the rate limit has lifted.
 */
const PRIMARY_RECOVERY_TEST_TIMEOUT_MS = 5000;

/**
 * Minimal test prompt for checking rate limit status.
 * Kept simple to minimize token usage and allow fast response.
 */
const PRIMARY_RECOVERY_TEST_PROMPT = 'Reply with just the word "ok".';

/**
 * Build prompt for the agent based on task using the template system.
 * Falls back to a hardcoded default if template rendering fails.
 * Includes recent progress from previous iterations for context.
 * Includes PRD context if the tracker provides it.
 * Uses the tracker's getTemplate() method for plugin-owned templates.
 */
async function buildPrompt(
  task: TrackerTask,
  config: RalphConfig,
  tracker?: TrackerPlugin
): Promise<string> {
  // Load recent progress for context (last 5 iterations)
  const recentProgress = await getRecentProgressSummary(config.cwd, 5);

  // Load codebase patterns from progress.md (if any exist)
  const codebasePatterns = await getCodebasePatternsForPrompt(config.cwd);

  // Get template from tracker plugin (new architecture: templates owned by plugins)
  // Use optional call syntax since not all tracker plugins implement getTemplate
  const trackerTemplate = tracker?.getTemplate?.();

  // Get PRD context if the tracker supports it
  const prdContext = await tracker?.getPrdContext?.();

  // Build extended template context with PRD data and patterns
  const extendedContext = {
    recentProgress,
    codebasePatterns,
    prd: prdContext ?? undefined,
  };

  // Use the template system (tracker template used if no custom/user override)
  const result = renderPrompt(task, config, undefined, extendedContext, trackerTemplate);

  if (result.success && result.prompt) {
    return result.prompt;
  }

  // Log template error and fall back to simple format
  console.error(`Template rendering failed: ${result.error}`);

  // Fallback prompt
  const lines: string[] = [];
  lines.push('## Task');
  lines.push(`**ID**: ${task.id}`);
  lines.push(`**Title**: ${task.title}`);

  if (task.description) {
    lines.push('');
    lines.push('## Description');
    lines.push(task.description);
  }

  lines.push('');
  lines.push('## Instructions');
  lines.push('Complete the task described above. When finished, signal completion with:');
  lines.push('<promise>COMPLETE</promise>');

  return lines.join('\n');
}

/**
 * Options for initializing the engine in worker mode.
 * Used by parallel workers to inject a pre-initialized tracker
 * and force the engine to work on a specific task.
 */
export interface WorkerModeOptions {
  /** Pre-initialized tracker plugin (avoids re-initializing in worktree) */
  tracker: TrackerPlugin;
  /** The specific task this engine should work on */
  forcedTask: TrackerTask;
}

/**
 * Execution engine for the agent loop
 */
export class ExecutionEngine {
  private config: RalphConfig;
  private agent: AgentPlugin | null = null;
  private tracker: TrackerPlugin | null = null;
  private listeners: EngineEventListener[] = [];
  private state: EngineState;
  private currentExecution: AgentExecutionHandle | null = null;
  private shouldStop = false;
  /** Track retry attempts per task */
  private retryCountMap: Map<string, number> = new Map();
  /** Track skipped tasks to avoid retrying them */
  private skippedTasks: Set<string> = new Set();
  /** Parser for extracting subagent lifecycle events from agent output */
  private subagentParser: SubagentTraceParser;
  /** Rate limit detector for parsing agent output */
  private rateLimitDetector: RateLimitDetector;
  /** Track rate limit retry attempts per task (separate from generic retries) */
  private rateLimitRetryMap: Map<string, number> = new Map();
  /** Rate limit handling configuration */
  private rateLimitConfig: Required<RateLimitHandlingConfig>;
  /** Track agents that have been rate-limited for the current task (cleared on task completion) */
  private rateLimitedAgents: Set<string> = new Set();
  /** Primary agent instance - preserved when switching to fallback for recovery attempts */
  private primaryAgentInstance: AgentPlugin | null = null;
  /** Track agent switches during the current iteration for logging */
  private currentIterationAgentSwitches: AgentSwitchEntry[] = [];
  /** Forced task for worker mode — engine only works on this one task */
  private forcedTask: TrackerTask | null = null;
  /** Track if the forced task has been processed (prevents infinite loop on skip/fail) */
  private forcedTaskProcessed = false;

  constructor(config: RalphConfig) {
    this.config = config;
    this.state = {
      status: 'idle',
      currentIteration: 0,
      currentTask: null,
      totalTasks: 0,
      tasksCompleted: 0,
      iterations: [],
      startedAt: null,
      currentOutput: '',
      currentStderr: '',
      subagents: new Map(),
      activeAgent: null,
      rateLimitState: null,
    };

    // Initialize subagent parser with event handler
    this.subagentParser = new SubagentTraceParser({
      onEvent: (event) => this.handleSubagentEvent(event),
      trackHierarchy: true,
    });

    // Initialize rate limit detector
    this.rateLimitDetector = new RateLimitDetector();

    // Get rate limit handling config from agent config or use defaults
    const agentRateLimitConfig = this.config.agent.rateLimitHandling;
    this.rateLimitConfig = {
      ...DEFAULT_RATE_LIMIT_HANDLING,
      ...agentRateLimitConfig,
    };
  }

  /**
   * Initialize the engine with plugins.
   *
   * @param workerMode - Optional worker mode options for parallel execution.
   *   When provided, the engine uses the injected tracker and works only on
   *   the forced task, skipping tracker initialization and sync.
   */
  async initialize(workerMode?: WorkerModeOptions): Promise<void> {
    // Get agent instance
    const agentRegistry = getAgentRegistry();
    this.agent = await agentRegistry.getInstance(this.config.agent);

    // Detect agent availability
    const detectResult = await this.agent.detect();
    if (!detectResult.available) {
      throw new Error(
        `Agent '${this.config.agent.plugin}' not available: ${detectResult.error}`
      );
    }

    // Validate model if specified
    if (this.config.model) {
      const modelError = this.agent.validateModel(this.config.model);
      if (modelError) {
        throw new Error(modelError);
      }
    }

    // Store reference to primary agent for recovery attempts
    this.primaryAgentInstance = this.agent;

    // Initialize active agent state
    const now = new Date().toISOString();
    this.state.activeAgent = {
      plugin: this.config.agent.plugin,
      reason: 'primary',
      since: now,
    };

    // Initialize rate limit state tracking the primary agent
    this.state.rateLimitState = {
      primaryAgent: this.config.agent.plugin,
    };

    if (workerMode) {
      // Worker mode: use injected tracker and forced task.
      // This avoids re-initializing the tracker in a worktree directory
      // where the beads/tracker data may not be accessible.
      this.tracker = workerMode.tracker;
      this.forcedTask = workerMode.forcedTask;
      this.state.totalTasks = 1;
    } else {
      // Normal mode: initialize tracker from config
      const trackerRegistry = getTrackerRegistry();
      this.tracker = await trackerRegistry.getInstance(this.config.tracker);

      // Sync tracker
      await this.tracker.sync();

      // Get initial task count
      const tasks = await this.tracker.getTasks({ status: ['open', 'in_progress'] });
      this.state.totalTasks = tasks.length;
    }
  }

  /**
   * Add event listener
   */
  on(listener: EngineEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  /**
   * Get current engine state
   */
  getState(): Readonly<EngineState> {
    return { ...this.state };
  }

  /**
   * Get current status
   */
  getStatus(): EngineStatus {
    return this.state.status;
  }

  /**
   * Refresh the task list from the tracker and emit a tasks:refreshed event.
   * Call this when the user wants to manually refresh the task list (e.g., 'r' key).
   */
  async refreshTasks(): Promise<void> {
    if (!this.tracker) {
      return;
    }

    // Fetch all tasks including completed for TUI display
    const tasks = await this.tracker.getTasks({
      status: ['open', 'in_progress', 'completed'],
    });

    // Update total task count (open/in_progress only)
    const activeTasks = tasks.filter(
      (t) => t.status === 'open' || t.status === 'in_progress'
    );
    this.state.totalTasks = activeTasks.length;

    this.emit({
      type: 'tasks:refreshed',
      timestamp: new Date().toISOString(),
      tasks,
    });
  }

  /**
   * Generate a preview of the prompt that would be sent to the agent for a given task.
   * Useful for debugging and understanding what the agent will receive.
   *
   * @param taskId - The ID of the task to generate prompt for
   * @returns Object with prompt content and template source, or error message
   */
  async generatePromptPreview(
    taskId: string
  ): Promise<{ success: true; prompt: string; source: string } | { success: false; error: string }> {
    if (!this.tracker) {
      return { success: false, error: 'No tracker configured' };
    }

    // Get the task (include completed tasks so we can review prompts after execution)
    const tasks = await this.tracker.getTasks({ status: ['open', 'in_progress', 'completed'] });
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      return { success: false, error: `Task not found: ${taskId}` };
    }

    // Get tracker template (if tracker provides one)
    const trackerTemplate = this.tracker.getTemplate?.();

    // Get recent progress summary for context
    const recentProgress = await getRecentProgressSummary(this.config.cwd, 5);

    // Get codebase patterns from progress.md (if any exist)
    const codebasePatterns = await getCodebasePatternsForPrompt(this.config.cwd);

    // Get PRD context if the tracker supports it
    const prdContext = await this.tracker.getPrdContext?.();

    // Build extended template context with PRD data and patterns
    const extendedContext = {
      recentProgress,
      codebasePatterns,
      prd: prdContext ?? undefined,
    };

    // Generate the prompt
    const result = renderPrompt(task, this.config, undefined, extendedContext, trackerTemplate);

    if (!result.success || !result.prompt) {
      return { success: false, error: result.error ?? 'Unknown error generating prompt' };
    }

    return {
      success: true,
      prompt: result.prompt,
      source: result.source ?? 'unknown',
    };
  }

  /**
   * Start the execution loop
   */
  async start(): Promise<void> {
    if (this.state.status !== 'idle') {
      throw new Error(`Cannot start engine in ${this.state.status} state`);
    }

    if (!this.agent || !this.tracker) {
      throw new Error('Engine not initialized');
    }

    this.state.status = 'running';
    this.state.startedAt = new Date().toISOString();
    this.shouldStop = false;

    // Fetch all tasks including completed for TUI display
    // Open/in_progress tasks are actionable; completed tasks are for historical view
    const initialTasks = await this.tracker.getTasks({
      status: ['open', 'in_progress', 'completed'],
    });

    this.emit({
      type: 'engine:started',
      timestamp: new Date().toISOString(),
      sessionId: '',
      totalTasks: this.state.totalTasks, // Only counts open/in_progress
      tasks: initialTasks,
    });

    // Warn if sandbox network is disabled but agent requires network
    if (
      this.config.sandbox?.enabled &&
      this.config.sandbox?.network === false &&
      this.agent!.getSandboxRequirements().requiresNetwork
    ) {
      this.emit({
        type: 'engine:warning',
        timestamp: new Date().toISOString(),
        code: 'sandbox-network-conflict',
        message: `Warning: Agent '${this.config.agent.plugin}' requires network access but --no-network is enabled. LLM API calls will fail.`,
      });
    }

    try {
      await this.runLoop();
    } finally {
      this.state.status = 'idle';
    }
  }

  /**
   * Main execution loop
   */
  private async runLoop(): Promise<void> {
    while (!this.shouldStop) {
      // Check if pausing - if so, transition to paused and wait
      if (this.state.status === 'pausing') {
        this.state.status = 'paused';
        this.emit({
          type: 'engine:paused',
          timestamp: new Date().toISOString(),
          currentIteration: this.state.currentIteration,
        });

        // Wait until resumed
        while (this.state.status === 'paused' && !this.shouldStop) {
          await this.delay(100); // Poll every 100ms
        }

        // If we were stopped while paused, exit the loop
        if (this.shouldStop) {
          break;
        }

        // Emit resumed event and continue
        this.emit({
          type: 'engine:resumed',
          timestamp: new Date().toISOString(),
          fromIteration: this.state.currentIteration,
        });
      }

      // Attempt primary agent recovery at the start of each iteration
      // This allows the engine to switch back to the preferred agent when rate limits lift
      if (this.shouldRecoverPrimaryAgent()) {
        await this.attemptPrimaryAgentRecovery();
      }

      // Check max iterations
      if (
        this.config.maxIterations > 0 &&
        this.state.currentIteration >= this.config.maxIterations
      ) {
        this.emit({
          type: 'engine:stopped',
          timestamp: new Date().toISOString(),
          reason: 'max_iterations',
          totalIterations: this.state.currentIteration,
          tasksCompleted: this.state.tasksCompleted,
        });
        break;
      }

      // Check if all tasks complete.
      // In worker mode, check only the forced task (not the global tracker).
      const isComplete = this.forcedTask
        ? this.state.tasksCompleted >= 1
        : await this.tracker!.isComplete();
      if (isComplete) {
        this.emit({
          type: 'all:complete',
          timestamp: new Date().toISOString(),
          totalCompleted: this.state.tasksCompleted,
          totalIterations: this.state.currentIteration,
        });
        this.emit({
          type: 'engine:stopped',
          timestamp: new Date().toISOString(),
          reason: 'completed',
          totalIterations: this.state.currentIteration,
          tasksCompleted: this.state.tasksCompleted,
        });
        break;
      }

      // Get next task (excluding skipped tasks)
      const task = await this.getNextAvailableTask();
      if (!task) {
        this.emit({
          type: 'engine:stopped',
          timestamp: new Date().toISOString(),
          reason: 'no_tasks',
          totalIterations: this.state.currentIteration,
          tasksCompleted: this.state.tasksCompleted,
        });
        break;
      }

      // Run iteration with error handling
      const result = await this.runIterationWithErrorHandling(task);

      // Check if we should abort
      if (result.status === 'failed' && this.config.errorHandling.strategy === 'abort') {
        this.emit({
          type: 'engine:stopped',
          timestamp: new Date().toISOString(),
          reason: 'error',
          totalIterations: this.state.currentIteration,
          tasksCompleted: this.state.tasksCompleted,
        });
        break;
      }

      // Update session
      await updateSessionIteration(
        this.config.cwd,
        this.state.currentIteration,
        this.state.tasksCompleted
      );

      // Wait between iterations
      if (this.config.iterationDelay > 0 && !this.shouldStop) {
        await this.delay(this.config.iterationDelay);
      }
    }
  }

  /**
   * Get the next available task, excluding skipped ones.
   * Delegates to the tracker's getNextTask() for proper dependency-aware ordering.
   * See: https://github.com/subsy/ralph-tui/issues/97
   *
   * In worker mode (forcedTask set), returns the forced task until it's completed,
   * then returns null to stop the engine.
   */
  private async getNextAvailableTask(): Promise<TrackerTask | null> {
    // Worker mode: return the forced task until it's been processed (completed, skipped, or failed)
    if (this.forcedTask) {
      if (this.state.tasksCompleted >= 1 || this.forcedTaskProcessed) {
        return null; // Task was processed, stop the engine
      }
      return this.forcedTask;
    }

    // Convert skipped tasks Set to array for the filter
    const excludeIds = Array.from(this.skippedTasks);

    // Delegate to tracker's getNextTask for dependency-aware ordering
    // The tracker (e.g., beads) uses bd ready which properly handles dependencies
    const task = await this.tracker!.getNextTask({
      status: ['open', 'in_progress'],
      excludeIds: excludeIds.length > 0 ? excludeIds : undefined,
    });

    return task ?? null;
  }

  /**
   * Run iteration with error handling strategy
   */
  private async runIterationWithErrorHandling(task: TrackerTask): Promise<IterationResult> {
    const errorConfig = this.config.errorHandling;
    let result = await this.runIteration(task);
    this.state.iterations.push(result);

    // Handle success
    if (result.status !== 'failed') {
      if (result.taskCompleted) {
        this.state.tasksCompleted++;
        // Clear retry count on success
        this.retryCountMap.delete(task.id);
      }
      return result;
    }

    // Handle failure according to strategy
    const errorMessage = result.error ?? 'Unknown error';

    switch (errorConfig.strategy) {
      case 'retry': {
        const currentRetries = this.retryCountMap.get(task.id) ?? 0;

        if (currentRetries < errorConfig.maxRetries) {
          // Emit failed event with retry action
          this.emit({
            type: 'iteration:failed',
            timestamp: new Date().toISOString(),
            iteration: this.state.currentIteration,
            error: errorMessage,
            task,
            action: 'retry',
          });

          // Emit retry event
          this.emit({
            type: 'iteration:retrying',
            timestamp: new Date().toISOString(),
            iteration: this.state.currentIteration,
            retryAttempt: currentRetries + 1,
            maxRetries: errorConfig.maxRetries,
            task,
            previousError: errorMessage,
            delayMs: errorConfig.retryDelayMs,
          });

          // Update retry count
          this.retryCountMap.set(task.id, currentRetries + 1);

          // Wait before retry
          if (errorConfig.retryDelayMs > 0 && !this.shouldStop) {
            await this.delay(errorConfig.retryDelayMs);
          }

          // Recursively retry
          if (!this.shouldStop) {
            return this.runIterationWithErrorHandling(task);
          }
        } else {
          // Max retries exceeded - treat as skip
          const skipReason = `Max retries (${errorConfig.maxRetries}) exceeded: ${errorMessage}`;
          this.emit({
            type: 'iteration:failed',
            timestamp: new Date().toISOString(),
            iteration: this.state.currentIteration,
            error: skipReason,
            task,
            action: 'skip',
          });
          this.emitSkipEvent(task, skipReason);
          this.skippedTasks.add(task.id);
          this.retryCountMap.delete(task.id);
          // Mark forced task as processed to prevent infinite loop
          if (this.forcedTask?.id === task.id) {
            this.forcedTaskProcessed = true;
          }
        }
        break;
      }

      case 'skip': {
        // Emit failed event with skip action
        this.emit({
          type: 'iteration:failed',
          timestamp: new Date().toISOString(),
          iteration: this.state.currentIteration,
          error: errorMessage,
          task,
          action: 'skip',
        });
        this.emitSkipEvent(task, errorMessage);
        this.skippedTasks.add(task.id);
        // Mark forced task as processed to prevent infinite loop
        if (this.forcedTask?.id === task.id) {
          this.forcedTaskProcessed = true;
        }
        break;
      }

      case 'abort': {
        // Emit failed event with abort action
        this.emit({
          type: 'iteration:failed',
          timestamp: new Date().toISOString(),
          iteration: this.state.currentIteration,
          error: errorMessage,
          task,
          action: 'abort',
        });
        // Mark forced task as processed to prevent infinite loop
        if (this.forcedTask?.id === task.id) {
          this.forcedTaskProcessed = true;
        }
        break;
      }
    }

    return result;
  }

  /**
   * Emit a skip event for a task
   */
  private emitSkipEvent(task: TrackerTask, reason: string): void {
    this.emit({
      type: 'iteration:skipped',
      timestamp: new Date().toISOString(),
      iteration: this.state.currentIteration,
      task,
      reason,
    });
  }

  /**
   * Check agent output for rate limit conditions.
   * Returns detection result if rate limit is detected.
   */
  private checkForRateLimit(
    stdout: string,
    stderr: string,
    exitCode?: number
  ): RateLimitDetectionResult {
    if (!this.rateLimitConfig.enabled) {
      return { isRateLimit: false };
    }

    return this.rateLimitDetector.detect({
      stderr,
      stdout,
      exitCode,
      agentId: this.config.agent.plugin,
    });
  }

  /**
   * Handle rate limit with exponential backoff retry.
   * Returns true if retry should be attempted, false if max retries exceeded.
   *
   * @param task - The task that hit the rate limit
   * @param rateLimitResult - The rate limit detection result
   * @param iteration - Current iteration number
   * @returns true if engine should retry the task
   */
  private async handleRateLimitWithBackoff(
    task: TrackerTask,
    rateLimitResult: RateLimitDetectionResult,
    iteration: number
  ): Promise<boolean> {
    const currentRetries = this.rateLimitRetryMap.get(task.id) ?? 0;
    const maxRetries = this.rateLimitConfig.maxRetries;

    // Check if we've exhausted retries
    if (currentRetries >= maxRetries) {
      // Clear retry count - fallback will handle this
      this.rateLimitRetryMap.delete(task.id);
      return false;
    }

    // Calculate backoff delay
    const { delayMs, usedRetryAfter } = this.calculateBackoffDelay(
      currentRetries,
      rateLimitResult.retryAfter
    );

    // Increment retry count
    this.rateLimitRetryMap.set(task.id, currentRetries + 1);

    // Emit rate limit event
    const event: IterationRateLimitedEvent = {
      type: 'iteration:rate-limited',
      timestamp: new Date().toISOString(),
      iteration,
      task,
      retryAttempt: currentRetries + 1,
      maxRetries,
      delayMs,
      rateLimitMessage: rateLimitResult.message,
      usedRetryAfter,
    };
    this.emit(event);

    // Log retry attempt
    const delaySeconds = Math.round(delayMs / 1000);
    const retrySource = usedRetryAfter ? 'from retryAfter header' : 'exponential backoff';
    console.log(
      `[rate-limit] Retry ${currentRetries + 1}/${maxRetries} in ${delaySeconds}s (${retrySource})`
    );

    // Wait for backoff delay
    if (!this.shouldStop) {
      await this.delay(delayMs);
    }

    return !this.shouldStop;
  }

  /**
   * Clear rate limit retry count for a task (called on success).
   */
  private clearRateLimitRetryCount(taskId: string): void {
    this.rateLimitRetryMap.delete(taskId);
  }

  /**
   * Run a single iteration
   */
  private async runIteration(task: TrackerTask): Promise<IterationResult> {
    this.state.currentIteration++;
    this.state.currentTask = task;
    this.state.currentOutput = '';
    this.state.currentStderr = '';

    // Reset subagent tracking for this iteration
    this.state.subagents.clear();
    this.subagentParser.reset();

    // Reset agent switch tracking for this iteration
    this.currentIterationAgentSwitches = [];

    const startedAt = new Date();
    const iteration = this.state.currentIteration;

    this.emit({
      type: 'iteration:started',
      timestamp: startedAt.toISOString(),
      iteration,
      task,
    });

    this.emit({
      type: 'task:selected',
      timestamp: new Date().toISOString(),
      task,
      iteration,
    });

    // Update task status to in_progress
    await this.tracker!.updateTaskStatus(task.id, 'in_progress');

    // Emit task:activated for crash recovery tracking
    // This allows the session to track which tasks it "owns" for reset on shutdown
    this.emit({
      type: 'task:activated',
      timestamp: new Date().toISOString(),
      task,
      iteration,
    });

    // Build prompt (includes recent progress context + tracker-owned template)
    const prompt = await buildPrompt(task, this.config, this.tracker ?? undefined);

    // Build agent flags
    const flags: string[] = [];
    if (this.config.model) {
      flags.push('--model', this.config.model);
    }

    // Check if agent declares subagent tracing support (used for agent-specific flags)
    const supportsTracing = this.agent!.meta.supportsSubagentTracing;

    // For Droid agent, we need a JSONL parser since it uses a different output format.
    // For Claude and OpenCode, we use the onJsonlMessage callback which gets pre-parsed messages.
    const isDroidAgent = this.agent?.meta.id === 'droid';
    const droidJsonlParser = isDroidAgent ? createDroidStreamingJsonlParser() : null;

    try {
      // Execute agent with subagent tracing if supported
      const handle = this.agent!.execute(prompt, [], {
        cwd: this.config.cwd,
        flags,
        sandbox: this.config.sandbox,
        subagentTracing: supportsTracing,
        // Callback for pre-parsed JSONL messages (used by Claude and OpenCode plugins)
        // This receives raw JSON objects directly from the agent's parsed JSONL output.
        onJsonlMessage: (message: Record<string, unknown>) => {
          // Check if this is OpenCode format (has 'part' with 'tool' property)
          const part = message.part as Record<string, unknown> | undefined;
          if (message.type === 'tool_use' && part?.tool) {
            // OpenCode format - convert using OpenCode parser
            const openCodeMessage = {
              source: 'opencode' as const,
              type: message.type as string,
              timestamp: message.timestamp as number | undefined,
              sessionID: message.sessionID as string | undefined,
              part: part as import('../plugins/agents/opencode/outputParser.js').OpenCodePart,
              raw: message,
            };
            // Check if it's a Task tool and convert to Claude format
            if (isOpenCodeTaskTool(openCodeMessage)) {
              for (const claudeMessage of openCodeTaskToClaudeMessages(openCodeMessage)) {
                this.subagentParser.processMessage(claudeMessage);
              }
            }
            return;
          }

          // Claude format - convert raw JSON to ClaudeJsonlMessage format for SubagentParser
          const claudeMessage: ClaudeJsonlMessage = {
            type: message.type as string | undefined,
            message: message.message as string | undefined,
            tool: message.tool as { name?: string; input?: Record<string, unknown> } | undefined,
            result: message.result,
            cost: message.cost as { inputTokens?: number; outputTokens?: number; totalUSD?: number } | undefined,
            sessionId: message.sessionId as string | undefined,
            raw: message,
          };
          this.subagentParser.processMessage(claudeMessage);
        },
        onStdout: (data) => {
          this.state.currentOutput += data;
          this.emit({
            type: 'agent:output',
            timestamp: new Date().toISOString(),
            stream: 'stdout',
            data,
            iteration,
          });

          // For Droid agent, parse JSONL output for subagent events
          // (Claude uses onJsonlMessage callback instead)
          if (droidJsonlParser && isDroidAgent) {
            const results = droidJsonlParser.push(data);
            for (const result of results) {
              if (result.success) {
                if (isDroidJsonlMessage(result.message)) {
                  for (const normalized of toClaudeJsonlMessages(result.message)) {
                    this.subagentParser.processMessage(normalized);
                  }
                } else {
                  this.subagentParser.processMessage(result.message);
                }
              }
            }
          }

        },
        onStderr: (data) => {
          this.state.currentStderr += data;
          this.emit({
            type: 'agent:output',
            timestamp: new Date().toISOString(),
            stream: 'stderr',
            data,
            iteration,
          });
        },
      });

      this.currentExecution = handle;

      // Wait for completion
      const agentResult = await handle.promise;
      this.currentExecution = null;

      // Flush any remaining buffered JSONL data for Droid agent
      if (droidJsonlParser && isDroidAgent) {
        const remaining = droidJsonlParser.flush();
        for (const result of remaining) {
          if (result.success) {
            if (isDroidJsonlMessage(result.message)) {
              for (const normalized of toClaudeJsonlMessages(result.message)) {
                this.subagentParser.processMessage(normalized);
              }
            } else {
              this.subagentParser.processMessage(result.message);
            }
          }
        }
      }

      // Check for rate limit condition before processing result
      const rateLimitResult = this.checkForRateLimit(
        agentResult.stdout,
        agentResult.stderr,
        agentResult.exitCode
      );

      if (rateLimitResult.isRateLimit) {
        // Handle rate limit with exponential backoff
        const shouldRetry = await this.handleRateLimitWithBackoff(
          task,
          rateLimitResult,
          iteration
        );

        if (shouldRetry) {
          // Recursively retry the iteration
          // Decrement iteration count since runIteration increments it
          this.state.currentIteration--;
          return this.runIteration(task);
        }

        // Max retries exceeded for current agent - try fallback agent
        const currentAgentPlugin = this.state.activeAgent?.plugin ?? this.config.agent.plugin;
        this.rateLimitedAgents.add(currentAgentPlugin);

        // Try to switch to fallback agent
        const fallbackResult = await this.tryFallbackAgent(task, iteration, startedAt);
        if (fallbackResult.switched) {
          // Successfully switched to fallback - retry the iteration with new agent
          this.state.currentIteration--;
          return this.runIteration(task);
        }

        // No fallback available - all agents are rate limited
        if (fallbackResult.allAgentsLimited) {
          // Emit allAgentsLimited event and pause execution
          const allLimitedEvent: AllAgentsLimitedEvent = {
            type: 'agent:all-limited',
            timestamp: new Date().toISOString(),
            task,
            triedAgents: Array.from(this.rateLimitedAgents),
            rateLimitState: this.state.rateLimitState!,
          };
          this.emit(allLimitedEvent);

          // Pause the engine - user intervention required
          this.pause();
        }

        // Return as failed with rate limit error
        const endedAt = new Date();
        return {
          iteration,
          status: 'failed',
          task,
          taskCompleted: false,
          promiseComplete: false,
          durationMs: endedAt.getTime() - startedAt.getTime(),
          error: `Rate limit exceeded after ${this.rateLimitConfig.maxRetries} retries: ${rateLimitResult.message}`,
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
        };
      }

      // Clear rate limit retry count on successful execution (no rate limit)
      this.clearRateLimitRetryCount(task.id);

      const endedAt = new Date();
      const durationMs = endedAt.getTime() - startedAt.getTime();

      // Check for completion signal
      const promiseComplete = PROMISE_COMPLETE_PATTERN.test(agentResult.stdout);

      // Determine if task was completed
      const taskCompleted =
        promiseComplete || agentResult.status === 'completed';

      // Update tracker if task completed
      if (taskCompleted) {
        await this.tracker!.completeTask(task.id, 'Completed by agent');
        this.emit({
          type: 'task:completed',
          timestamp: new Date().toISOString(),
          task,
          iteration,
        });

        // Clear rate-limited agents tracking on task completion
        // This allows agents to be retried for the next task
        this.clearRateLimitedAgents();
      }

      // Auto-commit after task completion (before iteration log is saved)
      if (taskCompleted && this.config.autoCommit) {
        await this.handleAutoCommit(task, iteration);
      }

      // Determine iteration status
      let status: IterationStatus;
      if (agentResult.interrupted) {
        status = 'interrupted';
      } else if (agentResult.status === 'failed') {
        status = 'failed';
      } else {
        status = 'completed';
      }

      const result: IterationResult = {
        iteration,
        status,
        task,
        agentResult,
        taskCompleted,
        promiseComplete,
        durationMs,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
      };

      // Save iteration output to .ralph-tui/iterations/ directory
      // Include subagent trace if any subagents were spawned
      const events = this.subagentParser.getEvents();
      const states = this.subagentParser.getAllSubagents();
      const subagentTrace =
        events.length > 0 ? buildSubagentTrace(events, states) : undefined;

      // Build completion summary if agent switches occurred
      const completionSummary = this.buildCompletionSummary(result);

      await saveIterationLog(this.config.cwd, result, agentResult.stdout, agentResult.stderr ?? this.state.currentStderr, {
        config: this.config,
        sessionId: this.config.sessionId,
        subagentTrace,
        agentSwitches: this.currentIterationAgentSwitches.length > 0 ? [...this.currentIterationAgentSwitches] : undefined,
        completionSummary,
        sandboxConfig: this.config.sandbox,
      });

      this.emit({
        type: 'iteration:completed',
        timestamp: endedAt.toISOString(),
        result,
      });

      return result;
    } catch (error) {
      const endedAt = new Date();
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Note: We don't emit iteration:failed here anymore - it's handled
      // by runIterationWithErrorHandling which determines the action.
      // This keeps the error handling logic centralized.

      const failedResult: IterationResult = {
        iteration,
        status: 'failed',
        task,
        taskCompleted: false,
        promiseComplete: false,
        durationMs: endedAt.getTime() - startedAt.getTime(),
        error: errorMessage,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
      };

      return failedResult;
    } finally {
      this.state.currentTask = null;
    }
  }

  /**
   * Stop the execution loop
   */
  async stop(): Promise<void> {
    this.shouldStop = true;
    this.state.status = 'stopping';

    // Interrupt current execution if any
    if (this.currentExecution) {
      this.currentExecution.interrupt();
    }

    // Update session status
    await updateSessionStatus(this.config.cwd, 'interrupted');

    this.emit({
      type: 'engine:stopped',
      timestamp: new Date().toISOString(),
      reason: 'interrupted',
      totalIterations: this.state.currentIteration,
      tasksCompleted: this.state.tasksCompleted,
    });
  }

  /**
   * Request to pause the execution loop after the current iteration completes.
   * If already pausing or paused, this is a no-op.
   */
  pause(): void {
    if (this.state.status !== 'running') {
      return;
    }

    // Set to 'pausing' - the loop will transition to 'paused' after the current iteration
    this.state.status = 'pausing';
    // Note: We don't emit engine:paused here. That happens in runLoop when we actually pause.
  }

  /**
   * Resume the execution loop from a paused state.
   * This can also be used to cancel a pending pause (when status is 'pausing').
   */
  resume(): void {
    if (this.state.status === 'pausing') {
      // Cancel the pending pause - just go back to running
      this.state.status = 'running';
      return;
    }

    if (this.state.status !== 'paused') {
      return;
    }

    // Resume from paused state - the runLoop will detect this and continue
    this.state.status = 'running';
    // Note: engine:resumed event is emitted in runLoop when we actually resume
  }

  /**
   * Check if the engine is pausing or paused
   */
  isPaused(): boolean {
    return this.state.status === 'paused';
  }

  /**
   * Check if the engine is in the process of pausing
   */
  isPausing(): boolean {
    return this.state.status === 'pausing';
  }

  /**
   * Add iterations to maxIterations at runtime.
   * Useful for extending a session without stopping.
   * @param count - Number of iterations to add (must be positive)
   * @returns true if the engine should be restarted (was idle after hitting max_iterations)
   */
  async addIterations(count: number): Promise<boolean> {
    if (count <= 0) {
      return false;
    }

    const previousMax = this.config.maxIterations;
    // Handle unlimited case (0 means unlimited) - true no-op
    if (previousMax === 0) {
      return false;
    }

    const newMax = previousMax + count;

    // Check if we should restart (engine is idle and we're adding to a non-unlimited max)
    const shouldRestart = this.state.status === 'idle' && previousMax > 0;

    // Update config
    this.config.maxIterations = newMax;

    // Persist to session
    await updateSessionMaxIterations(this.config.cwd, newMax);

    // Emit event
    this.emit({
      type: 'engine:iterations-added',
      timestamp: new Date().toISOString(),
      added: count,
      newMax,
      previousMax,
      currentIteration: this.state.currentIteration,
    });

    return shouldRestart;
  }

  /**
   * Remove iterations from maxIterations at runtime.
   * Useful for limiting a session that's running longer than expected.
   * @param count - Number of iterations to remove (must be positive)
   * @returns true if successful, false if removal would go below 1 or current iteration
   */
  async removeIterations(count: number): Promise<boolean> {
    if (count <= 0) {
      return false;
    }

    const previousMax = this.config.maxIterations;
    // Handle unlimited case (0 means unlimited) - cannot reduce unlimited
    if (previousMax === 0) {
      return false;
    }

    // Calculate new max, but don't go below 1 or current iteration
    const minAllowed = Math.max(1, this.state.currentIteration);
    const newMax = Math.max(minAllowed, previousMax - count);

    // Check if we actually made a change
    if (newMax === previousMax) {
      return false;
    }

    // Update config
    this.config.maxIterations = newMax;

    // Persist to session
    await updateSessionMaxIterations(this.config.cwd, newMax);

    // Emit event
    this.emit({
      type: 'engine:iterations-removed',
      timestamp: new Date().toISOString(),
      removed: previousMax - newMax,
      newMax,
      previousMax,
      currentIteration: this.state.currentIteration,
    });

    return true;
  }

  /**
   * Continue execution after adding more iterations.
   * Call this after addIterations() returns true.
   */
  async continueExecution(): Promise<void> {
    if (this.state.status !== 'idle') {
      return; // Only continue from idle state
    }

    if (!this.agent || !this.tracker) {
      throw new Error('Engine not initialized');
    }

    this.state.status = 'running';
    this.shouldStop = false;

    // Emit resumed event
    this.emit({
      type: 'engine:resumed',
      timestamp: new Date().toISOString(),
      fromIteration: this.state.currentIteration,
    });

    try {
      await this.runLoop();
    } finally {
      this.state.status = 'idle';
    }
  }

  /**
   * Get current iteration info.
   * @returns Object with currentIteration and maxIterations
   */
  getIterationInfo(): { currentIteration: number; maxIterations: number } {
    return {
      currentIteration: this.state.currentIteration,
      maxIterations: this.config.maxIterations,
    };
  }

  /**
   * Delay for specified milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Calculate exponential backoff delay for rate limit retries.
   * Uses formula: baseBackoffMs * 3^attempt (5s, 15s, 45s with default 5s base)
   *
   * @param attempt - The retry attempt number (0-based)
   * @param retryAfter - Optional retryAfter value from rate limit response (in seconds)
   * @returns Object with delay in milliseconds and whether retryAfter was used
   */
  private calculateBackoffDelay(
    attempt: number,
    retryAfter?: number
  ): { delayMs: number; usedRetryAfter: boolean } {
    // If retryAfter is provided from the rate limit response, use it
    if (retryAfter !== undefined && retryAfter > 0) {
      return {
        delayMs: retryAfter * 1000, // Convert seconds to milliseconds
        usedRetryAfter: true,
      };
    }

    // Otherwise calculate exponential backoff: base * 3^attempt
    // With default base of 5000ms: 5s, 15s, 45s
    const delayMs = this.rateLimitConfig.baseBackoffMs * Math.pow(3, attempt);
    return {
      delayMs,
      usedRetryAfter: false,
    };
  }

  /**
   * Reset specific task IDs back to open status.
   * Used during graceful shutdown to release tasks that were set to in_progress
   * by this session but not completed.
   *
   * @param taskIds - Array of task IDs to reset to open
   * @returns Number of tasks successfully reset
   */
  async resetTasksToOpen(taskIds: string[]): Promise<number> {
    if (!this.tracker || taskIds.length === 0) {
      return 0;
    }

    let resetCount = 0;
    for (const taskId of taskIds) {
      try {
        await this.tracker.updateTaskStatus(taskId, 'open');
        resetCount++;
      } catch {
        // Silently continue on individual task reset failures
        // The task may have been deleted or modified externally
      }
    }

    return resetCount;
  }

  /**
   * Get the tracker instance for external operations.
   * Used by the run command for stale task detection and reset.
   */
  getTracker(): TrackerPlugin | null {
    return this.tracker;
  }

  /**
   * Handle a subagent event from the parser and update engine state.
   */
  private handleSubagentEvent(event: SubagentEvent): void {
    const parserState = this.subagentParser.getSubagent(event.id);
    if (!parserState) {
      return;
    }

    // Calculate depth for this subagent
    const depth = this.calculateSubagentDepth(event.id);

    // Convert to engine state format and update map
    const engineState = toEngineSubagentState(parserState, depth);
    this.state.subagents.set(event.id, engineState);
  }

  /**
   * Calculate the nesting depth for a subagent.
   * Top-level subagents have depth 1, their children have depth 2, etc.
   */
  private calculateSubagentDepth(subagentId: string): number {
    let depth = 1;
    let current = this.subagentParser.getSubagent(subagentId);

    while (current?.parentId) {
      depth++;
      current = this.subagentParser.getSubagent(current.parentId);
    }

    return depth;
  }

  /**
   * Get output/result for a specific subagent by ID.
   * For completed subagents, returns their result content.
   * For running subagents, returns undefined (use currentOutput for live streaming).
   *
   * @param id - Subagent ID to get output for
   * @returns Subagent result content, or undefined if not found or still running
   */
  getSubagentOutput(id: string): string | undefined {
    const state = this.subagentParser.getSubagent(id);
    if (!state) return undefined;
    // Return result only for completed/errored subagents
    if (state.status === 'completed' || state.status === 'error') {
      return state.result;
    }
    return undefined;
  }

  /**
   * Get detailed information about a subagent for display.
   * Returns the prompt, result, and timing information.
   *
   * @param id - Subagent ID to get details for
   * @returns Subagent details or undefined if not found
   */
  getSubagentDetails(id: string): {
    prompt?: string;
    result?: string;
    spawnedAt: string;
    endedAt?: string;
    childIds: string[];
  } | undefined {
    const state = this.subagentParser.getSubagent(id);
    if (!state) return undefined;
    return {
      prompt: state.prompt,
      result: state.result,
      spawnedAt: state.spawnedAt,
      endedAt: state.endedAt,
      childIds: state.childIds,
    };
  }

  /**
   * Get the currently active subagent ID (deepest in the hierarchy).
   * Returns undefined if no subagent is currently active.
   */
  getActiveSubagentId(): string | undefined {
    const stack = this.subagentParser.getActiveStack();
    return stack.length > 0 ? stack[0] : undefined;
  }

  /**
   * Get the subagent tree for TUI rendering.
   * Returns an array of root-level subagent tree nodes with their children nested.
   */
  getSubagentTree(): SubagentTreeNode[] {
    const roots: SubagentTreeNode[] = [];
    const nodeMap = new Map<string, SubagentTreeNode>();

    // First pass: create nodes for all subagents
    for (const state of this.state.subagents.values()) {
      nodeMap.set(state.id, {
        state,
        children: [],
      });
    }

    // Second pass: build the tree structure
    for (const state of this.state.subagents.values()) {
      const node = nodeMap.get(state.id)!;

      if (state.parentId && nodeMap.has(state.parentId)) {
        // Add as child of parent
        const parentNode = nodeMap.get(state.parentId)!;
        parentNode.children.push(node);
      } else {
        // This is a root node
        roots.push(node);
      }
    }

    return roots;
  }

  /**
   * Get the current active agent information.
   * Returns the active agent state for TUI display.
   */
  getActiveAgentInfo(): Readonly<ActiveAgentState> | null {
    return this.state.activeAgent ? { ...this.state.activeAgent } : null;
  }

  /**
   * Get the current rate limit state.
   * Returns rate limit tracking state for TUI display.
   */
  getRateLimitState(): Readonly<RateLimitState> | null {
    return this.state.rateLimitState ? { ...this.state.rateLimitState } : null;
  }

  /**
   * Switch to a different agent.
   * Updates state, emits agent:switched event, and persists across iterations.
   *
   * @param newAgentPlugin - Plugin identifier of the agent to switch to
   * @param reason - Why the switch is happening (primary recovery or fallback)
   */
  private switchAgent(newAgentPlugin: string, reason: ActiveAgentReason): void {
    const previousAgent = this.state.activeAgent?.plugin ?? this.config.agent.plugin;
    const now = new Date().toISOString();

    // Update active agent state
    this.state.activeAgent = {
      plugin: newAgentPlugin,
      reason,
      since: now,
    };

    // Update rate limit state based on reason
    if (reason === 'fallback' && this.state.rateLimitState) {
      this.state.rateLimitState = {
        ...this.state.rateLimitState,
        limitedAt: now,
        fallbackAgent: newAgentPlugin,
      };
    } else if (reason === 'primary' && this.state.rateLimitState) {
      // Recovering to primary - clear rate limit tracking
      this.state.rateLimitState = {
        primaryAgent: this.state.rateLimitState.primaryAgent,
        // Clear limitedAt and fallbackAgent on recovery
      };
    }

    // Record the agent switch for iteration logging
    const switchEntry: AgentSwitchEntry = {
      at: now,
      from: previousAgent,
      to: newAgentPlugin,
      reason,
    };
    this.currentIterationAgentSwitches.push(switchEntry);

    // Log the switch to console for visibility
    if (reason === 'fallback') {
      console.log(
        `[agent-switch] Switching to fallback: ${previousAgent} → ${newAgentPlugin} (rate limit)`
      );
    } else {
      // Calculate duration on fallback for recovery logging
      let durationOnFallback = '';
      if (this.state.rateLimitState?.limitedAt) {
        const limitedAt = new Date(this.state.rateLimitState.limitedAt);
        const durationMs = Date.now() - limitedAt.getTime();
        const durationSecs = Math.round(durationMs / 1000);
        if (durationSecs >= 60) {
          const mins = Math.floor(durationSecs / 60);
          const secs = durationSecs % 60;
          durationOnFallback = ` (${mins}m ${secs}s on fallback)`;
        } else {
          durationOnFallback = ` (${durationSecs}s on fallback)`;
        }
      }
      console.log(
        `[agent-switch] Recovering to primary: ${previousAgent} → ${newAgentPlugin}${durationOnFallback}`
      );
    }

    // Emit agent switched event
    const event: AgentSwitchedEvent = {
      type: 'agent:switched',
      timestamp: now,
      previousAgent,
      newAgent: newAgentPlugin,
      reason,
      rateLimitState: this.state.rateLimitState ?? undefined,
    };
    this.emit(event);
  }

  /**
   * Check if primary agent should be recovered between iterations.
   * Called when recoverPrimaryBetweenIterations is enabled.
   */
  private shouldRecoverPrimaryAgent(): boolean {
    // Only attempt recovery if currently using a fallback
    if (this.state.activeAgent?.reason !== 'fallback') {
      return false;
    }

    // Check if recovery is enabled
    return this.rateLimitConfig.recoverPrimaryBetweenIterations;
  }

  /**
   * Attempt to recover the primary agent by testing if rate limit has lifted.
   * Executes a minimal test prompt with short timeout to verify primary agent availability.
   * If the test succeeds (no rate limit detected), switches back to primary agent.
   *
   * Called between iterations when recoverPrimaryBetweenIterations is enabled.
   * Returns true if recovery was successful.
   */
  private async attemptPrimaryAgentRecovery(): Promise<boolean> {
    const primaryAgent = this.state.rateLimitState?.primaryAgent ?? this.config.agent.plugin;
    const fallbackAgent = this.state.activeAgent?.plugin ?? '';

    // Must have preserved primary agent instance
    if (!this.primaryAgentInstance) {
      console.log('[recovery] No primary agent instance available');
      return false;
    }

    console.log(`[recovery] Testing if primary agent '${primaryAgent}' rate limit has lifted...`);
    const startTime = Date.now();

    try {
      // Execute minimal test prompt with short timeout
      const handle = this.primaryAgentInstance.execute(
        PRIMARY_RECOVERY_TEST_PROMPT,
        [],
        {
          cwd: this.config.cwd,
          timeout: PRIMARY_RECOVERY_TEST_TIMEOUT_MS,
        }
      );

      const result = await handle.promise;
      const testDurationMs = Date.now() - startTime;

      // Check for rate limit in the test output
      const rateLimitResult = this.rateLimitDetector.detect({
        stderr: result.stderr,
        stdout: result.stdout,
        exitCode: result.exitCode,
        agentId: primaryAgent,
      });

      // Emit recovery attempted event
      const event: AgentRecoveryAttemptedEvent = {
        type: 'agent:recovery-attempted',
        timestamp: new Date().toISOString(),
        primaryAgent,
        fallbackAgent,
        success: !rateLimitResult.isRateLimit && result.status === 'completed',
        testDurationMs,
        rateLimitMessage: rateLimitResult.message,
      };
      this.emit(event);

      if (rateLimitResult.isRateLimit) {
        // Primary still rate limited
        console.log(
          `[recovery] Primary agent '${primaryAgent}' still rate limited: ${rateLimitResult.message ?? 'rate limit detected'}`
        );
        return false;
      }

      if (result.status !== 'completed') {
        // Test failed for other reason (timeout, error, etc.)
        console.log(
          `[recovery] Primary agent test failed with status: ${result.status}`
        );
        return false;
      }

      // Recovery successful - switch back to primary
      console.log(
        `[recovery] Primary agent '${primaryAgent}' recovered! Switching back from '${fallbackAgent}'`
      );
      this.agent = this.primaryAgentInstance;
      this.switchAgent(primaryAgent, 'primary');

      // Clear rate-limited agents tracking since we're back on primary
      this.rateLimitedAgents.clear();

      return true;
    } catch (error) {
      const testDurationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Emit recovery attempted event with failure
      const event: AgentRecoveryAttemptedEvent = {
        type: 'agent:recovery-attempted',
        timestamp: new Date().toISOString(),
        primaryAgent,
        fallbackAgent,
        success: false,
        testDurationMs,
        rateLimitMessage: errorMessage,
      };
      this.emit(event);

      console.log(`[recovery] Primary agent test error: ${errorMessage}`);
      return false;
    }
  }

  /**
   * Legacy method for backward compatibility.
   * Use attemptPrimaryAgentRecovery() instead for full recovery with testing.
   * @deprecated Use attemptPrimaryAgentRecovery() instead
   */
  recoverPrimaryAgent(): boolean {
    if (!this.shouldRecoverPrimaryAgent()) {
      return false;
    }

    // Switch back to primary agent without testing (legacy behavior)
    const primaryAgent = this.state.rateLimitState?.primaryAgent ?? this.config.agent.plugin;
    if (this.primaryAgentInstance) {
      this.agent = this.primaryAgentInstance;
    }
    this.switchAgent(primaryAgent, 'primary');
    return true;
  }

  /**
   * Switch to a fallback agent due to rate limiting.
   * Called when primary agent hits rate limit and max retries exceeded.
   *
   * @param fallbackAgentPlugin - Plugin identifier of the fallback agent
   */
  switchToFallbackAgent(fallbackAgentPlugin: string): void {
    this.switchAgent(fallbackAgentPlugin, 'fallback');
  }

  /**
   * Get the next available fallback agent that hasn't been rate-limited.
   * Returns undefined if no fallback agents are configured or all are rate-limited.
   */
  private getNextFallbackAgent(): string | undefined {
    const fallbackAgents = this.config.agent.fallbackAgents;
    if (!fallbackAgents || fallbackAgents.length === 0) {
      return undefined;
    }

    // Find the first fallback that hasn't been rate-limited
    for (const fallbackPlugin of fallbackAgents) {
      if (!this.rateLimitedAgents.has(fallbackPlugin)) {
        return fallbackPlugin;
      }
    }

    return undefined;
  }

  /**
   * Try to switch to a fallback agent after rate limit exhaustion.
   * Initializes the fallback agent with the same config/options as primary.
   *
   * @param task - Current task being processed
   * @param iteration - Current iteration number
   * @param startedAt - When the iteration started
   * @returns Object indicating whether switch occurred and if all agents are limited
   */
  private async tryFallbackAgent(
    task: TrackerTask,
    iteration: number,
    startedAt: Date
  ): Promise<{ switched: boolean; allAgentsLimited: boolean }> {
    const nextFallback = this.getNextFallbackAgent();

    if (!nextFallback) {
      // No more fallback agents available
      return { switched: false, allAgentsLimited: true };
    }

    try {
      // Create agent config for fallback - inherit options from primary
      const fallbackConfig = {
        name: nextFallback,
        plugin: nextFallback,
        options: { ...this.config.agent.options },
        command: this.config.agent.command,
        defaultFlags: this.config.agent.defaultFlags,
        timeout: this.config.agent.timeout,
      };

      // Get fallback agent instance from registry
      const agentRegistry = getAgentRegistry();
      const fallbackInstance = await agentRegistry.getInstance(fallbackConfig);

      // Verify fallback agent is available
      const detectResult = await fallbackInstance.detect();
      if (!detectResult.available) {
        // Fallback not available - mark as limited and try next
        console.log(
          `[fallback] Agent '${nextFallback}' not available: ${detectResult.error}`
        );
        this.rateLimitedAgents.add(nextFallback);
        return this.tryFallbackAgent(task, iteration, startedAt);
      }

      // Switch to fallback agent
      this.agent = fallbackInstance;
      this.switchToFallbackAgent(nextFallback);

      // Clear rate limit retry count for the task since we're switching agents
      this.clearRateLimitRetryCount(task.id);

      console.log(
        `[fallback] Switched from '${this.config.agent.plugin}' to '${nextFallback}'`
      );

      return { switched: true, allAgentsLimited: false };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(
        `[fallback] Failed to initialize fallback agent '${nextFallback}': ${errorMessage}`
      );

      // Mark this fallback as unavailable and try the next one
      this.rateLimitedAgents.add(nextFallback);
      return this.tryFallbackAgent(task, iteration, startedAt);
    }
  }

  /**
   * Build a completion summary string for the iteration.
   * Returns a human-readable summary when agent switches occurred.
   *
   * @param result - The iteration result
   * @returns Completion summary string or undefined if no switches occurred
   */
  private buildCompletionSummary(result: IterationResult): string | undefined {
    // No switches during this iteration - no special summary needed
    if (this.currentIterationAgentSwitches.length === 0) {
      return undefined;
    }

    const currentAgent = this.state.activeAgent?.plugin ?? this.config.agent.plugin;
    const statusWord = result.taskCompleted ? 'Completed' : result.status === 'failed' ? 'Failed' : 'Finished';

    // Check if we're on a fallback agent
    const lastSwitch = this.currentIterationAgentSwitches[this.currentIterationAgentSwitches.length - 1];
    if (lastSwitch && lastSwitch.reason === 'fallback') {
      return `${statusWord} on fallback (${currentAgent}) due to rate limit`;
    }

    // Check if we recovered to primary during this iteration
    if (lastSwitch && lastSwitch.reason === 'primary') {
      const fallbackSwitches = this.currentIterationAgentSwitches.filter(s => s.reason === 'fallback');
      if (fallbackSwitches.length > 0) {
        const fallbackAgent = fallbackSwitches[0].to;
        return `${statusWord} on primary after recovering from fallback (${fallbackAgent})`;
      }
      return `${statusWord} on primary (${currentAgent}) after recovery`;
    }

    // Generic summary for other cases
    return `${statusWord} with ${this.currentIterationAgentSwitches.length} agent switch(es)`;
  }

  /**
   * Clear rate-limited agents tracking.
   * Called when a task completes successfully to allow agents to be used again.
   */
  private clearRateLimitedAgents(): void {
    this.rateLimitedAgents.clear();
  }

  /**
   * Perform auto-commit after successful task completion.
   * Emits task:auto-committed on success, task:auto-commit-failed on error.
   * Failures never halt engine execution.
   */
  private async handleAutoCommit(task: TrackerTask, iteration: number): Promise<void> {
    try {
      const result = await performAutoCommit(this.config.cwd, task.id, task.title);
      if (result.committed) {
        this.emit({
          type: 'task:auto-committed',
          timestamp: new Date().toISOString(),
          task,
          iteration,
          commitMessage: result.commitMessage!,
          commitSha: result.commitSha,
        });
      } else if (result.error) {
        this.emit({
          type: 'task:auto-commit-failed',
          timestamp: new Date().toISOString(),
          task,
          iteration,
          error: result.error,
        });
      } else if (result.skipReason) {
        this.emit({
          type: 'task:auto-commit-skipped',
          timestamp: new Date().toISOString(),
          task,
          iteration,
          reason: result.skipReason,
        });
      }
    } catch (err) {
      this.emit({
        type: 'task:auto-commit-failed',
        timestamp: new Date().toISOString(),
        task,
        iteration,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Dispose of engine resources
   */
  async dispose(): Promise<void> {
    await this.stop();
    this.listeners = [];
  }
}

// Re-export types
export type {
  ActiveAgentReason,
  ActiveAgentState,
  AgentRecoveryAttemptedEvent,
  AgentSwitchedEvent,
  AllAgentsLimitedEvent,
  EngineEvent,
  EngineEventListener,
  EngineState,
  EngineStatus,
  EngineSubagentState,
  ErrorHandlingConfig,
  ErrorHandlingStrategy,
  IterationRateLimitedEvent,
  IterationResult,
  IterationStatus,
  TaskAutoCommittedEvent,
  TaskAutoCommitFailedEvent,
  RateLimitState,
  SubagentTreeNode,
};

// Re-export rate limit detector
export {
  RateLimitDetector,
  type RateLimitDetectionResult,
  type RateLimitDetectionInput,
} from './rate-limit-detector.js';
