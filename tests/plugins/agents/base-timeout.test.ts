/**
 * ABOUTME: Regression tests for actual per-call timeout classification and completion.
 * Isolated real-child fixtures exercise production agent and engine code, not spawn mocks.
 */

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { AgentExecutionResult } from '../../../src/plugins/agents/types.js';

const runner = join(import.meta.dir, 'fixtures', 'run-timeout-agent.ts');

async function runFixture<T>(mode: string): Promise<T> {
  const child = Bun.spawn([process.execPath, 'run', runner, mode], {
    stdout: 'pipe', stderr: 'pipe',
  });
  const deadline = setTimeout(() => child.kill('SIGKILL'), 12000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(stderr).toBe('');
    expect(code).toBe(0);
    return JSON.parse(stdout.trim().split('\n').at(-1)!) as T;
  } finally {
    clearTimeout(deadline);
    child.kill();
  }
}

type AgentReport = AgentExecutionResult & {
  endCalls: number;
  endStatus: string;
  running: boolean;
  runningPastDeadline: boolean;
};

type EngineReport = {
  completeCalls: number;
  tasksCompleted: number;
  iterations: { status: string; taskCompleted: boolean; promiseComplete: boolean; agentStatus: string; exitCode: number }[];
  events: string[];
  failureActions: string[];
  stopReasons: string[];
};

describe.skipIf(process.platform === 'win32')('actual per-call timeout with real child signals', () => {
  for (const [mode, code] of [['graceful', 0], ['graceful-failure', 7]] as const) {
    test(`reports timeout when SIGTERM handler exits ${code}`, async () => {
      const result = await runFixture<AgentReport>(mode);
      expect(result.stdout).toContain('ready');
      expect(result.exitCode).toBe(code);
      expect(result.status).toBe('timeout');
      expect(result.interrupted).toBe(false);
      expect(result.endCalls).toBe(1);
      expect(result.endStatus).toBe('timeout');
      expect(result.running).toBe(false);
    });
  }

  for (const [mode, status, code] of [['success', 'completed', 0], ['failure', 'failed', 7]] as const) {
    test(`preserves normal ${status} before a configured deadline`, async () => {
      const result = await runFixture<AgentReport>(mode);
      expect(result.status).toBe(status);
      expect(result.exitCode).toBe(code);
      expect(result.endStatus).toBe(status);
    });
  }

  for (const mode of ['sigterm', 'sigkill']) {
    test(`does not mistake external ${mode} for an unfired configured timeout`, async () => {
      const result = await runFixture<AgentReport>(mode);
      expect(result.stdout).toContain('ready');
      expect(result.status).toBe('interrupted');
      expect(result.interrupted).toBe(false);
    });
  }

  for (const mode of ['interrupt', 'interrupt-after-timeout']) {
    test(`preserves explicit user ${mode} precedence`, async () => {
      const result = await runFixture<AgentReport>(mode);
      if (mode === 'interrupt-after-timeout') expect(result.stdout).toContain('terminating');
      expect(result.status).toBe('interrupted');
      expect(result.interrupted).toBe(true);
      expect(result.endCalls).toBe(1);
    });
  }

  for (const mode of ['disabled', 'override-disabled']) {
    test(`leaves ${mode} timeout0 unchanged`, async () => {
      const result = await runFixture<AgentReport>(mode);
      expect(result.runningPastDeadline).toBe(true);
      expect(result.status).toBe('interrupted');
    });
  }

  test('does not time out an exited parent during descendant stdio drain', async () => {
    const result = await runFixture<AgentReport>('drain');
    expect(result.stdout).toContain('descendant:');
    expect(result.durationMs).toBeGreaterThanOrEqual(1500);
    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(result.endCalls).toBe(1);
  });

  for (const [strategy, actions] of [['abort', ['abort']], ['skip', ['skip']], ['retry', ['retry', 'skip']]] as const) {
    test(`fails timed-out marker output without tracker completion under ${strategy}`, async () => {
      const result = await runFixture<EngineReport>(`engine-${strategy}`);
      expect(result.iterations).toHaveLength(actions.length);
      for (const iteration of result.iterations) {
        expect(iteration).toEqual({ status: 'failed', agentStatus: 'timeout', taskCompleted: false, promiseComplete: true, exitCode: 0 });
      }
      expect(result.completeCalls).toBe(0);
      expect(result.tasksCompleted).toBe(0);
      expect(result.events).not.toContain('task:completed');
      expect(result.events.some(type => type.startsWith('task:auto-commit'))).toBe(false);
      expect(result.failureActions).toEqual([...actions]);
      if (strategy === 'abort') expect(result.stopReasons).toContain('error');
      else expect(result.events).toContain('iteration:skipped');
    });
  }

  test('rejects earlier narrative completion when a real child exits nonzero', async () => {
    const result = await runFixture<EngineReport>('engine-failure');
    expect(result.iterations).toEqual([
      { status: 'failed', agentStatus: 'failed', taskCompleted: false, promiseComplete: true, exitCode: 7 },
    ]);
    expect(result.completeCalls).toBe(0);
    expect(result.tasksCompleted).toBe(0);
    expect(result.events).not.toContain('task:completed');
    expect(result.events.some(type => type.startsWith('task:auto-commit'))).toBe(false);
    expect(result.failureActions).toEqual(['abort']);
  });

  test('allows normal completion on the existing retry after a timed-out marker', async () => {
    const result = await runFixture<EngineReport>('engine-recover');
    expect(result.iterations).toEqual([
      { status: 'failed', agentStatus: 'timeout', taskCompleted: false, promiseComplete: true, exitCode: 0 },
      { status: 'completed', agentStatus: 'completed', taskCompleted: true, promiseComplete: true, exitCode: 0 },
    ]);
    expect(result.completeCalls).toBe(1);
    expect(result.tasksCompleted).toBe(1);
    expect(result.failureActions).toEqual(['retry']);
    expect(result.events.filter(type => type === 'task:completed')).toHaveLength(1);
  });
});
