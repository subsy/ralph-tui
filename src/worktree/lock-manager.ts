/**
 * ABOUTME: Resource Lock Manager for coordinating access to shared resources.
 * Implements a readers-writer lock pattern with timeout-based deadlock prevention
 * and shared cache isolation for parallel agent execution in worktrees.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, cp, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type ResourceLock,
  type LockMode,
  type ResourceCategory,
  type LockAcquisitionResult,
  type LockAcquisitionOptions,
  type PendingLockRequest,
  type ResourceLockManagerConfig,
  type ResourceLockEvent,
  type ResourceLockEventListener,
  type ResourceLockManagerStats,
  type WorktreeCacheState,
  DEFAULT_RESOURCE_LOCK_MANAGER_CONFIG,
} from './lock-types.js';

interface ResourceState {
  locks: ResourceLock[];
  waitQueue: PendingLockRequest[];
}

export class ResourceLockManager {
  private readonly config: ResourceLockManagerConfig;
  private readonly resources: Map<string, ResourceState> = new Map();
  private readonly agentLocks: Map<string, Set<string>> = new Map();
  private readonly worktreeCaches: Map<string, WorktreeCacheState> = new Map();
  private readonly listeners: Set<ResourceLockEventListener> = new Set();
  private readonly startedAt: Date;
  private expiredLockCount = 0;
  private deadlockCount = 0;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private worktreeCreationPaused = false;
  private readonly projectRoot: string;

  constructor(projectRoot: string, config: Partial<ResourceLockManagerConfig> = {}) {
    this.config = { ...DEFAULT_RESOURCE_LOCK_MANAGER_CONFIG, ...config };
    this.projectRoot = projectRoot;
    this.startedAt = new Date();
  }

  start(): void {
    if (this.checkTimer) {
      return;
    }

    this.checkTimer = setInterval(() => {
      this.expireLocks();
      if (this.config.enableDeadlockDetection) {
        this.detectDeadlocks();
      }
      this.checkResourceExhaustion();
    }, this.config.lockCheckIntervalMs);
  }

  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  acquire(
    agentId: string,
    resourceName: string,
    options: LockAcquisitionOptions = {}
  ): Promise<LockAcquisitionResult> {
    const mode = options.mode ?? 'write';
    const lockTimeoutMs = options.lockTimeoutMs ?? this.config.defaultLockTimeoutMs;
    const waitTimeoutMs = options.waitTimeoutMs ?? 0;
    const category = options.category ?? 'custom';

    const agentLockCount = this.agentLocks.get(agentId)?.size ?? 0;
    if (agentLockCount >= this.config.maxLocksPerAgent) {
      return Promise.resolve({
        success: false,
        reason: 'max_locks_exceeded',
      });
    }

    const resource = this.getOrCreateResource(resourceName);
    const canAcquire = this.canAcquireLock(resource, mode);

    if (canAcquire) {
      const lock = this.createLock(agentId, resourceName, mode, lockTimeoutMs, category, options);
      resource.locks.push(lock);
      this.trackAgentLock(agentId, lock.id);
      this.emit({ type: 'lock_acquired', lock });
      return Promise.resolve({ success: true, lock });
    }

    if (waitTimeoutMs === 0) {
      const waitingBehind = resource.locks.map((l) => l.holderAgentId);
      return Promise.resolve({
        success: false,
        reason: mode === 'write' ? 'write_lock_blocked_by_readers' : 'resource_locked_exclusive',
        waitingBehind,
      });
    }

    return this.enqueueRequest(agentId, resourceName, mode, lockTimeoutMs, waitTimeoutMs, category, options);
  }

  release(agentId: string, resourceName: string): boolean {
    const resource = this.resources.get(resourceName);
    if (!resource) {
      return false;
    }

    const lockIndex = resource.locks.findIndex((l) => l.holderAgentId === agentId);
    if (lockIndex === -1) {
      return false;
    }

    const [lock] = resource.locks.splice(lockIndex, 1);
    this.untrackAgentLock(agentId, lock.id);
    this.emit({ type: 'lock_released', lock });

    this.processWaitQueue(resourceName);
    return true;
  }

  releaseAll(agentId: string): number {
    const lockIds = this.agentLocks.get(agentId);
    if (!lockIds) {
      return 0;
    }

    let released = 0;
    for (const [resourceName, resource] of this.resources) {
      const locksToRelease = resource.locks.filter((l) => l.holderAgentId === agentId);
      for (const lock of locksToRelease) {
        const idx = resource.locks.indexOf(lock);
        if (idx !== -1) {
          resource.locks.splice(idx, 1);
          this.emit({ type: 'lock_released', lock });
          released++;
        }
      }
      if (locksToRelease.length > 0) {
        this.processWaitQueue(resourceName);
      }
    }

    this.agentLocks.delete(agentId);
    return released;
  }

  getLock(resourceName: string, agentId?: string): ResourceLock | undefined {
    const resource = this.resources.get(resourceName);
    if (!resource) {
      return undefined;
    }

    if (agentId) {
      return resource.locks.find((l) => l.holderAgentId === agentId);
    }

    return resource.locks[0];
  }

  getLocksForAgent(agentId: string): ResourceLock[] {
    const locks: ResourceLock[] = [];
    for (const resource of this.resources.values()) {
      for (const lock of resource.locks) {
        if (lock.holderAgentId === agentId) {
          locks.push(lock);
        }
      }
    }
    return locks;
  }

  isLocked(resourceName: string): boolean {
    const resource = this.resources.get(resourceName);
    return resource ? resource.locks.length > 0 : false;
  }

  isWriteLocked(resourceName: string): boolean {
    const resource = this.resources.get(resourceName);
    return resource ? resource.locks.some((l) => l.mode === 'write') : false;
  }

  getWaitQueueSize(resourceName: string): number {
    const resource = this.resources.get(resourceName);
    return resource ? resource.waitQueue.length : 0;
  }

  isWorktreeCreationPaused(): boolean {
    return this.worktreeCreationPaused;
  }

  pauseWorktreeCreation(reason: string): void {
    if (!this.worktreeCreationPaused) {
      this.worktreeCreationPaused = true;
      this.emit({ type: 'worktree_creation_paused', reason });
    }
  }

  resumeWorktreeCreation(): void {
    this.worktreeCreationPaused = false;
  }

  async initializeWorktreeCache(worktreeId: string, worktreePath: string): Promise<WorktreeCacheState> {
    const cachePath = join(worktreePath, '.cache');
    await mkdir(cachePath, { recursive: true });

    const cacheState: WorktreeCacheState = {
      worktreeId,
      cachePath,
      initialized: false,
      modifiedResources: [],
      sizeBytes: 0,
    };

    const sharedCachePath = join(this.projectRoot, this.config.cacheIsolation.sharedCachePath);

    if (this.config.cacheIsolation.copyOnWrite) {
      try {
        await mkdir(sharedCachePath, { recursive: true });
        const entries = await readdir(sharedCachePath, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
          const src = join(sharedCachePath, entry.name);
          const dest = join(cachePath, entry.name);
          await cp(src, dest, { recursive: true });
        }
        cacheState.initialized = true;
      } catch (error) {
        // Shared cache copy failed - log but continue with empty cache
        console.error(
          `[ResourceLockManager] Failed to initialize worktree cache from shared cache: ${error instanceof Error ? error.message : String(error)}`
        );
        cacheState.initialized = true;
      }
    } else {
      cacheState.initialized = true;
    }

    this.worktreeCaches.set(worktreeId, cacheState);
    return cacheState;
  }

  async syncWorktreeCacheToShared(worktreeId: string): Promise<boolean> {
    if (!this.config.cacheIsolation.syncOnMerge) {
      return false;
    }

    const cacheState = this.worktreeCaches.get(worktreeId);
    if (!cacheState || cacheState.modifiedResources.length === 0) {
      return false;
    }

    const sharedCachePath = join(this.projectRoot, this.config.cacheIsolation.sharedCachePath);

    try {
      await mkdir(sharedCachePath, { recursive: true });
      for (const resource of cacheState.modifiedResources) {
        const src = join(cacheState.cachePath, resource);
        const dest = join(sharedCachePath, resource);
        await cp(src, dest, { recursive: true }).catch(() => {});
      }
      return true;
    } catch {
      return false;
    }
  }

  async cleanupWorktreeCache(worktreeId: string): Promise<void> {
    const cacheState = this.worktreeCaches.get(worktreeId);
    if (cacheState) {
      await rm(cacheState.cachePath, { recursive: true, force: true }).catch(() => {});
      this.worktreeCaches.delete(worktreeId);
    }
  }

  markCacheModified(worktreeId: string, resourceName: string): void {
    const cacheState = this.worktreeCaches.get(worktreeId);
    if (cacheState && !cacheState.modifiedResources.includes(resourceName)) {
      cacheState.modifiedResources.push(resourceName);
      cacheState.lastModifiedAt = new Date();
    }
  }

  getWorktreeCacheState(worktreeId: string): WorktreeCacheState | undefined {
    return this.worktreeCaches.get(worktreeId);
  }

  addEventListener(listener: ResourceLockEventListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(listener: ResourceLockEventListener): void {
    this.listeners.delete(listener);
  }

  getStats(): ResourceLockManagerStats {
    const locksByMode: Record<LockMode, number> = { read: 0, write: 0 };
    const locksByCategory: Record<ResourceCategory, number> = {
      build_cache: 0,
      lock_file: 0,
      node_modules: 0,
      git_index: 0,
      temp_directory: 0,
      shared_state: 0,
      custom: 0,
    };
    const agentLockCounts: Map<string, number> = new Map();
    const resourceWaitQueues: { resourceName: string; waitQueueSize: number }[] = [];
    let totalLocks = 0;
    let totalPending = 0;

    for (const [resourceName, resource] of this.resources) {
      for (const lock of resource.locks) {
        totalLocks++;
        locksByMode[lock.mode]++;
        locksByCategory[lock.category]++;
        agentLockCounts.set(lock.holderAgentId, (agentLockCounts.get(lock.holderAgentId) ?? 0) + 1);
      }
      totalPending += resource.waitQueue.length;
      if (resource.waitQueue.length > 0) {
        resourceWaitQueues.push({ resourceName, waitQueueSize: resource.waitQueue.length });
      }
    }

    const topLockHolders = Array.from(agentLockCounts.entries())
      .map(([agentId, count]) => ({ agentId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const mostContestedResources = resourceWaitQueues
      .sort((a, b) => b.waitQueueSize - a.waitQueueSize)
      .slice(0, 5);

    return {
      activeLocks: totalLocks,
      locksByMode,
      locksByCategory,
      pendingRequests: totalPending,
      expiredLocks: this.expiredLockCount,
      deadlocksDetected: this.deadlockCount,
      topLockHolders,
      mostContestedResources,
      startedAt: this.startedAt,
    };
  }

  private getOrCreateResource(resourceName: string): ResourceState {
    let resource = this.resources.get(resourceName);
    if (!resource) {
      resource = { locks: [], waitQueue: [] };
      this.resources.set(resourceName, resource);
    }
    return resource;
  }

  private canAcquireLock(resource: ResourceState, mode: LockMode): boolean {
    if (resource.locks.length === 0) {
      return true;
    }

    if (mode === 'read') {
      return resource.locks.every((l) => l.mode === 'read');
    }

    return false;
  }

  private createLock(
    agentId: string,
    resourceName: string,
    mode: LockMode,
    timeoutMs: number,
    category: ResourceCategory,
    options: LockAcquisitionOptions
  ): ResourceLock {
    const now = new Date();
    return {
      id: randomUUID(),
      resourceName,
      category,
      holderAgentId: agentId,
      mode,
      acquiredAt: now,
      timeoutMs,
      expiresAt: timeoutMs > 0 ? new Date(now.getTime() + timeoutMs) : undefined,
      worktreeId: options.worktreeId,
      metadata: options.metadata,
    };
  }

  private trackAgentLock(agentId: string, lockId: string): void {
    let locks = this.agentLocks.get(agentId);
    if (!locks) {
      locks = new Set();
      this.agentLocks.set(agentId, locks);
    }
    locks.add(lockId);
  }

  private untrackAgentLock(agentId: string, lockId: string): void {
    const locks = this.agentLocks.get(agentId);
    if (locks) {
      locks.delete(lockId);
      if (locks.size === 0) {
        this.agentLocks.delete(agentId);
      }
    }
  }

  private enqueueRequest(
    agentId: string,
    resourceName: string,
    mode: LockMode,
    lockTimeoutMs: number,
    waitTimeoutMs: number,
    category: ResourceCategory,
    options: LockAcquisitionOptions
  ): Promise<LockAcquisitionResult> {
    const resource = this.getOrCreateResource(resourceName);

    if (resource.waitQueue.length >= this.config.maxWaitQueueSize) {
      return Promise.resolve({
        success: false,
        reason: 'timeout_waiting',
        waitingBehind: resource.locks.map((l) => l.holderAgentId),
      });
    }

    this.emit({ type: 'lock_wait_started', agentId, resourceName, mode });

    return new Promise((resolve) => {
      const request: PendingLockRequest = {
        id: randomUUID(),
        resourceName,
        agentId,
        mode,
        requestedAt: new Date(),
        lockTimeoutMs,
        category,
        worktreeId: options.worktreeId,
        metadata: options.metadata,
        resolve: (result) => {
          if (request.timeoutHandle) {
            clearTimeout(request.timeoutHandle);
          }
          resolve(result);
        },
      };

      if (waitTimeoutMs > 0) {
        request.timeoutHandle = setTimeout(() => {
          const idx = resource.waitQueue.indexOf(request);
          if (idx !== -1) {
            resource.waitQueue.splice(idx, 1);
            this.emit({ type: 'lock_wait_timeout', agentId, resourceName });
            resolve({
              success: false,
              reason: 'timeout_waiting',
              waitingBehind: resource.locks.map((l) => l.holderAgentId),
            });
          }
        }, waitTimeoutMs);
      }

      resource.waitQueue.push(request);
    });
  }

  private processWaitQueue(resourceName: string): void {
    const resource = this.resources.get(resourceName);
    if (!resource || resource.waitQueue.length === 0) {
      return;
    }

    const processed: PendingLockRequest[] = [];

    for (const request of resource.waitQueue) {
      if (this.canAcquireLock(resource, request.mode)) {
        const lock = this.createLock(
          request.agentId,
          resourceName,
          request.mode,
          request.lockTimeoutMs,
          request.category,
          { worktreeId: request.worktreeId, metadata: request.metadata }
        );
        resource.locks.push(lock);
        this.trackAgentLock(request.agentId, lock.id);
        this.emit({ type: 'lock_acquired', lock });
        request.resolve({ success: true, lock });
        processed.push(request);

        if (request.mode === 'write') {
          break;
        }
      } else if (request.mode === 'write') {
        break;
      }
    }

    for (const req of processed) {
      const idx = resource.waitQueue.indexOf(req);
      if (idx !== -1) {
        resource.waitQueue.splice(idx, 1);
      }
    }
  }

  private expireLocks(): void {
    const now = Date.now();

    for (const [resourceName, resource] of this.resources) {
      const expired = resource.locks.filter((l) => l.expiresAt && l.expiresAt.getTime() <= now);

      for (const lock of expired) {
        const idx = resource.locks.indexOf(lock);
        if (idx !== -1) {
          resource.locks.splice(idx, 1);
          this.untrackAgentLock(lock.holderAgentId, lock.id);
          this.expiredLockCount++;
          this.emit({ type: 'lock_expired', lock });
        }
      }

      if (expired.length > 0) {
        this.processWaitQueue(resourceName);
      }
    }
  }

  private detectDeadlocks(): void {
    const waitGraph = new Map<string, Set<string>>();

    for (const resource of this.resources.values()) {
      const holders = resource.locks.map((l) => l.holderAgentId);
      for (const request of resource.waitQueue) {
        let edges = waitGraph.get(request.agentId);
        if (!edges) {
          edges = new Set();
          waitGraph.set(request.agentId, edges);
        }
        for (const holder of holders) {
          edges.add(holder);
        }
      }
    }

    const visited = new Set<string>();
    const path: string[] = [];

    const dfs = (node: string): string[] | null => {
      if (path.includes(node)) {
        const cycleStart = path.indexOf(node);
        return path.slice(cycleStart);
      }

      if (visited.has(node)) {
        return null;
      }

      visited.add(node);
      path.push(node);

      const edges = waitGraph.get(node);
      if (edges) {
        for (const next of edges) {
          const cycle = dfs(next);
          if (cycle) {
            return cycle;
          }
        }
      }

      path.pop();
      return null;
    };

    for (const agent of waitGraph.keys()) {
      if (!visited.has(agent)) {
        const cycle = dfs(agent);
        if (cycle) {
          this.deadlockCount++;
          this.emit({ type: 'deadlock_detected', cycle });
          this.breakDeadlock(cycle);
          return;
        }
      }
    }
  }

  private breakDeadlock(cycle: string[]): void {
    if (cycle.length === 0) {
      return;
    }

    const victimAgentId = cycle[cycle.length - 1];

    for (const resource of this.resources.values()) {
      const idx = resource.waitQueue.findIndex((r) => r.agentId === victimAgentId);
      if (idx !== -1) {
        const request = resource.waitQueue[idx];
        resource.waitQueue.splice(idx, 1);
        request.resolve({
          success: false,
          reason: 'timeout_waiting',
          waitingBehind: cycle.filter((a) => a !== victimAgentId),
        });
        break;
      }
    }
  }

  private checkResourceExhaustion(): void {
    const blockedAgents: string[] = [];
    const heldResources: string[] = [];

    for (const [resourceName, resource] of this.resources) {
      if (resource.waitQueue.length > 10) {
        for (const req of resource.waitQueue) {
          if (!blockedAgents.includes(req.agentId)) {
            blockedAgents.push(req.agentId);
          }
        }
        if (!heldResources.includes(resourceName)) {
          heldResources.push(resourceName);
        }
      }
    }

    if (blockedAgents.length >= 3 && !this.worktreeCreationPaused) {
      this.pauseWorktreeCreation('High resource contention detected');
      this.emit({ type: 'resources_exhausted', blockedAgents, heldResources });
    } else if (blockedAgents.length === 0 && this.worktreeCreationPaused) {
      this.resumeWorktreeCreation();
    }
  }

  private emit(event: ResourceLockEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }
}
