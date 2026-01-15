/**
 * ABOUTME: Unit tests for the Coordinator message broker.
 * Tests agent registration, message passing, subscriptions,
 * heartbeat monitoring, and event emission.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Coordinator } from '../../src/worktree/coordinator.js';
import type { AgentMessagePayload } from '../../src/worktree/coordinator-types.js';

function createTestPayload(overrides: Partial<AgentMessagePayload> = {}): AgentMessagePayload {
  return {
    category: 'other',
    summary: 'Test discovery',
    details: 'Test details',
    affectedFiles: ['test.ts'],
    ...overrides,
  };
}

describe('Coordinator', () => {
  let coordinator: Coordinator;

  beforeEach(() => {
    coordinator = new Coordinator({
      heartbeatIntervalMs: 1000,
      agentTimeoutMs: 5000,
      maxPendingMessagesPerAgent: 100,
      defaultMessageTtlMs: 60000,
    });
  });

  afterEach(() => {
    coordinator.stop();
  });

  describe('lifecycle', () => {
    test('should start and stop without errors', () => {
      expect(() => coordinator.start()).not.toThrow();
      expect(() => coordinator.stop()).not.toThrow();
    });

    test('should handle multiple start calls gracefully', () => {
      coordinator.start();
      expect(() => coordinator.start()).not.toThrow();
    });

    test('should handle multiple stop calls gracefully', () => {
      coordinator.start();
      coordinator.stop();
      expect(() => coordinator.stop()).not.toThrow();
    });
  });

  describe('agent registration', () => {
    test('should register an agent successfully', () => {
      const agent = coordinator.registerAgent('agent-1', 'Test Agent', 'worktree-1', 'task-1');
      
      expect(agent.id).toBe('agent-1');
      expect(agent.name).toBe('Test Agent');
      expect(agent.worktreeId).toBe('worktree-1');
      expect(agent.taskId).toBe('task-1');
      expect(agent.status).toBe('idle');
    });

    test('should retrieve registered agent', () => {
      coordinator.registerAgent('agent-1', 'Test Agent');
      
      const agent = coordinator.getAgent('agent-1');
      expect(agent).toBeDefined();
      expect(agent?.name).toBe('Test Agent');
    });

    test('should return undefined for non-existent agent', () => {
      const agent = coordinator.getAgent('non-existent');
      expect(agent).toBeUndefined();
    });

    test('should list all registered agents', () => {
      coordinator.registerAgent('agent-1', 'Agent 1');
      coordinator.registerAgent('agent-2', 'Agent 2');
      
      const agents = coordinator.getAllAgents();
      expect(agents.length).toBe(2);
    });

    test('should unregister an agent', () => {
      coordinator.registerAgent('agent-1', 'Test Agent');
      
      const result = coordinator.unregisterAgent('agent-1');
      expect(result).toBe(true);
      
      const agent = coordinator.getAgent('agent-1');
      expect(agent).toBeUndefined();
    });

    test('should return false when unregistering non-existent agent', () => {
      const result = coordinator.unregisterAgent('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('agent status', () => {
    test('should update agent status', () => {
      coordinator.registerAgent('agent-1', 'Test Agent');
      
      const result = coordinator.updateAgentStatus('agent-1', 'working');
      expect(result).toBe(true);
      
      const agent = coordinator.getAgent('agent-1');
      expect(agent?.status).toBe('working');
    });

    test('should return false when updating non-existent agent status', () => {
      const result = coordinator.updateAgentStatus('non-existent', 'working');
      expect(result).toBe(false);
    });
  });

  describe('heartbeat', () => {
    test('should register heartbeat for agent', () => {
      coordinator.registerAgent('agent-1', 'Test Agent');
      
      const result = coordinator.heartbeat('agent-1');
      expect(result).toBe(true);
    });

    test('should return false for heartbeat on non-existent agent', () => {
      const result = coordinator.heartbeat('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('messaging', () => {
    test('should send broadcast message to all agents', () => {
      coordinator.registerAgent('agent-1', 'Agent 1');
      coordinator.registerAgent('agent-2', 'Agent 2');
      
      const result = coordinator.send('agent-1', 'discovery', createTestPayload());
      
      expect(result.success).toBe(true);
      expect(result.recipientCount).toBe(1);
    });

    test('should send direct message to specific agent', () => {
      coordinator.registerAgent('agent-1', 'Agent 1');
      coordinator.registerAgent('agent-2', 'Agent 2');
      
      const result = coordinator.send('agent-1', 'discovery', createTestPayload(), 'agent-2');
      
      expect(result.success).toBe(true);
      expect(result.recipientCount).toBe(1);
    });

    test('should fail when sending to non-existent agent', () => {
      coordinator.registerAgent('agent-1', 'Agent 1');
      
      const result = coordinator.send('agent-1', 'discovery', createTestPayload(), 'non-existent');
      
      expect(result.recipientCount).toBe(0);
    });

    test('should retrieve pending messages for agent', () => {
      coordinator.registerAgent('agent-1', 'Agent 1');
      coordinator.registerAgent('agent-2', 'Agent 2');
      
      coordinator.send('agent-1', 'discovery', createTestPayload());
      
      const messages = coordinator.getPendingMessages('agent-2');
      expect(messages.length).toBe(1);
      expect(messages[0].type).toBe('discovery');
    });

    test('should clear pending messages after retrieval', () => {
      coordinator.registerAgent('agent-1', 'Agent 1');
      coordinator.registerAgent('agent-2', 'Agent 2');
      
      coordinator.send('agent-1', 'discovery', createTestPayload());
      coordinator.getPendingMessages('agent-2');
      
      const messagesAgain = coordinator.getPendingMessages('agent-2');
      expect(messagesAgain.length).toBe(0);
    });
  });

  describe('subscriptions', () => {
    test('should create subscription and return id', () => {
      coordinator.registerAgent('agent-1', 'Test Agent');
      
      const subscriptionId = coordinator.subscribe('agent-1', mock(() => {}));
      
      expect(subscriptionId).toBeDefined();
      expect(typeof subscriptionId).toBe('string');
    });

    test('should unsubscribe successfully', () => {
      coordinator.registerAgent('agent-1', 'Test Agent');
      
      const subscriptionId = coordinator.subscribe('agent-1', mock(() => {}));
      const result = coordinator.unsubscribe(subscriptionId);
      
      expect(result).toBe(true);
    });

    test('should return false when unsubscribing non-existent subscription', () => {
      const result = coordinator.unsubscribe('non-existent');
      expect(result).toBe(false);
    });

    test('should filter by message type', () => {
      coordinator.registerAgent('agent-1', 'Agent 1');
      coordinator.registerAgent('agent-2', 'Agent 2');
      
      const callback = mock(() => {});
      coordinator.subscribe('agent-2', callback, ['discovery']);
      
      coordinator.send('agent-1', 'discovery', createTestPayload());
      
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('event listeners', () => {
    test('should add and remove event listeners', () => {
      const listener = mock(() => {});
      
      coordinator.addEventListener(listener);
      coordinator.removeEventListener(listener);
      
      expect(listener).not.toHaveBeenCalled();
    });

    test('should emit agent_registered event', () => {
      const listener = mock(() => {});
      coordinator.addEventListener(listener);
      
      coordinator.registerAgent('agent-1', 'Test Agent');
      
      expect(listener).toHaveBeenCalled();
    });
  });

  describe('statistics', () => {
    test('should return coordinator stats', () => {
      coordinator.registerAgent('agent-1', 'Agent 1');
      coordinator.updateAgentStatus('agent-1', 'working');
      
      const stats = coordinator.getStats();
      
      expect(stats.totalAgents).toBe(1);
      expect(stats.agentsByStatus.working).toBe(1);
      expect(stats.startedAt).toBeDefined();
    });

    test('should track message counts in stats', () => {
      coordinator.registerAgent('agent-1', 'Agent 1');
      coordinator.registerAgent('agent-2', 'Agent 2');
      
      coordinator.send('agent-1', 'discovery', createTestPayload());
      
      const stats = coordinator.getStats();
      expect(stats.totalMessagesSent).toBe(1);
    });
  });
});

describe('Coordinator - Configuration', () => {
  test('should use default config when not provided', () => {
    const coordinator = new Coordinator();
    coordinator.start();
    
    const stats = coordinator.getStats();
    expect(stats).toBeDefined();
    
    coordinator.stop();
  });
});
