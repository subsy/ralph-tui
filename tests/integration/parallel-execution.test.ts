/**
 * ABOUTME: Integration tests for end-to-end parallel execution.
 * Tests the complete parallel execution flow including task analysis,
 * worktree management, agent execution, and merge consolidation.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { ParallelExecutor } from '../../src/worktree/parallel-executor.js';
import { WorktreePoolManager } from '../../src/worktree/manager.js';
import { Coordinator } from '../../src/worktree/coordinator.js';
import { MergeEngine } from '../../src/worktree/merge-engine.js';
import type { ParallelExecutorEvent } from '../../src/worktree/parallel-executor-types.js';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Parallel Execution Integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `ralph-integration-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  describe('ParallelExecutor lifecycle', () => {
    test('should create executor with default config', () => {
      const executor = new ParallelExecutor({
        workingDir: tempDir,
        maxConcurrency: 2,
      });
      
      expect(executor).toBeDefined();
    });

    test('should get empty stats before any execution', () => {
      const executor = new ParallelExecutor({
        workingDir: tempDir,
      });
      
      const stats = executor.getStats();
      
      expect(stats.totalExecutions).toBe(0);
      expect(stats.totalTasksExecuted).toBe(0);
      expect(stats.totalTasksCompleted).toBe(0);
      expect(stats.totalTasksFailed).toBe(0);
    });

    test('should add and remove event listeners', () => {
      const executor = new ParallelExecutor({
        workingDir: tempDir,
      });
      
      const listener = mock((_event: ParallelExecutorEvent) => {});
      
      executor.addEventListener(listener);
      executor.removeEventListener(listener);
      
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Component integration', () => {
    test('WorktreePoolManager and Coordinator should work together', async () => {
      const manager = new WorktreePoolManager(tempDir, {
        maxWorktrees: 4,
        worktreeDir: '.worktrees',
      });
      
      const coordinator = new Coordinator();
      
      await manager.initialize();
      coordinator.start();
      
      const agent = coordinator.registerAgent('agent-1', 'Test Agent');
      expect(agent.status).toBe('idle');
      
      coordinator.updateAgentStatus('agent-1', 'working');
      expect(coordinator.getAgent('agent-1')?.status).toBe('working');
      
      coordinator.stop();
    });

    test('MergeEngine should integrate with WorktreePoolManager', async () => {
      const manager = new WorktreePoolManager(tempDir, {
        maxWorktrees: 4,
      });
      
      const mergeEngine = new MergeEngine({
        projectRoot: tempDir,
        createBackupBranch: false,
      });
      
      await manager.initialize();
      
      const managerState = manager.getWorktrees();
      const mergeState = mergeEngine.getState();
      
      expect(managerState).toEqual([]);
      expect(mergeState.isSessionActive).toBe(false);
    });
  });

  describe('Empty execution', () => {
    test('should handle empty work units gracefully', async () => {
      const executor = new ParallelExecutor({
        workingDir: tempDir,
        maxConcurrency: 2,
      });
      
      await executor.initialize();
      
      const result = await executor.execute([]);
      
      expect(result.success).toBe(true);
      expect(result.totalTasks).toBe(0);
      expect(result.completedTasks).toBe(0);
      expect(result.failedTasks).toBe(0);
      
      await executor.dispose();
    });
  });

  describe('Event emission', () => {
    test('should emit execution_started and execution_completed events', async () => {
      const executor = new ParallelExecutor({
        workingDir: tempDir,
        maxConcurrency: 2,
      });
      
      const events: ParallelExecutorEvent[] = [];
      executor.addEventListener((event) => events.push(event));
      
      await executor.initialize();
      await executor.execute([]);
      await executor.dispose();
      
      const eventTypes = events.map(e => e.type);
      expect(eventTypes).toContain('execution_started');
      expect(eventTypes).toContain('execution_completed');
    });
  });

  describe('Stats tracking', () => {
    test('should track execution count', async () => {
      const executor = new ParallelExecutor({
        workingDir: tempDir,
      });
      
      await executor.initialize();
      
      await executor.execute([]);
      await executor.execute([]);
      
      const stats = executor.getStats();
      expect(stats.totalExecutions).toBe(2);
      
      await executor.dispose();
    });
  });

  describe('Shutdown behavior', () => {
    test('should shutdown gracefully', async () => {
      const executor = new ParallelExecutor({
        workingDir: tempDir,
      });
      
      await executor.initialize();
      await executor.shutdown();
      
      await expect(executor.dispose()).resolves.toBeUndefined();
    });
  });
});

describe('Full Pipeline Integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `ralph-pipeline-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  test('complete pipeline with all components', async () => {
    const manager = new WorktreePoolManager(tempDir, {
      maxWorktrees: 2,
    });
    
    const coordinator = new Coordinator();
    
    const executor = new ParallelExecutor({
      workingDir: tempDir,
      maxConcurrency: 2,
    });
    
    const mergeEngine = new MergeEngine({
      projectRoot: tempDir,
      createBackupBranch: false,
    });
    
    await manager.initialize();
    coordinator.start();
    await executor.initialize();
    
    expect(manager.activeWorktreeCount).toBe(0);
    expect(coordinator.getAllAgents().length).toBe(0);
    expect(executor.getStats().totalExecutions).toBe(0);
    expect(mergeEngine.getState().isSessionActive).toBe(false);
    
    coordinator.stop();
    await executor.dispose();
  });
});
