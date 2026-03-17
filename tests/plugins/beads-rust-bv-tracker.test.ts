/**
 * ABOUTME: Tests for BeadsRustBvTrackerPlugin.
 * Covers metadata, initialization, detect(), getNextTask() (bv available/unavailable,
 * fallback cases), getTasks() decoration, completeTask(), updateTaskStatus(),
 * getSetupQuestions(), validateSetup(), and error-handling paths.
 *
 * Uses mock.module() to intercept node:child_process.spawn before dynamic import,
 * ensuring ES module mocking works correctly with bun:test.
 */

import {
    describe,
    test,
    expect,
    mock,
    beforeAll,
    afterAll,
    beforeEach,
} from 'bun:test';
import { EventEmitter } from 'node:events';
import type { TrackerTask } from '../../src/plugins/trackers/types.js';

let BeadsRustBvTrackerPlugin: typeof import('../../src/plugins/trackers/builtin/beads-rust-bv/index.js').BeadsRustBvTrackerPlugin;
let BeadsRustTrackerPlugin: typeof import('../../src/plugins/trackers/builtin/beads-rust/index.js').BeadsRustTrackerPlugin;

interface MockSpawnResponse {
    command: string;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
}

const spawnResponses: MockSpawnResponse[] = [];
const capturedSpawns: { command: string; args: string[] }[] = [];

function queueSpawnResponse(response: MockSpawnResponse): void {
    spawnResponses.push(response);
}

describe('BeadsRustBvTrackerPlugin', () => {
    beforeAll(async () => {
        mock.module('node:child_process', () => ({
            spawn: (command: string, args: string[] = []) => {
                capturedSpawns.push({ command, args });
                const proc = new EventEmitter() as EventEmitter & {
                    stdout: EventEmitter;
                    stderr: EventEmitter;
                };
                proc.stdout = new EventEmitter();
                proc.stderr = new EventEmitter();

                const matchIndex = spawnResponses.findIndex(
                    (r) => r.command === command || r.command === '*'
                );
                const response =
                    matchIndex >= 0
                        ? spawnResponses.splice(matchIndex, 1)[0]
                        : { command, exitCode: 0 };

                setTimeout(() => {
                    if (response?.stdout) {
                        proc.stdout.emit('data', Buffer.from(response.stdout));
                    }
                    if (response?.stderr) {
                        proc.stderr.emit('data', Buffer.from(response.stderr));
                    }
                    proc.emit('close', response?.exitCode ?? 0);
                }, 0);

                return proc;
            },
        }));

        mock.module('node:fs/promises', () => ({
            access: async () => { },
            readFile: async () => '',
        }));

        const module = await import('../../src/plugins/trackers/builtin/beads-rust-bv/index.js');
        BeadsRustBvTrackerPlugin = module.BeadsRustBvTrackerPlugin;
        const rustModule = await import('../../src/plugins/trackers/builtin/beads-rust/index.js');
        BeadsRustTrackerPlugin = rustModule.BeadsRustTrackerPlugin;
    });

    afterAll(() => {
        mock.restore();
    });

    beforeEach(() => {
        spawnResponses.length = 0;
        capturedSpawns.length = 0;
    });

    // ---------------------------------------------------------------------------
    // 4.2 Plugin metadata
    // ---------------------------------------------------------------------------
    describe('meta', () => {
        test('has correct plugin id', () => {
            const plugin = new BeadsRustBvTrackerPlugin();
            expect(plugin.meta.id).toBe('beads-rust-bv');
        });

        test('name contains Beads and Smart', () => {
            const plugin = new BeadsRustBvTrackerPlugin();
            expect(plugin.meta.name).toContain('Beads');
            expect(plugin.meta.name).toContain('Smart');
        });

        test('description mentions bv', () => {
            const plugin = new BeadsRustBvTrackerPlugin();
            expect(plugin.meta.description).toContain('bv');
        });

        test('version is semver format', () => {
            const plugin = new BeadsRustBvTrackerPlugin();
            expect(plugin.meta.version).toMatch(/^\d+\.\d+\.\d+$/);
        });

        test('capabilities flags are all true', () => {
            const plugin = new BeadsRustBvTrackerPlugin();
            expect(plugin.meta.supportsBidirectionalSync).toBe(true);
            expect(plugin.meta.supportsHierarchy).toBe(true);
            expect(plugin.meta.supportsDependencies).toBe(true);
        });
    });

    // ---------------------------------------------------------------------------
    // 4.3 initialize()
    // ---------------------------------------------------------------------------
    describe('initialize()', () => {
        test('bvAvailable is false before initialization', () => {
            const plugin = new BeadsRustBvTrackerPlugin();
            expect(plugin.isBvAvailable()).toBe(false);
        });

        test('sets bvAvailable=true when br and bv are both available', async () => {
            const plugin = new BeadsRustBvTrackerPlugin();

            // br --version → success
            queueSpawnResponse({ command: 'br', stdout: 'br version 1.0.0', exitCode: 0 });
            // bv --version → success
            queueSpawnResponse({ command: 'bv', stdout: 'bv 0.5.0', exitCode: 0 });

            await plugin.initialize({ workingDir: '/tmp/project' });
            expect(plugin.isBvAvailable()).toBe(true);
        });

        test('sets bvAvailable=false when bv is not available', async () => {
            const plugin = new BeadsRustBvTrackerPlugin();

            // br --version → success
            queueSpawnResponse({ command: 'br', stdout: 'br version 1.0.0', exitCode: 0 });
            // bv --version → failure
            queueSpawnResponse({ command: 'bv', exitCode: 1, stderr: 'not found' });

            await plugin.initialize({ workingDir: '/tmp/project' });
            expect(plugin.isBvAvailable()).toBe(false);
        });

        test('ready is false when br is unavailable', async () => {
            const plugin = new BeadsRustBvTrackerPlugin();

            // Stub the delegate's detect so it reports br unavailable.
            (plugin as unknown as { delegate: { detect: () => Promise<{ available: boolean; brVersion: undefined }> } }).delegate.detect =
                async () => ({ available: false, brVersion: undefined });

            await plugin.initialize({ workingDir: '/tmp/project' });
            expect(await plugin.isReady()).toBe(false);
        });
    });

    // ---------------------------------------------------------------------------
    // 4.4 detect()
    // ---------------------------------------------------------------------------
    describe('detect()', () => {
        test('reports available and bvAvailable when both binaries present', async () => {
            const plugin = new BeadsRustBvTrackerPlugin();

            queueSpawnResponse({ command: 'br', stdout: 'br version 1.0.0', exitCode: 0 });
            queueSpawnResponse({ command: 'bv', stdout: 'bv 0.5.0', exitCode: 0 });

            const result = await plugin.detect();
            expect(result.available).toBe(true);
            expect(result.bvAvailable).toBe(true);
        });

        test('reports available=true, bvAvailable=false when bv missing', async () => {
            const plugin = new BeadsRustBvTrackerPlugin();

            queueSpawnResponse({ command: 'br', stdout: 'br version 1.0.0', exitCode: 0 });
            queueSpawnResponse({ command: 'bv', exitCode: 1, stderr: 'not found' });

            const result = await plugin.detect();
            expect(result.available).toBe(true);
            expect(result.bvAvailable).toBe(false);
        });

        test('reports available=false when br missing', async () => {
            const plugin = new BeadsRustBvTrackerPlugin();

            queueSpawnResponse({ command: 'br', exitCode: 1, stderr: 'not found' });

            const result = await plugin.detect();
            expect(result.available).toBe(false);
            expect(result.bvAvailable).toBe(false);
        });
    });

    // ---------------------------------------------------------------------------
    // 4.5 getNextTask()
    // ---------------------------------------------------------------------------
    describe('getNextTask()', () => {
        function makePlugin(bvAvailable = false): BeadsRustBvTrackerPlugin {
            const plugin = new BeadsRustBvTrackerPlugin();
            (plugin as unknown as { bvAvailable: boolean }).bvAvailable = bvAvailable;
            // Suppress background triage refresh in unit tests.
            (plugin as unknown as { scheduleTriageRefresh: () => void }).scheduleTriageRefresh = () => { };
            return plugin;
        }

        test('delegates to br when bv is unavailable', async () => {
            const plugin = makePlugin(false);
            const brTask: TrackerTask = { id: 'br-1', title: 'br task', status: 'open', priority: 2 };

            // Stub delegate.getNextTask
            (plugin as unknown as { delegate: { getNextTask: () => Promise<TrackerTask> } }).delegate.getNextTask =
                async () => brTask;

            const result = await plugin.getNextTask();
            expect(result).toEqual(brTask);
        });

        test('augments task with bv metadata when bv returns a task', async () => {
            const plugin = makePlugin(true);
            const fullTask: TrackerTask = { id: 'task-42', title: 'Task 42', status: 'open', priority: 1 };

            (plugin as unknown as { delegate: { getTask: (id: string) => Promise<TrackerTask> } }).delegate.getTask =
                async () => fullTask;

            queueSpawnResponse({
                command: 'bv',
                stdout: JSON.stringify({
                    id: 'task-42',
                    title: 'Task 42',
                    score: 0.85,
                    reasons: ['Critical path', 'Unblocks 3'],
                    unblocks: 3,
                    claim_command: 'br update task-42',
                    show_command: 'br show task-42',
                }),
                exitCode: 0,
            });

            const result = await plugin.getNextTask();
            expect(result?.id).toBe('task-42');
            expect(result?.metadata?.bvScore).toBe(0.85);
            expect(result?.metadata?.bvReasons).toEqual(['Critical path', 'Unblocks 3']);
            expect(result?.metadata?.bvUnblocks).toBe(3);
        });

        test('falls back when bv returns { message } (no actionable items)', async () => {
            const plugin = makePlugin(true);
            const brTask: TrackerTask = { id: 'fallback', title: 'Fallback', status: 'open', priority: 2 };

            (plugin as unknown as { delegate: { getNextTask: () => Promise<TrackerTask> } }).delegate.getNextTask =
                async () => brTask;

            queueSpawnResponse({
                command: 'bv',
                stdout: JSON.stringify({ message: 'No actionable items available' }),
                exitCode: 0,
            });

            const result = await plugin.getNextTask();
            expect(result).toEqual(brTask);
        });

        test('falls back when bv exits non-zero', async () => {
            const plugin = makePlugin(true);
            const brTask: TrackerTask = { id: 'fallback', title: 'Fallback', status: 'open', priority: 2 };

            (plugin as unknown as { delegate: { getNextTask: () => Promise<TrackerTask> } }).delegate.getNextTask =
                async () => brTask;

            queueSpawnResponse({ command: 'bv', exitCode: 1, stderr: 'crash' });

            const result = await plugin.getNextTask();
            expect(result).toEqual(brTask);
        });

        test('falls back when bv output is invalid JSON', async () => {
            const plugin = makePlugin(true);
            const brTask: TrackerTask = { id: 'fallback', title: 'Fallback', status: 'open', priority: 2 };

            (plugin as unknown as { delegate: { getNextTask: () => Promise<TrackerTask> } }).delegate.getNextTask =
                async () => brTask;

            queueSpawnResponse({ command: 'bv', stdout: 'not-json', exitCode: 0 });

            const result = await plugin.getNextTask();
            expect(result).toEqual(brTask);
        });

        test('falls back when bv pick is outside the epic', async () => {
            const plugin = makePlugin(true);
            const brTask: TrackerTask = { id: 'epic-child', title: 'Epic child', status: 'open', priority: 2 };
            const wrongTask: TrackerTask = {
                id: 'outside-task',
                title: 'Wrong task',
                status: 'open',
                priority: 2,
                parentId: 'other-epic',
            };

            (plugin as unknown as { delegate: { getTask: (id: string) => Promise<TrackerTask> } }).delegate.getTask =
                async () => wrongTask;
            (plugin as unknown as { delegate: { getNextTask: () => Promise<TrackerTask> } }).delegate.getNextTask =
                async () => brTask;

            queueSpawnResponse({
                command: 'bv',
                stdout: JSON.stringify({
                    id: 'outside-task',
                    title: 'Wrong task',
                    score: 0.9,
                    reasons: ['high score'],
                    unblocks: 1,
                    claim_command: '',
                    show_command: '',
                }),
                exitCode: 0,
            });

            const result = await plugin.getNextTask({ parentId: 'my-epic' });
            expect(result).toEqual(brTask);
        });

        test('forwards label filter to bv', async () => {
            const plugin = makePlugin(true);

            // Override execBv by intercepting spawn
            queueSpawnResponse({
                command: 'bv',
                stdout: JSON.stringify({ message: 'No actionable items' }),
                exitCode: 0,
            });

            (plugin as unknown as { delegate: { getNextTask: () => Promise<undefined> } }).delegate.getNextTask =
                async () => undefined;

            await plugin.getNextTask({ labels: ['backend'] });

            // Assert that bv was spawned with the correct arguments
            const bvSpawn = capturedSpawns.find(s => s.command === 'bv' && s.args.includes('--robot-next'));
            expect(bvSpawn).toBeDefined();
            expect(bvSpawn?.args).toContain('--label');
            expect(bvSpawn?.args).toContain('backend');
        });
    });

    // ---------------------------------------------------------------------------
    // 4.6 getTasks()
    // ---------------------------------------------------------------------------
    describe('getTasks()', () => {
        test('decorates tasks with bv metadata when triage data is available', async () => {
            const plugin = new BeadsRustBvTrackerPlugin();
            (plugin as unknown as { bvAvailable: boolean }).bvAvailable = true;

            const tasks: TrackerTask[] = [
                { id: 'task-1', title: 'Task 1', status: 'open', priority: 2 },
                { id: 'task-2', title: 'Task 2', status: 'open', priority: 2 },
            ];
            (plugin as unknown as { delegate: { getTasks: () => Promise<TrackerTask[]> } }).delegate.getTasks =
                async () => tasks.map((t) => ({ ...t }));

            (plugin as unknown as { lastTriageOutput: unknown }).lastTriageOutput = {
                triage: {
                    recommendations: [
                        { id: 'task-1', score: 0.9, reasons: ['Top pick'], unblocks: 4 },
                    ],
                },
            };

            const result = await plugin.getTasks();
            const t1 = result.find((t) => t.id === 'task-1');
            const t2 = result.find((t) => t.id === 'task-2');

            expect(t1?.metadata?.bvScore).toBe(0.9);
            expect(t1?.metadata?.bvReasons).toEqual(['Top pick']);
            expect(t1?.metadata?.bvUnblocks).toBe(4);
            expect(t2?.metadata?.bvScore).toBeUndefined();
        });

        test('returns tasks without bv metadata when no triage data', async () => {
            const plugin = new BeadsRustBvTrackerPlugin();
            (plugin as unknown as { bvAvailable: boolean }).bvAvailable = true;
            // lastTriageOutput remains null

            const tasks: TrackerTask[] = [
                { id: 'task-1', title: 'Task 1', status: 'open', priority: 2 },
            ];
            (plugin as unknown as { delegate: { getTasks: () => Promise<TrackerTask[]> } }).delegate.getTasks =
                async () => tasks.map((t) => ({ ...t }));

            const result = await plugin.getTasks();
            expect(result[0]?.metadata).toBeUndefined();
        });
    });

    // ---------------------------------------------------------------------------
    // 4.7 completeTask()
    // ---------------------------------------------------------------------------
    describe('completeTask()', () => {
        test('schedules triage refresh on success when bv is available', async () => {
            const plugin = new BeadsRustBvTrackerPlugin();
            (plugin as unknown as { bvAvailable: boolean }).bvAvailable = true;

            let refreshCalled = false;
            (plugin as unknown as { scheduleTriageRefresh: (force?: boolean) => void }).scheduleTriageRefresh =
                () => { refreshCalled = true; };

            (plugin as unknown as { delegate: { completeTask: (id: string) => Promise<{ success: boolean; message: string }> } }).delegate.completeTask =
                async () => ({ success: true, message: 'done' });

            await plugin.completeTask('task-1');
            expect(refreshCalled).toBe(true);
        });

        test('does not schedule refresh when completeTask fails', async () => {
            const plugin = new BeadsRustBvTrackerPlugin();
            (plugin as unknown as { bvAvailable: boolean }).bvAvailable = true;

            let refreshCalled = false;
            (plugin as unknown as { scheduleTriageRefresh: (force?: boolean) => void }).scheduleTriageRefresh =
                () => { refreshCalled = true; };

            (plugin as unknown as { delegate: { completeTask: (id: string) => Promise<{ success: boolean; message: string }> } }).delegate.completeTask =
                async () => ({ success: false, message: 'failed' });

            await plugin.completeTask('task-1');
            expect(refreshCalled).toBe(false);
        });
    });

    // ---------------------------------------------------------------------------
    // 4.8 updateTaskStatus()
    // ---------------------------------------------------------------------------
    describe('updateTaskStatus()', () => {
        test('schedules triage refresh when status update returns a task', async () => {
            const plugin = new BeadsRustBvTrackerPlugin();
            (plugin as unknown as { bvAvailable: boolean }).bvAvailable = true;

            let refreshCalled = false;
            (plugin as unknown as { scheduleTriageRefresh: (force?: boolean) => void }).scheduleTriageRefresh =
                () => { refreshCalled = true; };

            const updated: TrackerTask = { id: 'task-1', title: 'Task 1', status: 'in_progress', priority: 2 };
            (plugin as unknown as { delegate: { updateTaskStatus: (id: string, status: string) => Promise<TrackerTask> } }).delegate.updateTaskStatus =
                async () => updated;

            await plugin.updateTaskStatus('task-1', 'in_progress');
            expect(refreshCalled).toBe(true);
        });

        test('does not schedule refresh when update returns undefined', async () => {
            const plugin = new BeadsRustBvTrackerPlugin();
            (plugin as unknown as { bvAvailable: boolean }).bvAvailable = true;

            let refreshCalled = false;
            (plugin as unknown as { scheduleTriageRefresh: (force?: boolean) => void }).scheduleTriageRefresh =
                () => { refreshCalled = true; };

            (plugin as unknown as { delegate: { updateTaskStatus: (id: string, status: string) => Promise<undefined> } }).delegate.updateTaskStatus =
                async () => undefined;

            await plugin.updateTaskStatus('task-1', 'in_progress');
            expect(refreshCalled).toBe(false);
        });
    });

    // ---------------------------------------------------------------------------
    // 4.9 getSetupQuestions()
    // ---------------------------------------------------------------------------
    describe('getSetupQuestions()', () => {
        test('returns an array', () => {
            const plugin = new BeadsRustBvTrackerPlugin();
            const questions = plugin.getSetupQuestions();
            expect(Array.isArray(questions)).toBe(true);
        });
    });

    // ---------------------------------------------------------------------------
    // 4.10 validateSetup()
    // ---------------------------------------------------------------------------
    describe('validateSetup()', () => {
        test('returns null (valid) when br is configured correctly', async () => {
            const plugin = new BeadsRustBvTrackerPlugin();

            // Stub delegate.validateSetup → null
            (plugin as unknown as { delegate: { validateSetup: (a: Record<string, unknown>) => Promise<null> } }).delegate.validateSetup =
                async () => null;
            // Stub detect → bv available
            plugin.detect = async () => ({ available: true, bvAvailable: true });

            const result = await plugin.validateSetup({});
            expect(result).toBeNull();
        });

        test('warns (does not error) when bv is absent', async () => {
            const plugin = new BeadsRustBvTrackerPlugin();

            (plugin as unknown as { delegate: { validateSetup: (a: Record<string, unknown>) => Promise<null> } }).delegate.validateSetup =
                async () => null;
            // Stub detect → bv missing
            plugin.detect = async () => ({ available: true, bvAvailable: false });

            // Should not throw, should return null (warning only)
            const result = await plugin.validateSetup({});
            expect(result).toBeNull();
        });

        test('returns error from delegate when br setup is invalid', async () => {
            const plugin = new BeadsRustBvTrackerPlugin();

            (plugin as unknown as { delegate: { validateSetup: (a: Record<string, unknown>) => Promise<string> } }).delegate.validateSetup =
                async () => 'br not configured';

            const result = await plugin.validateSetup({});
            expect(result).toBe('br not configured');
        });
    });

    // ---------------------------------------------------------------------------
    // 4.11 Error handling
    // ---------------------------------------------------------------------------
    describe('error handling in getNextTask()', () => {
        test('returns delegate result without throwing when bv throws unexpectedly', async () => {
            const plugin = new BeadsRustBvTrackerPlugin();
            (plugin as unknown as { bvAvailable: boolean }).bvAvailable = true;

            const brTask: TrackerTask = { id: 'safe', title: 'Safe task', status: 'open', priority: 2 };
            (plugin as unknown as { delegate: { getNextTask: () => Promise<TrackerTask> } }).delegate.getNextTask =
                async () => brTask;

            // Make spawn throw hard by exhausting the queue (spawn returns exitCode: 0 with empty stdout)
            // but make getTask throw to simulate an unexpected error mid-flow.
            queueSpawnResponse({
                command: 'bv',
                stdout: JSON.stringify({
                    id: 'bad-task',
                    title: 'Bad',
                    score: 0.5,
                    reasons: [],
                    unblocks: 0,
                    claim_command: '',
                    show_command: '',
                }),
                exitCode: 0,
            });

            (plugin as unknown as { delegate: { getTask: (id: string) => Promise<never> } }).delegate.getTask =
                async () => { throw new Error('unexpected failure'); };
            (plugin as unknown as { scheduleTriageRefresh: () => void }).scheduleTriageRefresh = () => { };

            const result = await plugin.getNextTask();
            // Should fall back gracefully
            expect(result).toEqual(brTask);
        });
    });

    // ---------------------------------------------------------------------------
    // Template test
    // ---------------------------------------------------------------------------
    describe('getTemplate()', () => {
        test('returns template with br commands', () => {
            const plugin = new BeadsRustBvTrackerPlugin();
            const tpl = plugin.getTemplate();
            expect(tpl).toContain('br close');
            expect(tpl).toContain('br sync');
        });

        test('template includes selectionReason block', () => {
            const plugin = new BeadsRustBvTrackerPlugin();
            const tpl = plugin.getTemplate();
            expect(tpl).toContain('selectionReason');
            expect(tpl).toContain('Why This Task Was Selected');
        });
    });

    // ---------------------------------------------------------------------------
    // scheduleTriageRefresh deduplication
    // ---------------------------------------------------------------------------
    describe('scheduleTriageRefresh', () => {
        test('queues a forced refresh while a refresh is already in-flight', async () => {
            const plugin = new BeadsRustBvTrackerPlugin();
            const state = plugin as unknown as {
                bvAvailable: boolean;
                scheduleTriageRefresh: (force?: boolean) => void;
                refreshTriage: () => Promise<void>;
                triageRefreshInFlight: Promise<void> | null;
            };

            state.bvAvailable = true;

            let refreshCalls = 0;
            let releaseFirst!: () => void;
            const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });

            state.refreshTriage = async () => {
                refreshCalls += 1;
                if (refreshCalls === 1) await gate;
            };

            state.scheduleTriageRefresh();
            state.scheduleTriageRefresh(true);

            expect(refreshCalls).toBe(1);
            expect(state.triageRefreshInFlight).not.toBeNull();

            releaseFirst();

            for (let i = 0; i < 20; i++) {
                if (refreshCalls === 2 && state.triageRefreshInFlight === null) break;
                await new Promise((r) => setTimeout(r, 5));
            }

            expect(refreshCalls).toBe(2);
            expect(state.triageRefreshInFlight).toBeNull();
        });
    });
});
