/**
 * ABOUTME: Tests for local orchestration - analyzer, worker manager.
 * End-to-end tests for the orchestrator module components.
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { analyzePrd } from '../../src/orchestrator/analyzer.js';
import { WorkerManager } from '../../src/orchestrator/worker-manager.js';
import { Orchestrator } from '../../src/orchestrator/index.js';
import type { OrchestratorConfig, OrchestratorEvent } from '../../src/orchestrator/types.js';
import type { PrdUserStory } from '../../src/prd/types.js';
import { createUserStory } from '../factories/prd-data.js';

describe('Analyzer', () => {
  describe('grouping independent stories', () => {
    test('groups stories with no dependencies into same parallel group', async () => {
      const stories: PrdUserStory[] = [
        createUserStory({ id: 'US-001', title: 'Add login', dependsOn: [] }),
        createUserStory({ id: 'US-002', title: 'Add signup', dependsOn: [] }),
        createUserStory({ id: 'US-003', title: 'Add logout', dependsOn: [] }),
      ];

      const graph = await analyzePrd(stories);

      expect(graph.parallelGroups).toHaveLength(1);
      expect(graph.parallelGroups[0]).toHaveLength(3);
      expect(graph.parallelGroups[0]).toContain('US-001');
      expect(graph.parallelGroups[0]).toContain('US-002');
      expect(graph.parallelGroups[0]).toContain('US-003');
    });

    test('separates stories with explicit dependencies into phases', async () => {
      const stories: PrdUserStory[] = [
        createUserStory({ id: 'US-001', title: 'Create database', dependsOn: [] }),
        createUserStory({ id: 'US-002', title: 'Add user model', dependsOn: ['US-001'] }),
        createUserStory({ id: 'US-003', title: 'Add auth', dependsOn: ['US-002'] }),
      ];

      const graph = await analyzePrd(stories);

      expect(graph.parallelGroups).toHaveLength(3);
      expect(graph.parallelGroups[0]).toEqual(['US-001']);
      expect(graph.parallelGroups[1]).toEqual(['US-002']);
      expect(graph.parallelGroups[2]).toEqual(['US-003']);
    });

    test('detects implicit dependencies from file overlap', async () => {
      const stories: PrdUserStory[] = [
        createUserStory({
          id: 'US-001',
          title: 'Update src/auth.ts',
          description: 'Modify src/auth.ts',
          dependsOn: [],
        }),
        createUserStory({
          id: 'US-002',
          title: 'Refactor src/auth.ts',
          description: 'Refactor src/auth.ts',
          dependsOn: [],
        }),
      ];

      const graph = await analyzePrd(stories);

      // Should detect implicit dep due to shared file
      expect(graph.parallelGroups).toHaveLength(2);
    });

    test('correctly calculates node metadata', async () => {
      const stories: PrdUserStory[] = [
        createUserStory({
          id: 'US-001',
          title: 'Test story',
          acceptanceCriteria: ['Write unit tests'],
          dependsOn: [],
        }),
      ];

      const graph = await analyzePrd(stories);

      const node = graph.nodes.get('US-001');
      expect(node).toBeDefined();
      expect(node?.title).toBe('Test story');
    });
  });
});

describe('WorkerManager', () => {
  let manager: WorkerManager;

  beforeEach(() => {
    manager = new WorkerManager({
      cwd: '/test',
      headless: true,
    });
  });

  afterEach(() => {
    manager.killAll();
  });

  describe('spawning workers', () => {
    test('generates unique worker IDs', async () => {
      const spawnMock = spyOn(await import('node:child_process'), 'spawn');
      const mockProc = {
        stdout: { on: mock(() => {}) },
        stderr: { on: mock(() => {}) },
        on: mock(() => {}),
        kill: mock(() => {}),
      };
      spawnMock.mockReturnValue(mockProc as any);

      const id1 = await manager.spawnWorker({ from: 'US-001', to: 'US-002' });
      const id2 = await manager.spawnWorker({ from: 'US-003', to: 'US-004' });

      expect(id1).not.toEqual(id2);
      expect(id1).toMatch(/^worker-\d+$/);
      expect(id2).toMatch(/^worker-\d+$/);

      spawnMock.mockRestore();
    });

    test('emits worker:started event on spawn', async () => {
      const spawnMock = spyOn(await import('node:child_process'), 'spawn');
      const mockProc = {
        stdout: { on: mock(() => {}) },
        stderr: { on: mock(() => {}) },
        on: mock(() => {}),
        kill: mock(() => {}),
      };
      spawnMock.mockReturnValue(mockProc as any);

      const events: OrchestratorEvent[] = [];
      manager.on('worker:started', (event) => events.push(event));

      await manager.spawnWorker({ from: 'US-001', to: 'US-002' });

      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('worker:started');

      spawnMock.mockRestore();
    });

    test('tracks worker state after spawning', async () => {
      const spawnMock = spyOn(await import('node:child_process'), 'spawn');
      const mockProc = {
        stdout: { on: mock(() => {}) },
        stderr: { on: mock(() => {}) },
        on: mock(() => {}),
        kill: mock(() => {}),
      };
      spawnMock.mockReturnValue(mockProc as any);

      const workerId = await manager.spawnWorker('US-001');
      const state = manager.getWorkerState(workerId);

      expect(state).toBeDefined();
      expect(state?.status).toBe('running');
      expect(state?.taskId).toBe('US-001');

      spawnMock.mockRestore();
    });
  });

  describe('monitoring workers', () => {
    test('updates progress from stdout parsing', async () => {
      const spawnMock = spyOn(await import('node:child_process'), 'spawn');
      let stdoutCallback: ((data: Buffer) => void) | null = null;

      const mockProc = {
        stdout: {
          on: mock((event: string, cb: (data: Buffer) => void) => {
            if (event === 'data') stdoutCallback = cb;
          }),
        },
        stderr: { on: mock(() => {}) },
        on: mock(() => {}),
        kill: mock(() => {}),
      };
      spawnMock.mockReturnValue(mockProc as any);

      const workerId = await manager.spawnWorker('US-001');

      stdoutCallback?.(Buffer.from('progress: 50'));

      const state = manager.getWorkerState(workerId);
      expect(state?.progress).toBe(50);

      spawnMock.mockRestore();
    });

    test('taskId is assigned at spawn', async () => {
      const spawnMock = spyOn(await import('node:child_process'), 'spawn');

      const mockProc = {
        stdout: { on: mock(() => {}) },
        stderr: { on: mock(() => {}) },
        on: mock(() => {}),
        kill: mock(() => {}),
      };
      spawnMock.mockReturnValue(mockProc as any);

      const workerId = await manager.spawnWorker('US-001');

      const state = manager.getWorkerState(workerId);
      expect(state?.taskId).toBe('US-001');

      spawnMock.mockRestore();
    });
  });

  describe('killing workers', () => {
    test('killWorker returns false for unknown ID', () => {
      const result = manager.killWorker('unknown-worker');
      expect(result).toBe(false);
    });

    test('killWorker removes worker from tracking', async () => {
      const spawnMock = spyOn(await import('node:child_process'), 'spawn');
      const mockProc = {
        stdout: { on: mock(() => {}) },
        stderr: { on: mock(() => {}) },
        on: mock(() => {}),
        kill: mock(() => {}),
      };
      spawnMock.mockReturnValue(mockProc as any);

      const workerId = await manager.spawnWorker('US-001');
      manager.killWorker(workerId);

      expect(manager.getWorkerState(workerId)).toBeUndefined();

      spawnMock.mockRestore();
    });

    test('killAll terminates all workers', async () => {
      const spawnMock = spyOn(await import('node:child_process'), 'spawn');
      const mockProc = {
        stdout: { on: mock(() => {}) },
        stderr: { on: mock(() => {}) },
        on: mock(() => {}),
        kill: mock(() => {}),
      };
      spawnMock.mockReturnValue(mockProc as any);

      await manager.spawnWorker('US-001');
      await manager.spawnWorker('US-003');

      manager.killAll();

      expect(manager.getAllWorkerStates()).toHaveLength(0);

      spawnMock.mockRestore();
    });
  });
});

describe('Full orchestration', () => {
  test('Orchestrator emits lifecycle events', async () => {
    const mockReadFile = mock(async () =>
      JSON.stringify({
        userStories: [
          createUserStory({ id: 'US-001', dependsOn: [] }),
          createUserStory({ id: 'US-002', dependsOn: [] }),
        ],
      })
    );

    mock.module('node:fs/promises', () => ({
      readFile: mockReadFile,
    }));

    const config: OrchestratorConfig = {
      prdPath: '/test/prd.json',
      maxWorkers: 2,
      headless: true,
      cwd: '/test',
    };

    const orchestrator = new Orchestrator(config);
    const events: OrchestratorEvent[] = [];

    orchestrator.on('worker:started', (e) => events.push(e));
    orchestrator.on('worker:completed', (e) => events.push(e));
    orchestrator.on('orchestration:completed', (e) => events.push(e));

    const spawnMock = spyOn(await import('node:child_process'), 'spawn');
    let closeCallback: ((code: number) => void) | null = null;

    const mockProc = {
      stdout: { on: mock(() => {}) },
      stderr: { on: mock(() => {}) },
      on: mock((event: string, cb: (code: number) => void) => {
        if (event === 'close') closeCallback = cb;
      }),
      kill: mock(() => {}),
    };
    spawnMock.mockReturnValue(mockProc as any);

    const runPromise = orchestrator.run();

    // Simulate workers completing
    await new Promise((resolve) => setTimeout(resolve, 10));
    closeCallback?.(0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    closeCallback?.(0);

    await runPromise;

    const started = events.filter((e) => e.type === 'worker:started');
    const completed = events.filter((e) => e.type === 'orchestration:completed');

    expect(started.length).toBeGreaterThan(0);
    expect(completed).toHaveLength(1);

    spawnMock.mockRestore();
  });

  test('Orchestrator.shutdown terminates workers', async () => {
    const config: OrchestratorConfig = {
      prdPath: '/test/prd.json',
      maxWorkers: 2,
      headless: true,
      cwd: '/test',
    };

    const orchestrator = new Orchestrator(config);
    expect(() => orchestrator.shutdown()).not.toThrow();
  });
});
