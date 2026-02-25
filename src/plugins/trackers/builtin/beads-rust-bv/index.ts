/**
 * ABOUTME: Beads-Rust + Beads Viewer (bv) tracker plugin for smart task selection.
 * Combines the br CLI (beads-rust) for task CRUD with bv graph-aware algorithms
 * (--robot-next) for optimal task ordering. Delegates all br operations to an
 * internal BeadsRustTrackerPlugin instance. Falls back gracefully when bv is
 * unavailable.
 */

import { spawn } from 'node:child_process';
import { BaseTrackerPlugin } from '../../base.js';
import {
    BeadsRustTrackerPlugin,
    type BeadsRustDetectResult,
} from '../beads-rust/index.js';
import { BEADS_RUST_BV_TEMPLATE } from '../../../../templates/builtin.js';
import type {
    TrackerPluginMeta,
    TrackerPluginFactory,
    TrackerTask,
    TrackerTaskStatus,
    TaskFilter,
    TaskCompletionResult,
    SyncResult,
    SetupQuestion,
} from '../../types.js';

const TRIAGE_REFRESH_MIN_INTERVAL_MS = 30_000;

/**
 * Output from bv --robot-next when an actionable task exists.
 */
interface BvRobotNextTask {
    generated_at: string;
    data_hash: string;
    output_format: string;
    id: string;
    title: string;
    score: number;
    reasons: string[];
    unblocks: number;
    claim_command: string;
    show_command: string;
}

/**
 * Output from bv --robot-next when no actionable items are available.
 */
interface BvRobotNextEmpty {
    generated_at: string;
    data_hash: string;
    output_format: string;
    message: string;
}

type BvRobotNextOutput = BvRobotNextTask | BvRobotNextEmpty;

/**
 * Structure of bv --robot-triage JSON output (subset we use for metadata).
 */
interface BvTriageRecommendation {
    id: string;
    score: number;
    reasons: string[];
    unblocks?: number;
}

interface BvTriageOutput {
    triage: {
        recommendations: BvTriageRecommendation[];
    };
}

/**
 * Detection result including bv availability.
 */
export interface BeadsRustBvDetectResult extends BeadsRustDetectResult {
    bvAvailable: boolean;
    bvPath?: string;
}

/**
 * Execute a bv command and return stdout/stderr/exitCode.
 */
async function execBv(
    args: string[],
    cwd?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
        const proc = spawn('bv', args, {
            cwd,
            env: { ...process.env },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data: Buffer) => {
            stdout += data.toString();
        });

        proc.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        proc.on('close', (code) => {
            resolve({ stdout, stderr, exitCode: code ?? 1 });
        });

        proc.on('error', (err) => {
            stderr += err.message;
            resolve({ stdout, stderr, exitCode: 1 });
        });
    });
}

function hasMessageField(value: unknown): value is { message: string } {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as Record<string, unknown>).message === 'string'
    );
}

function hasValidTaskId(value: unknown): value is { id: string } {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as Record<string, unknown>).id === 'string' &&
        ((value as Record<string, unknown>).id as string).trim().length > 0
    );
}

/**
 * Beads-Rust + bv tracker plugin.
 *
 * Extends BaseTrackerPlugin and composes a BeadsRustTrackerPlugin internally
 * to handle all br-CLI operations. Overrides getNextTask to use bv's graph
 * analysis and decorates getTasks with bv score metadata.
 */
export class BeadsRustBvTrackerPlugin extends BaseTrackerPlugin {
    override readonly meta: TrackerPluginMeta = {
        id: 'beads-rust-bv',
        name: 'Beads Rust + Beads Viewer (Smart Mode)',
        description:
            'Smart task selection using bv graph analysis (PageRank, critical path) with the br CLI',
        version: '1.0.0',
        supportsBidirectionalSync: true,
        supportsHierarchy: true,
        supportsDependencies: true,
    };

    /** Internal beads-rust delegate for all br operations. */
    private readonly delegate: BeadsRustTrackerPlugin;

    private bvAvailable = false;
    private lastTriageOutput: BvTriageOutput | null = null;
    private triageRefreshInFlight: Promise<void> | null = null;
    private pendingForcedTriageRefresh = false;
    private lastTriageRefreshAt = 0;
    private workingDir: string = process.cwd();
    private labels: string[] = [];

    constructor() {
        super();
        this.delegate = new BeadsRustTrackerPlugin();
    }

    override async initialize(config: Record<string, unknown>): Promise<void> {
        await super.initialize(config);

        // Store working dir and labels for bv invocations.
        if (typeof config.workingDir === 'string') {
            this.workingDir = config.workingDir;
        }
        if (typeof config.labels === 'string') {
            this.labels = config.labels
                .split(',')
                .map((l) => l.trim())
                .filter(Boolean);
        } else if (Array.isArray(config.labels)) {
            this.labels = config.labels.filter(
                (l): l is string => typeof l === 'string'
            );
        }

        // Initialize the delegate (br detection, epic, labels).
        await this.delegate.initialize(config);

        // Determine overall readiness and bv availability.
        const detection = await this.detect();
        this.ready = detection.available;
        this.bvAvailable = detection.bvAvailable;
    }

    /**
     * Detect br and bv availability.
     */
    async detect(): Promise<BeadsRustBvDetectResult> {
        const brDetect = await this.delegate.detect();

        if (!brDetect.available) {
            return { ...brDetect, bvAvailable: false };
        }

        const bvResult = await execBv(['--version'], this.workingDir);
        const bvAvailable = bvResult.exitCode === 0;

        return {
            ...brDetect,
            bvAvailable,
            bvPath: bvAvailable ? 'bv' : undefined,
        };
    }

    override async isReady(): Promise<boolean> {
        return this.ready;
    }

    // -------------------------------------------------------------------------
    // Delegation to BeadsRustTrackerPlugin for all br operations
    // -------------------------------------------------------------------------

    override async getTasks(filter?: TaskFilter): Promise<TrackerTask[]> {
        const tasks = await this.delegate.getTasks(filter);

        // Decorate with bv score metadata when triage data is available.
        if (this.bvAvailable && this.lastTriageOutput) {
            const recMap = new Map<string, BvTriageRecommendation>();
            for (const rec of this.lastTriageOutput.triage.recommendations) {
                recMap.set(rec.id, rec);
            }
            for (const task of tasks) {
                const rec = recMap.get(task.id);
                if (rec) {
                    task.metadata = {
                        ...task.metadata,
                        bvScore: rec.score,
                        bvReasons: rec.reasons,
                        bvUnblocks: rec.unblocks ?? 0,
                    };
                }
            }
        }

        return tasks;
    }

    override async getTask(id: string): Promise<TrackerTask | undefined> {
        return this.delegate.getTask(id);
    }

    /**
     * Get the next task using bv's --robot-next when available.
     * Falls back to the beads-rust delegate (br ready) on any failure.
     */
    override async getNextTask(
        filter?: TaskFilter
    ): Promise<TrackerTask | undefined> {
        if (!this.bvAvailable) {
            return this.delegate.getNextTask(filter);
        }

        try {
            const args = ['--robot-next'];

            // Forward label filter.
            const labelsToUse =
                filter?.labels && filter.labels.length > 0 ? filter.labels : this.labels;
            if (labelsToUse.length > 0) {
                args.push('--label', labelsToUse[0]!);
            }

            const { stdout, exitCode, stderr } = await execBv(
                args,
                this.workingDir
            );

            if (exitCode !== 0) {
                console.error('bv --robot-next failed:', stderr);
                return this.delegate.getNextTask(filter);
            }

            let nextOutputRaw: unknown;
            try {
                nextOutputRaw = JSON.parse(stdout) as BvRobotNextOutput;
            } catch (err) {
                console.error('Failed to parse bv --robot-next output:', err);
                return this.delegate.getNextTask(filter);
            }

            if (hasMessageField(nextOutputRaw)) {
                // No actionable items.
                return this.delegate.getNextTask(filter);
            }

            if (!hasValidTaskId(nextOutputRaw)) {
                console.error(
                    'Invalid bv --robot-next output (missing task id):',
                    nextOutputRaw
                );
                return this.delegate.getNextTask(filter);
            }

            const nextOutput = nextOutputRaw as BvRobotNextTask;

            // Check epic membership: if an epic filter is active, ensure bv's pick
            // belongs to it, otherwise fall back.
            const epicFilter = filter?.parentId;
            if (epicFilter) {
                const fullTask = await this.delegate.getTask(nextOutput.id);
                if (!fullTask || fullTask.parentId !== epicFilter) {
                    return this.delegate.getNextTask(filter);
                }
                // Augment and return.
                fullTask.metadata = {
                    ...fullTask.metadata,
                    bvScore: nextOutput.score,
                    bvReasons: nextOutput.reasons,
                    bvUnblocks: nextOutput.unblocks,
                };
                return fullTask;
            }

            // Schedule background triage refresh for metadata enrichment.
            this.scheduleTriageRefresh();

            // Fetch full task details.
            const fullTask = await this.delegate.getTask(nextOutput.id);
            if (fullTask) {
                fullTask.metadata = {
                    ...fullTask.metadata,
                    bvScore: nextOutput.score,
                    bvReasons: nextOutput.reasons,
                    bvUnblocks: nextOutput.unblocks,
                };
                return fullTask;
            }

            // Fallback: construct minimal task from robot-next output.
            return {
                id: nextOutput.id,
                title: nextOutput.title,
                status: 'open' as TrackerTaskStatus,
                priority: 2,
                metadata: {
                    bvScore: nextOutput.score,
                    bvReasons: nextOutput.reasons,
                    bvUnblocks: nextOutput.unblocks,
                },
            };
        } catch (err) {
            console.error('Error in BeadsRustBvTrackerPlugin.getNextTask:', err);
            return this.delegate.getNextTask(filter);
        }
    }

    override async completeTask(
        id: string,
        reason?: string
    ): Promise<TaskCompletionResult> {
        const result = await this.delegate.completeTask(id, reason);

        if (result.success && this.bvAvailable) {
            this.scheduleTriageRefresh(true);
        }

        return result;
    }

    override async updateTaskStatus(
        id: string,
        status: TrackerTaskStatus
    ): Promise<TrackerTask | undefined> {
        const result = await this.delegate.updateTaskStatus(id, status);

        if (result && this.bvAvailable) {
            this.scheduleTriageRefresh(true);
        }

        return result;
    }

    override async isComplete(filter?: TaskFilter): Promise<boolean> {
        return this.delegate.isComplete(filter);
    }

    override async sync(): Promise<SyncResult> {
        return this.delegate.sync();
    }

    override async isTaskReady(id: string): Promise<boolean> {
        return this.delegate.isTaskReady(id);
    }

    override async getEpics(): Promise<TrackerTask[]> {
        return this.delegate.getEpics();
    }

    setEpicId(epicId: string): void {
        this.delegate.setEpicId(epicId);
    }

    override getSetupQuestions(): SetupQuestion[] {
        return this.delegate.getSetupQuestions();
    }

    override async validateSetup(
        answers: Record<string, unknown>
    ): Promise<string | null> {
        const brValidation = await this.delegate.validateSetup(answers);
        if (brValidation) {
            return brValidation;
        }

        const detection = await this.detect();
        if (!detection.bvAvailable) {
            console.warn(
                'Warning: bv binary not found. Smart task selection will fall back to br behavior.'
            );
        }

        return null;
    }

    override async dispose(): Promise<void> {
        await this.delegate.dispose();
        await super.dispose();
    }

    // Delegate getPrdContext if available.
    async getPrdContext(): Promise<{
        name: string;
        description?: string;
        content: string;
        completedCount: number;
        totalCount: number;
    } | null> {
        return this.delegate.getPrdContext();
    }

    /**
     * Check whether bv is available for smart task selection.
     */
    isBvAvailable(): boolean {
        return this.bvAvailable;
    }

    /**
     * Force a refresh of bv triage data.
     */
    async refreshTriage(): Promise<void> {
        if (!this.bvAvailable) {
            return;
        }

        const args = ['--robot-triage'];
        if (this.labels.length > 0) {
            args.push('--label', this.labels[0]!);
        }

        const { stdout, exitCode } = await execBv(args, this.workingDir);

        if (exitCode === 0) {
            try {
                this.lastTriageOutput = JSON.parse(stdout) as BvTriageOutput;
                this.lastTriageRefreshAt = Date.now();
            } catch {
                // Ignore parse errors.
            }
        }
    }

    override getTemplate(): string {
        return BEADS_RUST_BV_TEMPLATE;
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private scheduleTriageRefresh(force = false): void {
        if (!this.bvAvailable) {
            return;
        }

        if (this.triageRefreshInFlight) {
            if (force) {
                this.pendingForcedTriageRefresh = true;
            }
            return;
        }

        const now = Date.now();
        if (
            !force &&
            this.lastTriageRefreshAt > 0 &&
            now - this.lastTriageRefreshAt < TRIAGE_REFRESH_MIN_INTERVAL_MS
        ) {
            return;
        }

        this.triageRefreshInFlight = this.refreshTriage()
            .catch((err) => {
                console.error('Failed to refresh bv triage data:', err);
            })
            .finally(() => {
                this.triageRefreshInFlight = null;

                if (this.pendingForcedTriageRefresh) {
                    this.pendingForcedTriageRefresh = false;
                    this.scheduleTriageRefresh(true);
                }
            });
    }
}

/**
 * Factory function for the Beads-Rust + bv tracker plugin.
 */
const createBeadsRustBvTracker: TrackerPluginFactory = () =>
    new BeadsRustBvTrackerPlugin();

export default createBeadsRustBvTracker;
