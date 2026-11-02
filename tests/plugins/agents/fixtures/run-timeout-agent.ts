/**
 * ABOUTME: Exercises real per-call timeout and engine completion paths in isolation.
 * A fresh process prevents process-wide module mocks from replacing child spawning.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BaseAgentPlugin } from '../../../../src/plugins/agents/base.js';
import { getAgentRegistry } from '../../../../src/plugins/agents/registry.js';
import { ExecutionEngine } from '../../../../src/engine/index.js';
import type { AgentPluginMeta } from '../../../../src/plugins/agents/types.js';
import type { RalphConfig } from '../../../../src/config/types.js';
import type { EngineEvent } from '../../../../src/engine/types.js';
import type { TrackerPlugin, TrackerTask } from '../../../../src/plugins/trackers/types.js';

const deadlineMs = 500;
const keepAlive = 'setInterval(() => {}, 1000);';
const graceful = (code: number): string =>
  `process.on('SIGTERM', () => process.exit(${code})); console.log('ready'); ${keepAlive}`;
const marker = '<promise>COMPLETE</promise>';

class TimeoutFixtureAgent extends BaseAgentPlugin {
  readonly meta: AgentPluginMeta = {
    id: 'timeout-fixture',
    name: 'Timeout fixture',
    description: 'Local timeout fixture',
    version: '1.0.0',
    defaultCommand: process.execPath,
    supportsStreaming: true,
    supportsInterrupt: true,
    supportsFileContext: false,
    supportsSubagentTracing: false,
  };

  private attempt = 0;

  constructor(private readonly scripts: string[]) {
    super();
  }

  protected buildArgs(): string[] {
    const script = this.scripts[Math.min(this.attempt++, this.scripts.length - 1)]!;
    return ['-e', script];
  }

  override async detect() {
    return { available: true, executablePath: process.execPath };
  }
}

async function runAgent(mode: string) {
  const scripts: Record<string, string> = {
    graceful: graceful(0),
    'graceful-failure': graceful(7),
    success: 'console.log("ready");',
    failure: 'console.log("ready"); process.exit(7);',
    sigterm: 'console.log("ready"); process.kill(process.pid, "SIGTERM");',
    sigkill: 'console.log("ready"); process.kill(process.pid, "SIGKILL");',
    interrupt: graceful(0),
    'interrupt-after-timeout': `process.on('SIGTERM', () => { console.log('terminating'); setTimeout(() => process.exit(0), 100); }); console.log('ready'); ${keepAlive}`,
    disabled: graceful(0),
    'override-disabled': graceful(0),
    drain: `const { spawn } = require('node:child_process'); const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { stdio: ['ignore', 'inherit', 'inherit'] }); child.unref(); console.log('descendant:' + child.pid); process.exit(0);`,
  };
  const script = scripts[mode];
  if (!script) throw new Error(`Unknown fixture mode: ${mode}`);
  const agent = new TimeoutFixtureAgent([script]);
  await agent.initialize(mode === 'disabled' ? {} : { timeout: deadlineMs });
  let interrupted = false;
  let runningPastDeadline = false;
  let endCalls = 0;
  let endStatus: string | undefined;
  let interruptTimer: ReturnType<typeof setTimeout> | undefined;
  let descendantPid: number | undefined;
  try {
    const handle = agent.execute('probe', [], {
      ...(mode === 'override-disabled' ? { timeout: 0 } : {}),
      onStdout: (text) => {
        const pid = /descendant:(\d+)/.exec(text)?.[1];
        if (pid) descendantPid = Number(pid);
        const shouldInterrupt = mode === 'interrupt' && text.includes('ready') ||
          mode === 'interrupt-after-timeout' && text.includes('terminating');
        if (shouldInterrupt && !interrupted) {
          interrupted = true;
          handle.interrupt();
        }
        if ((mode === 'disabled' || mode === 'override-disabled') && text.includes('ready')) {
          interruptTimer = setTimeout(() => {
            runningPastDeadline = handle.isRunning();
            handle.interrupt();
          }, deadlineMs + 100);
        }
      },
      onEnd: (result) => { endCalls++; endStatus = result.status; },
    });
    const result = await handle.promise;
    return { ...result, endCalls, endStatus, running: handle.isRunning(), runningPastDeadline };
  } finally {
    if (interruptTimer) clearTimeout(interruptTimer);
    await agent.dispose();
    if (descendantPid) {
      try { process.kill(descendantPid, 'SIGTERM'); } catch { /* Already exited. */ }
    }
  }
}

async function runEngine(mode: string) {
  const cwd = await mkdtemp(join(tmpdir(), 'ralph-timeout-engine-'));
  const name = `timeout-fixture-${process.pid}`;
  const strategy = mode === 'recover' ? 'retry' : mode === 'failure' ? 'abort' : mode;
  if (strategy !== 'retry' && strategy !== 'skip' && strategy !== 'abort') {
    throw new Error(`Unknown engine mode: ${mode}`);
  }
  const scripts = [mode === 'failure'
    ? `console.log('${marker}'); process.exit(7);`
    : graceful(0) + ` console.log('${marker}');`];
  if (mode === 'recover') scripts.push(`console.log('${marker}');`);
  const registry = getAgentRegistry();
  registry.registerBuiltin(() => new TimeoutFixtureAgent(scripts));
  const task: TrackerTask = { id: 'task-timeout', title: 'Timeout task', status: 'open', priority: 1, labels: [] };
  let completeCalls = 0;
  const tracker = {
    sync: async () => ({ success: true, message: '', added: 0, updated: 0, removed: 0, syncedAt: new Date().toISOString() }),
    getTasks: async () => [task],
    getTask: async () => task,
    getNextTask: async (filter?: { excludeIds?: string[] }) =>
      completeCalls || filter?.excludeIds?.includes(task.id) ? undefined : task,
    isComplete: async () => completeCalls > 0,
    updateTaskStatus: async () => {},
    completeTask: async () => { completeCalls++; return { success: true, message: '' }; },
  } as unknown as TrackerPlugin;
  const config = {
    cwd, maxIterations: 4, iterationDelay: 0, watch: false, pollIntervalMs: 30000,
    autoCommit: true,
    agent: { name, plugin: 'timeout-fixture', options: {}, timeout: deadlineMs, rateLimitHandling: { enabled: false } },
    tracker: { name: 'json', plugin: 'json', options: {} },
    errorHandling: { strategy, maxRetries: 1, retryDelayMs: 0, continueOnNonZeroExit: false },
  } as RalphConfig;
  const engine = new ExecutionEngine(config);
  const events: EngineEvent[] = [];
  engine.on(event => events.push(event));
  try {
    await engine.initialize(undefined, { tracker });
    await engine.start();
    return {
      completeCalls,
      tasksCompleted: engine.getState().tasksCompleted,
      iterations: engine.getState().iterations.map(result => ({
        status: result.status,
        taskCompleted: result.taskCompleted,
        promiseComplete: result.promiseComplete,
        agentStatus: result.agentResult?.status,
        exitCode: result.agentResult?.exitCode,
      })),
      events: events.map(event => event.type),
      failureActions: events.filter(event => event.type === 'iteration:failed').map(event => event.action),
      stopReasons: events.filter(event => event.type === 'engine:stopped').map(event => event.reason),
    };
  } finally {
    await engine.dispose();
    await registry.disposeInstance(name);
    await rm(cwd, { recursive: true, force: true });
  }
}

const mode = process.argv[2] ?? 'graceful';
console.log(JSON.stringify(mode.startsWith('engine-')
  ? await runEngine(mode.slice('engine-'.length))
  : await runAgent(mode)));
process.exit(0);
