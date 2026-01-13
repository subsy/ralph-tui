/**
 * ABOUTME: Coordinator Process for agent-to-agent communication.
 * Implements a message broker that enables agents working in parallel
 * worktrees to share discoveries and stay synchronized.
 */

import { randomUUID } from 'node:crypto';
import {
  type AgentMessage,
  type AgentMessageType,
  type AgentMessagePayload,
  type AgentStatus,
  type TrackedAgent,
  type SendMessageOptions,
  type SendMessageResult,
  type MessageSubscription,
  type MessageCallback,
  type CoordinatorEvent,
  type CoordinatorEventListener,
  type CoordinatorConfig,
  type CoordinatorStats,
  DEFAULT_COORDINATOR_CONFIG,
} from './coordinator-types.js';

export class Coordinator {
  private readonly config: CoordinatorConfig;
  private readonly agents: Map<string, TrackedAgent> = new Map();
  private readonly subscriptions: Map<string, MessageSubscription> = new Map();
  private readonly listeners: Set<CoordinatorEventListener> = new Set();
  private readonly startedAt: Date;
  private totalMessagesSent = 0;
  private totalMessagesDelivered = 0;
  private totalDeliveryTimeMs = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: Partial<CoordinatorConfig> = {}) {
    this.config = { ...DEFAULT_COORDINATOR_CONFIG, ...config };
    this.startedAt = new Date();
  }

  start(): void {
    if (this.heartbeatTimer) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      this.checkAgentTimeouts();
      this.expireOldMessages();
    }, this.config.heartbeatIntervalMs);
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  registerAgent(id: string, name: string, worktreeId?: string, taskId?: string): TrackedAgent {
    const now = new Date();
    const agent: TrackedAgent = {
      id,
      name,
      status: 'idle',
      worktreeId,
      taskId,
      registeredAt: now,
      lastStatusUpdate: now,
      lastHeartbeat: now,
      pendingMessages: [],
    };

    this.agents.set(id, agent);
    this.emit({ type: 'agent_registered', agent });
    return agent;
  }

  unregisterAgent(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }

    for (const [subId, sub] of this.subscriptions) {
      if (sub.agentId === agentId) {
        this.subscriptions.delete(subId);
      }
    }

    this.agents.delete(agentId);
    this.emit({ type: 'agent_unregistered', agentId });
    return true;
  }

  getAgent(agentId: string): TrackedAgent | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): TrackedAgent[] {
    return Array.from(this.agents.values());
  }

  updateAgentStatus(agentId: string, status: AgentStatus): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }

    const previousStatus = agent.status;
    agent.status = status;
    agent.lastStatusUpdate = new Date();

    this.emit({ type: 'agent_status_changed', agent, previousStatus });
    return true;
  }

  heartbeat(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }

    agent.lastHeartbeat = new Date();
    return true;
  }

  send(
    fromAgent: string,
    type: AgentMessageType,
    payload: AgentMessagePayload,
    toAgent?: string,
    _options: SendMessageOptions = {}
  ): SendMessageResult {
    const startTime = performance.now();

    const message: AgentMessage = {
      id: randomUUID(),
      type,
      fromAgent,
      toAgent,
      timestamp: new Date(),
      payload,
    };

    const recipients = this.getRecipients(fromAgent, toAgent);
    let deliveredCount = 0;

    for (const recipient of recipients) {
      const delivered = this.deliverMessage(message, recipient);
      if (delivered) {
        deliveredCount++;
      }
    }

    const deliveryTimeMs = performance.now() - startTime;
    this.totalMessagesSent++;
    this.totalMessagesDelivered += deliveredCount;
    this.totalDeliveryTimeMs += deliveryTimeMs;

    this.emit({ type: 'message_sent', message, recipientCount: deliveredCount });

    if (!toAgent) {
      this.emit({ type: 'broadcast', message });
    }

    return {
      success: deliveredCount > 0 || !toAgent,
      message,
      recipientCount: deliveredCount,
      deliveryTimeMs,
    };
  }

  subscribe(
    agentId: string,
    callback: MessageCallback,
    typeFilter: AgentMessageType[] = [],
    fromAgentFilter: string[] = []
  ): string {
    const subscription: MessageSubscription = {
      id: randomUUID(),
      agentId,
      typeFilter,
      fromAgentFilter,
      callback,
      createdAt: new Date(),
    };

    this.subscriptions.set(subscription.id, subscription);
    return subscription.id;
  }

  unsubscribe(subscriptionId: string): boolean {
    return this.subscriptions.delete(subscriptionId);
  }

  addEventListener(listener: CoordinatorEventListener): void {
    this.listeners.add(listener);
  }

  removeEventListener(listener: CoordinatorEventListener): void {
    this.listeners.delete(listener);
  }

  getStats(): CoordinatorStats {
    const agentsByStatus: Record<AgentStatus, number> = {
      idle: 0,
      working: 0,
      blocked: 0,
      complete: 0,
      failed: 0,
    };

    for (const agent of this.agents.values()) {
      agentsByStatus[agent.status]++;
    }

    return {
      totalAgents: this.agents.size,
      agentsByStatus,
      totalMessagesSent: this.totalMessagesSent,
      totalMessagesDelivered: this.totalMessagesDelivered,
      avgDeliveryTimeMs:
        this.totalMessagesSent > 0 ? this.totalDeliveryTimeMs / this.totalMessagesSent : 0,
      activeSubscriptions: this.subscriptions.size,
      startedAt: this.startedAt,
    };
  }

  getPendingMessages(agentId: string): AgentMessage[] {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return [];
    }

    const messages = [...agent.pendingMessages];
    agent.pendingMessages = [];
    return messages;
  }

  private getRecipients(fromAgent: string, toAgent?: string): TrackedAgent[] {
    if (toAgent) {
      const agent = this.agents.get(toAgent);
      return agent ? [agent] : [];
    }

    return Array.from(this.agents.values()).filter((a) => a.id !== fromAgent);
  }

  private deliverMessage(message: AgentMessage, recipient: TrackedAgent): boolean {
    if (recipient.pendingMessages.length >= this.config.maxPendingMessagesPerAgent) {
      return false;
    }

    recipient.pendingMessages.push(message);

    const matchingSubs = Array.from(this.subscriptions.values()).filter(
      (sub) =>
        sub.agentId === recipient.id &&
        this.matchesFilters(message, sub.typeFilter, sub.fromAgentFilter)
    );

    for (const sub of matchingSubs) {
      try {
        const result = sub.callback(message);
        if (result instanceof Promise) {
          result.catch(() => {});
        }
      } catch {
      }
    }

    this.emit({ type: 'message_delivered', message, toAgent: recipient.id });
    return true;
  }

  private matchesFilters(
    message: AgentMessage,
    typeFilter: AgentMessageType[],
    fromAgentFilter: string[]
  ): boolean {
    if (typeFilter.length > 0 && !typeFilter.includes(message.type)) {
      return false;
    }

    if (fromAgentFilter.length > 0 && !fromAgentFilter.includes(message.fromAgent)) {
      return false;
    }

    return true;
  }

  private checkAgentTimeouts(): void {
    const now = Date.now();
    const timeoutThreshold = this.config.agentTimeoutMs;

    for (const agent of this.agents.values()) {
      const timeSinceHeartbeat = now - agent.lastHeartbeat.getTime();
      if (timeSinceHeartbeat > timeoutThreshold && agent.status === 'working') {
        const previousStatus = agent.status;
        agent.status = 'blocked';
        agent.lastStatusUpdate = new Date();
        this.emit({ type: 'agent_status_changed', agent, previousStatus });
        this.emit({ type: 'agent_timeout', agent });
      }
    }
  }

  private expireOldMessages(): void {
    const now = Date.now();
    const ttl = this.config.defaultMessageTtlMs;

    for (const agent of this.agents.values()) {
      const expired: AgentMessage[] = [];
      agent.pendingMessages = agent.pendingMessages.filter((msg) => {
        const age = now - msg.timestamp.getTime();
        if (age > ttl) {
          expired.push(msg);
          return false;
        }
        return true;
      });

      for (const msg of expired) {
        this.emit({ type: 'message_expired', message: msg });
      }
    }
  }

  private emit(event: CoordinatorEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
      }
    }
  }
}
