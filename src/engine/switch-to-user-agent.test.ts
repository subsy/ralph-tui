/**
 * ABOUTME: Tests for user-initiated agent switching in the execution engine.
 * Verifies validation, state mutation, and agent switch events.
 */

import { beforeAll, describe, expect, mock, test } from 'bun:test';
import type { RalphConfig } from '../config/types.js';
import { BaseAgentPlugin } from '../plugins/agents/base.js';
import type {
  AgentDetectResult,
  AgentExecuteOptions,
  AgentFileContext,
  AgentPluginMeta,
} from '../plugins/agents/types.js';

let getAgentRegistry: typeof import('../plugins/agents/registry.js').getAgentRegistry;
let ExecutionEngine: typeof import('./index.js').ExecutionEngine;
let registryUsable = true;

type TestAgentOptions = {
  available?: boolean;
  validateModel?: (model: string) => string | null;
};

class TestSwitchAgentPlugin extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta;
  private readonly available: boolean;
  private readonly validateModelFn: (model: string) => string | null;

  constructor(id: string, options: TestAgentOptions = {}) {
    super();
    this.meta = {
      id,
      name: id,
      description: 'Test switch agent',
      version: '1.0.0',
      defaultCommand: id,
      supportsStreaming: false,
      supportsInterrupt: true,
      supportsFileContext: false,
      supportsSubagentTracing: false,
    };
    this.available = options.available ?? true;
    this.validateModelFn = options.validateModel ?? (() => null);
  }

  override async detect(): Promise<AgentDetectResult> {
    return this.available
      ? { available: true, version: '1.0.0' }
      : { available: false, error: 'not installed' };
  }

  override validateModel(model: string): string | null {
    return this.validateModelFn(model);
  }

  protected buildArgs(
    _prompt: string,
    _files?: AgentFileContext[],
    _options?: AgentExecuteOptions
  ): string[] {
    return [];
  }
}

function registerTestAgent(id: string, options: TestAgentOptions = {}): void {
  getAgentRegistry().registerBuiltin(() => new TestSwitchAgentPlugin(id, options));
}

function createConfig(agentPlugin: string): RalphConfig {
  return {
    cwd: '/tmp/ralph-switch-test',
    agent: { name: agentPlugin, plugin: agentPlugin, options: {} },
    tracker: { name: 'tracker', plugin: 'json', options: {} },
    maxIterations: 10,
    iterationDelay: 0,
    watch: false,
    pollIntervalMs: 30000,
    outputDir: '/tmp/ralph-switch-test/output',
    progressFile: '/tmp/ralph-switch-test/progress.md',
    showTui: false,
    errorHandling: {
      strategy: 'skip',
      maxRetries: 3,
      retryDelayMs: 0,
      continueOnNonZeroExit: false,
    },
  };
}

describe('ExecutionEngine.switchToUserAgent', () => {
  beforeAll(async () => {
    mock.restore();
    ({ getAgentRegistry } = await import('../plugins/agents/registry.js'));
    registryUsable = typeof getAgentRegistry().createInstance === 'function';
    ({ ExecutionEngine } = await import('./index.js'));
  });

  test('validates model, mutates config, updates state, and emits user-selected switch', async () => {
    if (!registryUsable) return;
    registerTestAgent('switch-primary');
    registerTestAgent('switch-target', {
      validateModel: (model) => (model === 'valid-model' ? null : 'invalid model'),
    });
    const engine = new ExecutionEngine(createConfig('switch-primary'));
    const events: string[] = [];
    engine.on((event) => {
      if (event.type === 'agent:switched') {
        events.push(`${event.previousAgent}:${event.newAgent}:${event.reason}`);
      }
    });

    await engine.switchToUserAgent(
      { name: 'switch-target', plugin: 'switch-target', options: {} },
      'valid-model'
    );

    const config = (engine as unknown as { config: RalphConfig }).config;
    const switchBuffers = engine as unknown as {
      currentIterationAgentSwitches: unknown[];
      nextIterationAgentSwitches: Array<{ reason: string }>;
    };
    expect(config.agent.plugin).toBe('switch-target');
    expect(config.model).toBe('valid-model');
    expect(engine.getState().activeAgent).toMatchObject({
      plugin: 'switch-target',
      reason: 'user-selected',
    });
    expect(engine.getState().currentModel).toBe('valid-model');
    expect(events).toEqual(['switch-primary:switch-target:user-selected']);
    expect(switchBuffers.currentIterationAgentSwitches).toHaveLength(0);
    expect(switchBuffers.nextIterationAgentSwitches).toEqual([
      expect.objectContaining({ reason: 'user-selected' }),
    ]);
  });

  test('clears model override without validating an empty string', async () => {
    if (!registryUsable) return;
    const validatedModels: string[] = [];
    registerTestAgent('switch-clear-primary');
    registerTestAgent('switch-clear-target', {
      validateModel: (model) => {
        validatedModels.push(model);
        return model === '' ? 'empty model rejected' : null;
      },
    });
    const engine = new ExecutionEngine(createConfig('switch-clear-primary'));

    await engine.switchToUserAgent(
      { name: 'switch-clear-target', plugin: 'switch-clear-target', options: {} },
      undefined
    );

    const config = (engine as unknown as { config: RalphConfig }).config;
    expect(config.agent.plugin).toBe('switch-clear-target');
    expect(config.model).toBeUndefined();
    expect(validatedModels).toEqual([]);
  });

  test('queues a user switch while an execution is active', async () => {
    if (!registryUsable) return;
    registerTestAgent('switch-queued-primary');
    registerTestAgent('switch-queued-target');
    const engine = new ExecutionEngine(createConfig('switch-queued-primary'));
    const internals = engine as unknown as {
      currentExecution: unknown;
      pendingUserAgentSwap: unknown;
      applyPendingUserAgentSwap: () => void;
      config: RalphConfig;
      currentIterationAgentSwitches: unknown[];
      nextIterationAgentSwitches: Array<{ reason: string }>;
    };
    const events: string[] = [];
    engine.on((event) => {
      if (event.type === 'agent:switched') {
        events.push(`${event.previousAgent}:${event.newAgent}:${event.reason}`);
      }
    });
    internals.currentExecution = { interrupt: () => {}, promise: Promise.resolve() };

    await engine.switchToUserAgent(
      { name: 'switch-queued-target', plugin: 'switch-queued-target', options: {} },
      'queued-model'
    );

    expect(internals.config.agent.plugin).toBe('switch-queued-primary');
    expect(internals.config.model).toBeUndefined();
    expect(events).toEqual([]);
    expect(internals.pendingUserAgentSwap).not.toBeNull();

    internals.currentExecution = null;
    internals.applyPendingUserAgentSwap();

    expect(internals.config.agent.plugin).toBe('switch-queued-target');
    expect(internals.config.model).toBe('queued-model');
    expect(events).toEqual(['switch-queued-primary:switch-queued-target:user-selected']);
    expect(internals.currentIterationAgentSwitches).toHaveLength(0);
    expect(internals.nextIterationAgentSwitches).toEqual([
      expect.objectContaining({ reason: 'user-selected' }),
    ]);
  });

  test('throws on invalid model without mutating state', async () => {
    if (!registryUsable) return;
    registerTestAgent('switch-invalid-primary');
    registerTestAgent('switch-invalid-target', {
      validateModel: () => 'bad model',
    });
    const engine = new ExecutionEngine(createConfig('switch-invalid-primary'));

    await expect(
      engine.switchToUserAgent(
        { name: 'switch-invalid-target', plugin: 'switch-invalid-target', options: {} },
        'bad-model'
      )
    ).rejects.toThrow('bad model');

    const config = (engine as unknown as { config: RalphConfig }).config;
    expect(config.agent.plugin).toBe('switch-invalid-primary');
    expect(config.model).toBeUndefined();
    expect(engine.getState().activeAgent).toBeNull();
  });

  test('throws on detect failure without mutating state', async () => {
    if (!registryUsable) return;
    registerTestAgent('switch-detect-primary');
    registerTestAgent('switch-detect-target', { available: false });
    const engine = new ExecutionEngine(createConfig('switch-detect-primary'));

    await expect(
      engine.switchToUserAgent(
        { name: 'switch-detect-target', plugin: 'switch-detect-target', options: {} },
        undefined
      )
    ).rejects.toThrow("Agent 'switch-detect-target' not available");

    const config = (engine as unknown as { config: RalphConfig }).config;
    expect(config.agent.plugin).toBe('switch-detect-primary');
    expect(engine.getState().activeAgent).toBeNull();
  });
});
