/**
 * ABOUTME: Tests for RemoteServer class methods.
 * Focuses on testable methods that don't require a running WebSocket server.
 */

import { describe, test, expect } from 'bun:test';
import { RemoteServer } from './server.js';
import type { RalphConfig } from '../config/types.js';
import type { TrackerPlugin } from '../plugins/trackers/types.js';

/** Create a minimal mock config for testing */
function createMockConfig(): RalphConfig {
  return {
    cwd: '/tmp/test-project',
    maxIterations: 5,
    iterationDelay: 100,
    outputDir: '/tmp/output',
    progressFile: '/tmp/progress.md',
    sessionId: 'test-session',
    agent: { name: 'test-agent', plugin: 'claude', options: {} },
    tracker: { name: 'test-tracker', plugin: 'beads', options: {} },
    showTui: false,
    errorHandling: {
      strategy: 'skip',
      maxRetries: 3,
      retryDelayMs: 1000,
      continueOnNonZeroExit: false,
    },
  };
}

/** Create a minimal mock tracker for testing */
function createMockTracker(): TrackerPlugin {
  return {
    meta: {
      id: 'mock-tracker',
      name: 'Mock Tracker',
      description: 'A mock tracker for testing',
      version: '1.0.0',
      supportsBidirectionalSync: false,
      supportsHierarchy: false,
      supportsDependencies: true,
    },
    initialize: async () => {},
    isReady: async () => true,
    getTasks: async () => [],
    getTask: async () => undefined,
    getNextTask: async () => undefined,
    completeTask: async () => ({ success: true, message: 'Task completed' }),
    updateTaskStatus: async () => undefined,
    isComplete: async () => true,
    sync: async () => ({ success: true, message: 'Synced', syncedAt: new Date().toISOString() }),
    isTaskReady: async () => true,
    getEpics: async () => [],
    getSetupQuestions: () => [],
    validateSetup: async () => null,
    dispose: async () => {},
    getTemplate: () => 'Mock template',
  };
}

describe('RemoteServer', () => {
  describe('constructor', () => {
    test('creates instance with minimal options', () => {
      const server = new RemoteServer({
        port: 7890,
        hasToken: false,
      });

      expect(server).toBeInstanceOf(RemoteServer);
    });

    test('creates instance with hasToken true', () => {
      const server = new RemoteServer({
        port: 8080,
        hasToken: true,
        maxPortRetries: 5,
        cwd: '/tmp/test',
      });

      expect(server).toBeInstanceOf(RemoteServer);
    });
  });

  describe('setTracker', () => {
    test('sets tracker instance', () => {
      const server = new RemoteServer({ port: 7890, hasToken: false });
      const tracker = createMockTracker();

      // Should not throw
      server.setTracker(tracker);
    });
  });

  describe('setParallelConfig', () => {
    test('sets parallel config for orchestration', () => {
      const server = new RemoteServer({ port: 7890, hasToken: false });
      const config = createMockConfig();
      const tracker = createMockTracker();

      // Should not throw
      server.setParallelConfig({ baseConfig: config, tracker });
    });
  });

  describe('actualPort getter', () => {
    test('returns null when server not started', () => {
      const server = new RemoteServer({ port: 7890, hasToken: false });

      expect(server.actualPort).toBeNull();
    });
  });
});
