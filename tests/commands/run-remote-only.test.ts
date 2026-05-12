/**
 * ABOUTME: Integration tests for `ralph-tui run --remote-only` paths that
 * require mocking the remotes config (listRemotes) and the TUI renderer.
 * Run in isolation in CI because Bun's mock.module() is process-wide and
 * pollutes other tests (and is polluted by other tests that mock the agent
 * registry — see tests/engine/execution-engine.test.ts).
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';

import * as realRemoteIndex from '../../src/remote/index.js';
import * as realOpentuiCore from '@opentui/core';
import * as realOpentuiReact from '@opentui/react';
import * as realInterruption from '../../src/interruption/index.js';
import type { RemoteServerConfig } from '../../src/remote/index.js';

let mockedRemotes: Array<[string, RemoteServerConfig]> = [];
let mockedRendererBehavior: 'throw' | 'normal' = 'normal';
let createCliRendererCallCount = 0;

mock.module('../../src/remote/index.js', () => ({
  ...realRemoteIndex,
  listRemotes: () => Promise.resolve(mockedRemotes),
}));

mock.module('@opentui/core', () => ({
  ...realOpentuiCore,
  createCliRenderer: () => {
    createCliRendererCallCount++;
    if (mockedRendererBehavior === 'throw') {
      throw new Error('test-mock: createCliRenderer disabled');
    }
    return { destroy: () => {} };
  },
}));

mock.module('@opentui/react', () => ({
  ...realOpentuiReact,
  createRoot: () => ({ render: () => {} }),
}));

mock.module('../../src/interruption/index.js', () => ({
  ...realInterruption,
  createInterruptHandler: () => ({
    handleSigint: () => {},
    handleResponse: async () => {},
    getState: () => 'idle' as const,
    reset: () => {},
    dispose: () => {},
  }),
}));

describe('executeRunCommand --remote-only with no remotes', () => {
  let consoleErrorOutput: string[];
  let consoleErrorSpy: ReturnType<typeof spyOn>;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockedRemotes = [];
    mockedRendererBehavior = 'normal';
    createCliRendererCallCount = 0;
    consoleErrorOutput = [];
    consoleErrorSpy = spyOn(console, 'error').mockImplementation((...args) => {
      consoleErrorOutput.push(args.join(' '));
    });
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
    processExitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  test('exits with a clear error when no remotes configured', async () => {
    try {
      await import('../../src/commands/run.jsx').then((m) =>
        m.executeRunCommand(['--remote-only'])
      );
    } catch {
      // Expected: process.exit throws
    }

    const output = consoleErrorOutput.join('\n');
    expect(output).toContain('--remote-only requires at least one configured remote');
    expect(output).toContain('remotes.toml');
    expect(output).toContain('ralph-tui remote add');
    expect(processExitSpy).toHaveBeenCalledWith(1);
    // Never reached the renderer because we exited at the empty-remotes check.
    expect(createCliRendererCallCount).toBe(0);
  });

  test('error guidance points at the correct config path', async () => {
    try {
      await import('../../src/commands/run.jsx').then((m) =>
        m.executeRunCommand(['--remote-only'])
      );
    } catch {
      // Expected: process.exit throws
    }

    const output = consoleErrorOutput.join('\n');
    expect(output).toContain('~/.config/ralph-tui/remotes.toml');
  });
});

describe('executeRunCommand --remote-only with configured remotes', () => {
  let consoleErrorSpy: ReturnType<typeof spyOn>;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockedRemotes = [
      ['testrem', { host: 'localhost', port: 7890, token: 'tk', addedAt: new Date().toISOString() }],
    ];
    mockedRendererBehavior = 'throw';
    createCliRendererCallCount = 0;
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
    processExitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  test('proceeds past empty-remotes check and reaches runRemoteOnlyTui', async () => {
    // With a remote configured and the renderer mocked to throw, executeRunCommand
    // should run through the remote-only setup and reject inside runRemoteOnlyTui
    // when createCliRenderer throws.
    let caught: Error | null = null;
    try {
      await import('../../src/commands/run.jsx').then((m) =>
        m.executeRunCommand(['--remote-only'])
      );
    } catch (err) {
      caught = err as Error;
    }

    // Assert via the renderer-mock counter + the propagated error rather than
    // console output (brittle under shared-process test runs).
    expect(createCliRendererCallCount).toBe(1);
    expect(caught?.message ?? '').toContain('test-mock: createCliRenderer disabled');
    // The empty-remotes guard exits with 1; reaching this path means no exit fired.
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  test('reaches the renderer regardless of remote count', async () => {
    mockedRemotes = [
      ['rem1', { host: 'h1', port: 7890, token: 'tk1', addedAt: 'x' }],
      ['rem2', { host: 'h2', port: 7891, token: 'tk2', addedAt: 'x' }],
      ['rem3', { host: 'h3', port: 7892, token: 'tk3', addedAt: 'x' }],
    ];

    let caught: Error | null = null;
    try {
      await import('../../src/commands/run.jsx').then((m) =>
        m.executeRunCommand(['--remote-only'])
      );
    } catch (err) {
      caught = err as Error;
    }

    expect(mockedRemotes.length).toBe(3);
    expect(createCliRendererCallCount).toBe(1);
    expect(caught?.message ?? '').toContain('test-mock: createCliRenderer disabled');
  });
});

describe('runRemoteOnlyTui end-to-end with mocked renderer', () => {
  let consoleErrorSpy: ReturnType<typeof spyOn>;
  let consoleLogSpy: ReturnType<typeof spyOn>;
  let processExitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    mockedRemotes = [
      ['testrem', { host: 'localhost', port: 7890, token: 'tk', addedAt: new Date().toISOString() }],
    ];
    mockedRendererBehavior = 'normal';
    createCliRendererCallCount = 0;
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
    processExitSpy = spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  test('runs through runRemoteOnlyTui and resolves on SIGTERM', async () => {
    const runPromise = import('../../src/commands/run.jsx').then((m) =>
      m.executeRunCommand(['--remote-only'])
    );

    // Give the TUI a tick to install the SIGTERM handler.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Trigger graceful shutdown by emitting SIGTERM.
    process.emit('SIGTERM', 'SIGTERM');

    // The shutdown handler calls renderer.destroy() and resolves the quit promise.
    await runPromise;

    // The renderer was constructed exactly once; clean shutdown means no exit fired.
    expect(createCliRendererCallCount).toBe(1);
    expect(processExitSpy).not.toHaveBeenCalled();
  });
});
