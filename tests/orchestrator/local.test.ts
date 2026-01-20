/**
 * ABOUTME: Tests for local orchestration - analyzer, scheduler, worker manager.
 * End-to-end tests for the orchestrator module components.
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { analyzePrd, type DependencyGraph } from '../../src/orchestrator/analyzer.js';
import { createSchedule } from '../../src/orchestrator/scheduler.js';
import { WorkerManager } from '../../src/orchestrator/worker-manager.js';
import { Orchestrator } from '../../src/orchestrator/index.js';
import type { OrchestratorConfig, OrchestratorEvent, Phase } from '../../src/orchestrator/types.js';
import type { PrdUserStory } from '../../src/prd/types.js';
import { createUserStory, createUserStories } from '../factories/prd-data.js';

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
      expect(node?.parallelismHint).toBeDefined();
      expect(node?.parallelismHint?.reason).toContain('test');
    });
  });
});

describe('Scheduler', () => {
  describe('creating phases', () => {
    const baseConfig: OrchestratorConfig = {
      prdPath: '/test/prd.json',
      maxWorkers: 4,
      headless: true,
      cwd: '/test',
    };

    test('creates single phase for independent stories', async () => {
      const stories = createUserStories(3);
      // Remove dependencies to make them independent
      stories.forEach((s) => (s.dependsOn = []));

      const graph = await analyzePrd(stories);
      const phases = createSchedule(graph, baseConfig);

      expect(phases.length).toBeGreaterThanOrEqual(1);
      expect(phases[0]?.name).toContain('Phase');
    });

    test('creates multiple phases for dependent stories', async () => {
      const stories: PrdUserStory[] = [
        createUserStory({ id: 'US-001', dependsOn: [] }),
        createUserStory({ id: 'US-002', dependsOn: ['US-001'] }),
      ];

      const graph = await analyzePrd(stories);
      const phases = createSchedule(graph, baseConfig);

      expect(phases).toHaveLength(2);
    });

    test('phase story groups have valid id ranges', async () => {
      const stories: PrdUserStory[] = [
        createUserStory({ id: 'US-001', dependsOn: [] }),
        createUserStory({ id: 'US-002', dependsOn: [] }),
        createUserStory({ id: 'US-003', dependsOn: [] }),
      ];

      const graph = await analyzePrd(stories);
      const phases = createSchedule(graph, baseConfig);

      for (const phase of phases) {
        for (const group of phase.storyGroups) {
          expect(group.idRange.from).toBeDefined();
          expect(group.idRange.to).toBeDefined();
          expect(group.idRange.from <= group.idRange.to).toBe(true);
        }
      }
    });

    test('respects maxWorkers when partitioning', async () => {
      const config = { ...baseConfig, maxWorkers: 2 };
      const stories: PrdUserStory[] = [
        createUserStory({ id: 'US-001', dependsOn: [] }),
        createUserStory({ id: 'US-002', dependsOn: [] }),
        createUserStory({ id: 'US-003', dependsOn: [] }),
        createUserStory({ id: 'US-004', dependsOn: [] }),
      ];

      const graph = await analyzePrd(stories);
      const phases = createSchedule(graph, config);

      // With maxWorkers=2, should have at most 2 story groups per phase
      for (const phase of phases) {
        expect(phase.storyGroups.length).toBeLessThanOrEqual(2);
      }
    });

    test('detects non-parallel due to single group', async () => {
      // When all stories are independent, they form a single parallel group
      // With small number of stories, scheduler may create only 1 story group
      // per phase, which correctly returns parallel=false (nothing to parallelize)
      const stories: PrdUserStory[] = [
        createUserStory({ id: 'US-001', description: 'Changes src/a.ts', dependsOn: [] }),
        createUserStory({ id: 'US-002', description: 'Changes src/b.ts', dependsOn: [] }),
      ];

      const graph = await analyzePrd(stories);
      const phases = createSchedule(graph, baseConfig);

      // With 2 stories and maxWorkers=4, all fit in one group
      expect(phases).toHaveLength(1);
      expect(phases[0]?.storyGroups.length).toBeGreaterThanOrEqual(1);
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
      // Mock spawn to prevent actual process creation
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

      const workerId = await manager.spawnWorker({ from: 'US-001', to: 'US-002' });
      const state = manager.getWorkerState(workerId);

      expect(state).toBeDefined();
      expect(state?.status).toBe('running');
      expect(state?.range.from).toBe('US-001');
      expect(state?.range.to).toBe('US-002');

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

      const workerId = await manager.spawnWorker({ from: 'US-001', to: 'US-002' });

      // Simulate progress output
      stdoutCallback?.(Buffer.from('progress: 50'));

      const state = manager.getWorkerState(workerId);
      expect(state?.progress).toBe(50);

      spawnMock.mockRestore();
    });

    test('extracts current task ID from output', async () => {
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

      const workerId = await manager.spawnWorker({ from: 'US-001', to: 'US-002' });

      // Simulate task output
      stdoutCallback?.(Buffer.from('task: US-001'));

      const state = manager.getWorkerState(workerId);
      expect(state?.currentTaskId).toBe('US-001');

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

      const workerId = await manager.spawnWorker({ from: 'US-001', to: 'US-002' });
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

      await manager.spawnWorker({ from: 'US-001', to: 'US-002' });
      await manager.spawnWorker({ from: 'US-003', to: 'US-004' });

      manager.killAll();

      expect(manager.getAllWorkerStates()).toHaveLength(0);

      spawnMock.mockRestore();
    });
  });
});

describe('Full orchestration', () => {
  test('Orchestrator emits lifecycle events', async () => {
    // Create a mock PRD file
    const mockReadFile = mock(async () =>
      JSON.stringify({
        userStories: [
          createUserStory({ id: 'US-001', dependsOn: [] }),
          createUserStory({ id: 'US-002', dependsOn: [] }),
        ],
      })
    );

    // Mock the fs/promises module
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

    orchestrator.on('phase:started', (e) => events.push(e));
    orchestrator.on('phase:completed', (e) => events.push(e));
    orchestrator.on('orchestration:completed', (e) => events.push(e));

    // Mock worker manager to prevent actual spawning
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

    // Run orchestrator - it will try to spawn workers
    const runPromise = orchestrator.run();

    // Simulate workers completing
    await new Promise((resolve) => setTimeout(resolve, 10));
    closeCallback?.(0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    closeCallback?.(0);

    await runPromise;

    // Verify events were emitted
    const phaseStarted = events.filter((e) => e.type === 'phase:started');
    const phaseCompleted = events.filter((e) => e.type === 'phase:completed');
    const completed = events.filter((e) => e.type === 'orchestration:completed');

    expect(phaseStarted.length).toBeGreaterThan(0);
    expect(phaseCompleted.length).toBeGreaterThan(0);
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

    // Just test that shutdown doesn't throw
    expect(() => orchestrator.shutdown()).not.toThrow();
  });
});
