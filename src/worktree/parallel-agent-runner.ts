/**
 * ABOUTME: Bridge between parallel executor and Ralph's agent plugin infrastructure.
 * Provides a unified interface for running agents in parallel worktrees, handling
 * output streaming, subagent tracing, and agent-specific configuration per worktree.
 */

import type {
  AgentPlugin,
  AgentPluginConfig,
  AgentExecuteOptions,
  AgentExecutionResult,
  AgentExecutionHandle,
} from '../plugins/agents/types.js';
import { getAgentRegistry, registerBuiltinAgents } from '../plugins/agents/index.js';
import { SubagentTraceParser } from '../plugins/agents/tracing/index.js';
import type { SubagentEvent, SubagentTraceSummary } from '../plugins/agents/tracing/types.js';
import { ClaudeAgentPlugin } from '../plugins/agents/builtin/claude.js';
import type { ManagedWorktree } from './types.js';
import type { GraphTask } from './task-graph-types.js';

/**
 * Configuration for a parallel agent instance
 */
export interface ParallelAgentConfig {
  /** Agent plugin ID (e.g., 'claude', 'opencode') */
  agentId: string;

  /** Model to use (e.g., 'sonnet', 'opus' for claude; 'anthropic/claude-3-5-sonnet' for opencode) */
  model?: string;

  /** Enable subagent tracing (tracks Task tool invocations) */
  enableSubagentTracing?: boolean;

  /** Additional agent options (passed to plugin initialize) */
  options?: Record<string, unknown>;

  /** Timeout in milliseconds (0 = no timeout) */
  timeout?: number;
}

/**
 * Result of running an agent in a parallel worktree
 */
export interface ParallelAgentResult {
  /** Whether execution succeeded (exit code 0) */
  success: boolean;

  /** Exit code from agent process */
  exitCode?: number;

  /** Full stdout captured */
  stdout: string;

  /** Full stderr captured */
  stderr: string;

  /** Duration in milliseconds */
  durationMs: number;

  /** Error message if failed */
  error?: string;

  /** Subagent trace summary (if tracing enabled) */
  subagentSummary?: SubagentTraceSummary;

  /** Raw execution result from agent plugin */
  rawResult: AgentExecutionResult;
}

/**
 * Options for running an agent
 */
export interface ParallelAgentRunOptions {
  /** Prompt to send to the agent */
  prompt: string;

  /** Task being executed (for context) */
  task: GraphTask;

  /** Worktree to run in */
  worktree: ManagedWorktree;

  /** Agent configuration */
  agentConfig: ParallelAgentConfig;

  /** Callback for stdout chunks */
  onStdout?: (chunk: string) => void;

  /** Callback for stderr chunks */
  onStderr?: (chunk: string) => void;

  /** Callback for subagent events */
  onSubagentEvent?: (event: SubagentEvent) => void;

  /** Abort signal for cancellation */
  signal?: AbortSignal;

  /** Maximum output size to capture in bytes */
  maxOutputSizeBytes?: number;
}

/**
 * Manages running agents in parallel worktrees.
 * Bridges between the ParallelExecutor and Ralph's agent plugin infrastructure.
 */
export class ParallelAgentRunner {
  private initialized = false;
  private agentInstances: Map<string, AgentPlugin> = new Map();
  private activeHandles: Map<string, AgentExecutionHandle> = new Map();

  /**
   * Initialize the agent runner.
   * Registers built-in agents and prepares the registry.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    registerBuiltinAgents();

    const registry = getAgentRegistry();
    await registry.initialize();

    this.initialized = true;
  }

  /**
   * Get or create an initialized agent plugin instance.
   *
   * @param config Agent configuration
   * @returns Initialized agent plugin
   */
  async getAgentInstance(config: ParallelAgentConfig): Promise<AgentPlugin> {
    const cacheKey = `${config.agentId}:${config.model ?? 'default'}`;

    const cached = this.agentInstances.get(cacheKey);
    if (cached) {
      return cached;
    }

    const registry = getAgentRegistry();

    const pluginConfig: AgentPluginConfig = {
      name: cacheKey,
      plugin: config.agentId,
      options: {
        ...config.options,
        model: config.model,
      },
      timeout: config.timeout,
    };

    const instance = await registry.getInstance(pluginConfig);

    this.agentInstances.set(cacheKey, instance);

    return instance;
  }

  /**
   * Run an agent in a parallel worktree.
   *
   * @param options Run options including prompt, worktree, and agent config
   * @returns Result of the agent execution
   */
  async run(options: ParallelAgentRunOptions): Promise<ParallelAgentResult> {
    const {
      prompt,
      task,
      worktree,
      agentConfig,
      onStdout,
      onStderr,
      onSubagentEvent,
      signal,
      maxOutputSizeBytes = 1024 * 1024, // 1MB default
    } = options;

    await this.initialize();

    const agent = await this.getAgentInstance(agentConfig);

    let traceParser: SubagentTraceParser | undefined;
    if (agentConfig.enableSubagentTracing && agent.meta.supportsSubagentTracing) {
      traceParser = new SubagentTraceParser({
        onEvent: (event) => {
          onSubagentEvent?.(event);
        },
      });
    }

    let stdout = '';
    let stderr = '';

    const captureStdout = (chunk: string) => {
      stdout += chunk;
      if (stdout.length > maxOutputSizeBytes) {
        stdout = stdout.slice(-maxOutputSizeBytes);
      }
      onStdout?.(chunk);

      if (traceParser && agent.meta.structuredOutputFormat === 'jsonl') {
        const parseResult = ClaudeAgentPlugin.parseJsonlLine(chunk);
        if (parseResult.success) {
          traceParser.processMessage(parseResult.message);
        }
      }
    };

    const captureStderr = (chunk: string) => {
      stderr += chunk;
      if (stderr.length > maxOutputSizeBytes) {
        stderr = stderr.slice(-maxOutputSizeBytes);
      }
      onStderr?.(chunk);
    };

    const executeOptions: AgentExecuteOptions = {
      cwd: worktree.path,
      timeout: agentConfig.timeout,
      onStdout: captureStdout,
      onStderr: captureStderr,
      subagentTracing: agentConfig.enableSubagentTracing,
    };

    const handle = agent.execute(prompt, undefined, executeOptions);
    const runId = `${task.id}-${worktree.id}`;
    this.activeHandles.set(runId, handle);

    if (signal) {
      const abortHandler = () => {
        handle.interrupt();
      };
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    try {
      const result = await handle.promise;

      return {
        success: result.status === 'completed' && result.exitCode === 0,
        exitCode: result.exitCode,
        stdout,
        stderr,
        durationMs: result.durationMs,
        error: result.error,
        subagentSummary: traceParser?.getSummary(),
        rawResult: result,
      };
    } finally {
      this.activeHandles.delete(runId);
    }
  }

  /**
   * Interrupt all running agents.
   */
  interruptAll(): void {
    for (const handle of this.activeHandles.values()) {
      handle.interrupt();
    }
    this.activeHandles.clear();
  }

  /**
   * Check which agents are available.
   *
   * @returns Map of agent ID to availability status
   */
  async checkAvailableAgents(): Promise<Map<string, { available: boolean; version?: string; error?: string }>> {
    await this.initialize();

    const registry = getAgentRegistry();
    const results = new Map<string, { available: boolean; version?: string; error?: string }>();

    for (const meta of registry.getRegisteredPlugins()) {
      const instance = registry.createInstance(meta.id);
      if (instance) {
        const detectResult = await instance.detect();
        results.set(meta.id, {
          available: detectResult.available,
          version: detectResult.version,
          error: detectResult.error,
        });
        await instance.dispose();
      }
    }

    return results;
  }

  /**
   * Get list of available agent IDs.
   *
   * @returns Array of agent plugin IDs
   */
  getAvailableAgentIds(): string[] {
    const registry = getAgentRegistry();
    return registry.getRegisteredPlugins().map((meta) => meta.id);
  }

  /**
   * Clean up resources.
   */
  async dispose(): Promise<void> {
    this.interruptAll();

    for (const instance of this.agentInstances.values()) {
      await instance.dispose();
    }
    this.agentInstances.clear();

    this.initialized = false;
  }
}

/**
 * Default parallel agent configuration using Claude with tracing.
 */
export const DEFAULT_PARALLEL_AGENT_CONFIG: ParallelAgentConfig = {
  agentId: 'claude',
  enableSubagentTracing: true,
};
