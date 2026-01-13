/**
 * ABOUTME: Agent Broadcast Manager for real-time discovery sharing.
 * Enables agents working in parallel to broadcast bugs, patterns,
 * and blockers to all other active agents for coordinated work.
 */

import { randomUUID } from 'node:crypto';
import {
  type Broadcast,
  type BroadcastCategory,
  type BroadcastConfig,
  type BroadcastEvent,
  type BroadcastEventListener,
  type BroadcastPayload,
  type BroadcastPriority,
  type BroadcastStats,
  type BroadcastSubscription,
  type ConsumeBroadcastsOptions,
  type ConsumeBroadcastsResult,
  type ConsumedBroadcast,
  type CreateBroadcastOptions,
  type CreateBroadcastResult,
  DEFAULT_BROADCAST_CONFIG,
} from './broadcast-types.js';

const PRIORITY_ORDER: Record<BroadcastPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
};

interface AgentContext {
  id: string;
  name: string;
  taskId?: string;
  workingFiles?: string[];
}

export class BroadcastManager {
  private readonly config: BroadcastConfig;
  private readonly broadcasts: Map<string, Broadcast> = new Map();
  private readonly subscriptions: Map<string, BroadcastSubscription> = new Map();
  private readonly listeners: Set<BroadcastEventListener> = new Set();
  private readonly registeredAgents: Map<string, AgentContext> = new Map();
  private readonly startedAt: Date;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  private totalCreated = 0;
  private totalConsumed = 0;
  private totalAcknowledged = 0;
  private firstConsumptionTimes: number[] = [];

  constructor(config: Partial<BroadcastConfig> = {}) {
    this.config = { ...DEFAULT_BROADCAST_CONFIG, ...config };
    this.startedAt = new Date();
  }

  start(): void {
    if (this.cleanupTimer) {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredBroadcasts();
    }, this.config.cleanupIntervalMs);
  }

  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  getConfig(): BroadcastConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<BroadcastConfig>): void {
    Object.assign(this.config, updates);
    this.emit({ type: 'config_changed', config: { ...this.config } });
  }

  registerAgent(id: string, name: string, taskId?: string, workingFiles?: string[]): void {
    this.registeredAgents.set(id, { id, name, taskId, workingFiles });
  }

  unregisterAgent(agentId: string): void {
    this.registeredAgents.delete(agentId);

    for (const [subId, sub] of this.subscriptions) {
      if (sub.agentId === agentId) {
        this.subscriptions.delete(subId);
      }
    }
  }

  updateAgentContext(agentId: string, taskId?: string, workingFiles?: string[]): void {
    const agent = this.registeredAgents.get(agentId);
    if (agent) {
      agent.taskId = taskId;
      agent.workingFiles = workingFiles;
    }
  }

  broadcast(agentId: string, options: CreateBroadcastOptions): CreateBroadcastResult {
    if (!this.config.enabled) {
      return { success: false, disabled: true };
    }

    const isCategoryEnabled = this.config.enabledCategories.includes(options.category);
    const isCustomCategory =
      this.config.customCategories?.includes(options.category) ?? false;

    if (!isCategoryEnabled && !isCustomCategory) {
      return { success: false, filtered: true };
    }

    const agent = this.registeredAgents.get(agentId);
    if (!agent) {
      return { success: false, error: `Agent ${agentId} not registered` };
    }

    const payload: BroadcastPayload = {
      category: options.category,
      summary: options.summary,
      details: options.details,
      affectedFiles: options.affectedFiles,
      priority: options.priority ?? 'normal',
      codeSnippets: options.codeSnippets,
      suggestedActions: options.suggestedActions,
      metadata: options.metadata,
    };

    const broadcast: Broadcast = {
      id: randomUUID(),
      fromAgent: agentId,
      fromAgentName: agent.name,
      taskId: agent.taskId,
      timestamp: new Date(),
      payload,
      consumedBy: [],
      acknowledgedBy: [],
      superseded: false,
    };

    this.broadcasts.set(broadcast.id, broadcast);
    this.totalCreated++;

    this.enforceMaxHistory();

    this.emit({ type: 'broadcast_created', broadcast });

    this.notifySubscribers(broadcast);

    return { success: true, broadcast };
  }

  consume(agentId: string, options: ConsumeBroadcastsOptions = {}): ConsumeBroadcastsResult {
    const agent = this.registeredAgents.get(agentId);
    const workingFiles = agent?.workingFiles ?? [];

    const markConsumed = options.markConsumed ?? this.config.autoConsume;

    let broadcasts = Array.from(this.broadcasts.values()).filter((b) => {
      if (b.superseded) return false;
      if (b.fromAgent === agentId) return false;
      return true;
    });

    if (options.categories && options.categories.length > 0) {
      broadcasts = broadcasts.filter((b) => options.categories!.includes(b.payload.category));
    }

    if (options.minPriority) {
      const minLevel = PRIORITY_ORDER[options.minPriority];
      broadcasts = broadcasts.filter((b) => PRIORITY_ORDER[b.payload.priority] >= minLevel);
    }

    if (options.affectingFiles && options.affectingFiles.length > 0) {
      broadcasts = broadcasts.filter((b) =>
        b.payload.affectedFiles.some((f) => options.affectingFiles!.includes(f))
      );
    }

    if (options.since) {
      broadcasts = broadcasts.filter((b) => b.timestamp >= options.since!);
    }

    const totalAvailable = broadcasts.length;

    const consumed: ConsumedBroadcast[] = broadcasts.map((b) => {
      const relevanceScore = this.calculateRelevance(b, workingFiles);
      const requiresAction = this.determineRequiresAction(b, workingFiles);
      const suggestedActionType = this.suggestAction(b, workingFiles, requiresAction);

      return {
        ...b,
        requiresAction,
        suggestedActionType,
        relevanceScore,
      };
    });

    consumed.sort((a, b) => {
      if (a.requiresAction !== b.requiresAction) {
        return a.requiresAction ? -1 : 1;
      }

      const aPriority = PRIORITY_ORDER[a.payload.priority];
      const bPriority = PRIORITY_ORDER[b.payload.priority];
      if (aPriority !== bPriority) {
        return bPriority - aPriority;
      }

      return b.relevanceScore - a.relevanceScore;
    });

    const limited = options.limit ? consumed.slice(0, options.limit) : consumed;

    if (markConsumed) {
      for (const bc of limited) {
        if (!bc.consumedBy.includes(agentId)) {
          bc.consumedBy.push(agentId);
          this.totalConsumed++;

          if (bc.consumedBy.length === 1) {
            const timeToConsumption = Date.now() - bc.timestamp.getTime();
            this.firstConsumptionTimes.push(timeToConsumption);
          }

          this.emit({ type: 'broadcast_consumed', broadcastId: bc.id, agentId });
        }
      }
    }

    const requireingAction = limited.filter((b) => b.requiresAction).length;
    const criticalCount = limited.filter((b) => b.payload.priority === 'critical').length;

    return {
      broadcasts: limited,
      totalAvailable,
      requireingAction,
      criticalCount,
    };
  }

  acknowledge(agentId: string, broadcastId: string): boolean {
    const broadcast = this.broadcasts.get(broadcastId);
    if (!broadcast) {
      return false;
    }

    if (!broadcast.acknowledgedBy.includes(agentId)) {
      broadcast.acknowledgedBy.push(agentId);
      this.totalAcknowledged++;
      this.emit({ type: 'broadcast_acknowledged', broadcastId, agentId });
    }

    return true;
  }

  supersede(broadcastId: string, newBroadcastId: string): boolean {
    const broadcast = this.broadcasts.get(broadcastId);
    if (!broadcast) {
      return false;
    }

    broadcast.superseded = true;
    broadcast.supersededBy = newBroadcastId;
    this.emit({ type: 'broadcast_superseded', broadcastId, supersededBy: newBroadcastId });

    return true;
  }

  subscribe(
    agentId: string,
    callback: (broadcast: Broadcast) => void | Promise<void>,
    options: {
      categoryFilter?: (BroadcastCategory | string)[];
      minPriority?: BroadcastPriority;
      fileFilter?: string[];
    } = {}
  ): string {
    const subscription: BroadcastSubscription = {
      id: randomUUID(),
      agentId,
      categoryFilter: options.categoryFilter ?? [],
      minPriority: options.minPriority,
      fileFilter: options.fileFilter,
      callback,
      createdAt: new Date(),
    };

    this.subscriptions.set(subscription.id, subscription);
    return subscription.id;
  }

  unsubscribe(subscriptionId: string): boolean {
    return this.subscriptions.delete(subscriptionId);
  }

  addEventListener(listener: BroadcastEventListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(listener: BroadcastEventListener): void {
    this.listeners.delete(listener);
  }

  getStats(): BroadcastStats {
    const byCategory: Record<string, number> = {};
    const byPriority: Record<BroadcastPriority, number> = {
      low: 0,
      normal: 0,
      high: 0,
      critical: 0,
    };

    for (const broadcast of this.broadcasts.values()) {
      const cat = broadcast.payload.category;
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      byPriority[broadcast.payload.priority]++;
    }

    const avgTimeToFirstConsumptionMs =
      this.firstConsumptionTimes.length > 0
        ? this.firstConsumptionTimes.reduce((a, b) => a + b, 0) / this.firstConsumptionTimes.length
        : 0;

    return {
      enabled: this.config.enabled,
      totalCreated: this.totalCreated,
      totalConsumed: this.totalConsumed,
      totalAcknowledged: this.totalAcknowledged,
      activeBroadcasts: this.broadcasts.size,
      byCategory,
      byPriority,
      avgTimeToFirstConsumptionMs,
      startedAt: this.startedAt,
    };
  }

  getBroadcast(id: string): Broadcast | undefined {
    return this.broadcasts.get(id);
  }

  getAllBroadcasts(): Broadcast[] {
    return Array.from(this.broadcasts.values());
  }

  getUnacknowledgedCritical(agentId: string): Broadcast[] {
    return Array.from(this.broadcasts.values()).filter(
      (b) =>
        b.payload.priority === 'critical' &&
        !b.superseded &&
        !b.acknowledgedBy.includes(agentId) &&
        b.fromAgent !== agentId
    );
  }

  private calculateRelevance(broadcast: Broadcast, workingFiles: string[]): number {
    let score = 0;

    score += PRIORITY_ORDER[broadcast.payload.priority] * 0.25;

    if (workingFiles.length > 0 && broadcast.payload.affectedFiles.length > 0) {
      const overlap = broadcast.payload.affectedFiles.filter((f) =>
        workingFiles.some((wf) => wf === f || f.includes(wf) || wf.includes(f))
      );
      const overlapRatio =
        overlap.length / Math.max(workingFiles.length, broadcast.payload.affectedFiles.length);
      score += overlapRatio * 0.5;
    }

    const category = broadcast.payload.category;
    if (category === 'blocker' || category === 'bug') {
      score += 0.25;
    }

    return Math.min(1, score);
  }

  private determineRequiresAction(broadcast: Broadcast, workingFiles: string[]): boolean {
    if (broadcast.payload.priority === 'critical') {
      return true;
    }

    if (broadcast.payload.category === 'blocker') {
      return true;
    }

    if (workingFiles.length > 0) {
      const hasFileOverlap = broadcast.payload.affectedFiles.some((f) =>
        workingFiles.some((wf) => wf === f || f.includes(wf) || wf.includes(f))
      );
      if (hasFileOverlap) {
        return true;
      }
    }

    return false;
  }

  private suggestAction(
    broadcast: Broadcast,
    workingFiles: string[],
    requiresAction: boolean
  ): ConsumedBroadcast['suggestedActionType'] {
    if (!requiresAction) {
      return 'continue';
    }

    if (broadcast.payload.category === 'blocker') {
      return 'stop';
    }

    if (broadcast.payload.priority === 'critical') {
      if (this.config.requireAckForCritical) {
        return 'acknowledge';
      }
      return 'review';
    }

    const hasFileOverlap =
      workingFiles.length > 0 &&
      broadcast.payload.affectedFiles.some((f) =>
        workingFiles.some((wf) => wf === f || f.includes(wf) || wf.includes(f))
      );

    if (hasFileOverlap) {
      return 'adjust';
    }

    return 'review';
  }

  private notifySubscribers(broadcast: Broadcast): void {
    for (const subscription of this.subscriptions.values()) {
      if (subscription.agentId === broadcast.fromAgent) {
        continue;
      }

      if (
        subscription.categoryFilter.length > 0 &&
        !subscription.categoryFilter.includes(broadcast.payload.category)
      ) {
        continue;
      }

      if (subscription.minPriority) {
        const minLevel = PRIORITY_ORDER[subscription.minPriority];
        if (PRIORITY_ORDER[broadcast.payload.priority] < minLevel) {
          continue;
        }
      }

      if (subscription.fileFilter && subscription.fileFilter.length > 0) {
        const hasOverlap = broadcast.payload.affectedFiles.some((f) =>
          subscription.fileFilter!.some((ff) => f === ff || f.includes(ff) || ff.includes(f))
        );
        if (!hasOverlap) {
          continue;
        }
      }

      try {
        const result = subscription.callback(broadcast);
        if (result instanceof Promise) {
          result.catch(() => {});
        }
      } catch {
      }
    }
  }

  private enforceMaxHistory(): void {
    if (this.broadcasts.size <= this.config.maxBroadcastHistory) {
      return;
    }

    const sorted = Array.from(this.broadcasts.values()).sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );

    const toRemove = sorted.slice(0, sorted.length - this.config.maxBroadcastHistory);
    for (const broadcast of toRemove) {
      this.broadcasts.delete(broadcast.id);
    }
  }

  private cleanupExpiredBroadcasts(): void {
    const now = Date.now();
    const ttl = this.config.broadcastTtlMs;

    for (const [id, broadcast] of this.broadcasts) {
      const age = now - broadcast.timestamp.getTime();
      if (age > ttl) {
        this.broadcasts.delete(id);
        this.emit({ type: 'broadcast_expired', broadcastId: id });
      }
    }
  }

  private emit(event: BroadcastEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
      }
    }
  }
}
