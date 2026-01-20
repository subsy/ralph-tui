/**
 * ABOUTME: Tests for remote orchestration - protocol commands, state display, reconnection.
 * Tests the remote orchestration handlers and client behavior.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import type {
  OrchestrateStartMessage,
  OrchestrateStartResponseMessage,
  OrchestrateStatusMessage,
  OrchestrateStatusResponseMessage,
  OrchestratePauseMessage,
  OrchestrateResumeMessage,
  OperationResultMessage,
  OrchestratorEventMessage,
  RemoteOrchestratorState,
  WSMessage,
} from '../../src/remote/types.js';
import type { OrchestratorEvent, WorkerState } from '../../src/orchestrator/types.js';

// ============================================================================
// Remote Protocol Command Tests
// ============================================================================

describe('Remote Protocol Commands', () => {
  describe('orchestrate:start message', () => {
    test('has correct structure with required fields', () => {
      const message: OrchestrateStartMessage = {
        type: 'orchestrate:start',
        id: 'test-id',
        timestamp: new Date().toISOString(),
        prdPath: '/path/to/prd.json',
        maxWorkers: 3,
        headless: true,
      };

      expect(message.type).toBe('orchestrate:start');
      expect(message.prdPath).toBe('/path/to/prd.json');
      expect(message.maxWorkers).toBe(3);
      expect(message.headless).toBe(true);
    });

    test('allows optional maxWorkers and headless', () => {
      const message: OrchestrateStartMessage = {
        type: 'orchestrate:start',
        id: 'test-id',
        timestamp: new Date().toISOString(),
        prdPath: '/path/to/prd.json',
      };

      expect(message.maxWorkers).toBeUndefined();
      expect(message.headless).toBeUndefined();
    });
  });

  describe('orchestrate:start_response message', () => {
    test('success response has correct structure', () => {
      const response: OrchestrateStartResponseMessage = {
        type: 'orchestrate:start_response',
        id: 'test-id',
        timestamp: new Date().toISOString(),
        success: true,
      };

      expect(response.type).toBe('orchestrate:start_response');
      expect(response.success).toBe(true);
      expect(response.error).toBeUndefined();
    });

    test('error response includes error message', () => {
      const response: OrchestrateStartResponseMessage = {
        type: 'orchestrate:start_response',
        id: 'test-id',
        timestamp: new Date().toISOString(),
        success: false,
        error: 'Orchestration already in progress',
      };

      expect(response.success).toBe(false);
      expect(response.error).toBe('Orchestration already in progress');
    });
  });

  describe('orchestrate:status message', () => {
    test('has correct structure', () => {
      const message: OrchestrateStatusMessage = {
        type: 'orchestrate:status',
        id: 'test-id',
        timestamp: new Date().toISOString(),
      };

      expect(message.type).toBe('orchestrate:status');
    });
  });

  describe('orchestrate:status_response message', () => {
    test('idle state has correct structure', () => {
      const state: RemoteOrchestratorState = {
        status: 'idle',
        workers: [],
        completedTasks: 0,
        totalTasks: 0,
      };

      const response: OrchestrateStatusResponseMessage = {
        type: 'orchestrate:status_response',
        id: 'test-id',
        timestamp: new Date().toISOString(),
        state,
      };

      expect(response.type).toBe('orchestrate:status_response');
      expect(response.state.status).toBe('idle');
    });

    test('running state includes phase and worker info', () => {
      const workers: WorkerState[] = [
        { id: 'worker-1', range: { from: 'US-001', to: 'US-002' }, status: 'running', progress: 50 },
        { id: 'worker-2', range: { from: 'US-003', to: 'US-004' }, status: 'running', progress: 25 },
      ];

      const state: RemoteOrchestratorState = {
        status: 'running',
        currentPhase: 'Phase 1',
        currentPhaseIndex: 0,
        totalPhases: 2,
        workers,
        completedTasks: 0,
        totalTasks: 4,
        startedAt: new Date().toISOString(),
      };

      const response: OrchestrateStatusResponseMessage = {
        type: 'orchestrate:status_response',
        id: 'test-id',
        timestamp: new Date().toISOString(),
        state,
      };

      expect(response.state.status).toBe('running');
      expect(response.state.currentPhase).toBe('Phase 1');
      expect(response.state.currentPhaseIndex).toBe(0);
      expect(response.state.totalPhases).toBe(2);
      expect(response.state.workers).toHaveLength(2);
      expect(response.state.startedAt).toBeDefined();
    });
  });

  describe('orchestrate:pause message', () => {
    test('has correct structure', () => {
      const message: OrchestratePauseMessage = {
        type: 'orchestrate:pause',
        id: 'test-id',
        timestamp: new Date().toISOString(),
      };

      expect(message.type).toBe('orchestrate:pause');
    });
  });

  describe('orchestrate:resume message', () => {
    test('has correct structure', () => {
      const message: OrchestrateResumeMessage = {
        type: 'orchestrate:resume',
        id: 'test-id',
        timestamp: new Date().toISOString(),
      };

      expect(message.type).toBe('orchestrate:resume');
    });
  });

  describe('operation_result for orchestration', () => {
    test('pause success response', () => {
      const response: OperationResultMessage = {
        type: 'operation_result',
        id: 'test-id',
        timestamp: new Date().toISOString(),
        operation: 'orchestrate:pause',
        success: true,
      };

      expect(response.operation).toBe('orchestrate:pause');
      expect(response.success).toBe(true);
    });

    test('pause error response', () => {
      const response: OperationResultMessage = {
        type: 'operation_result',
        id: 'test-id',
        timestamp: new Date().toISOString(),
        operation: 'orchestrate:pause',
        success: false,
        error: 'No orchestration running',
      };

      expect(response.operation).toBe('orchestrate:pause');
      expect(response.success).toBe(false);
      expect(response.error).toBe('No orchestration running');
    });

    test('resume success response', () => {
      const response: OperationResultMessage = {
        type: 'operation_result',
        id: 'test-id',
        timestamp: new Date().toISOString(),
        operation: 'orchestrate:resume',
        success: true,
      };

      expect(response.operation).toBe('orchestrate:resume');
      expect(response.success).toBe(true);
    });

    test('resume error response', () => {
      const response: OperationResultMessage = {
        type: 'operation_result',
        id: 'test-id',
        timestamp: new Date().toISOString(),
        operation: 'orchestrate:resume',
        success: false,
        error: 'Orchestration not paused',
      };

      expect(response.operation).toBe('orchestrate:resume');
      expect(response.success).toBe(false);
      expect(response.error).toBe('Orchestration not paused');
    });
  });
});

// ============================================================================
// Orchestrator Event Tests
// ============================================================================

describe('Orchestrator Events', () => {
  describe('orchestrator_event message', () => {
    test('wraps worker:started event correctly', () => {
      const event: OrchestratorEvent = {
        type: 'worker:started',
        workerId: 'worker-1',
        range: { from: 'US-001', to: 'US-002' },
      };

      const message: OrchestratorEventMessage = {
        type: 'orchestrator_event',
        id: 'event-id',
        timestamp: new Date().toISOString(),
        event,
      };

      expect(message.type).toBe('orchestrator_event');
      expect(message.event.type).toBe('worker:started');
    });

    test('wraps worker:progress event correctly', () => {
      const event: OrchestratorEvent = {
        type: 'worker:progress',
        workerId: 'worker-1',
        progress: 75,
        currentTaskId: 'US-001',
      };

      const message: OrchestratorEventMessage = {
        type: 'orchestrator_event',
        id: 'event-id',
        timestamp: new Date().toISOString(),
        event,
      };

      expect(message.event.type).toBe('worker:progress');
      if (message.event.type === 'worker:progress') {
        expect(message.event.progress).toBe(75);
        expect(message.event.currentTaskId).toBe('US-001');
      }
    });

    test('wraps worker:completed event correctly', () => {
      const event: OrchestratorEvent = {
        type: 'worker:completed',
        workerId: 'worker-1',
      };

      const message: OrchestratorEventMessage = {
        type: 'orchestrator_event',
        id: 'event-id',
        timestamp: new Date().toISOString(),
        event,
      };

      expect(message.event.type).toBe('worker:completed');
    });

    test('wraps worker:failed event correctly', () => {
      const event: OrchestratorEvent = {
        type: 'worker:failed',
        workerId: 'worker-1',
        error: 'Process exited with code 1',
      };

      const message: OrchestratorEventMessage = {
        type: 'orchestrator_event',
        id: 'event-id',
        timestamp: new Date().toISOString(),
        event,
      };

      expect(message.event.type).toBe('worker:failed');
      if (message.event.type === 'worker:failed') {
        expect(message.event.error).toBe('Process exited with code 1');
      }
    });

    test('wraps phase:started event correctly', () => {
      const event: OrchestratorEvent = {
        type: 'phase:started',
        phaseName: 'Phase 1',
        phaseIndex: 0,
        totalPhases: 3,
      };

      const message: OrchestratorEventMessage = {
        type: 'orchestrator_event',
        id: 'event-id',
        timestamp: new Date().toISOString(),
        event,
      };

      expect(message.event.type).toBe('phase:started');
      if (message.event.type === 'phase:started') {
        expect(message.event.phaseName).toBe('Phase 1');
        expect(message.event.totalPhases).toBe(3);
      }
    });

    test('wraps phase:completed event correctly', () => {
      const event: OrchestratorEvent = {
        type: 'phase:completed',
        phaseName: 'Phase 1',
        phaseIndex: 0,
      };

      const message: OrchestratorEventMessage = {
        type: 'orchestrator_event',
        id: 'event-id',
        timestamp: new Date().toISOString(),
        event,
      };

      expect(message.event.type).toBe('phase:completed');
    });

    test('wraps orchestration:completed event correctly', () => {
      const event: OrchestratorEvent = {
        type: 'orchestration:completed',
        totalTasks: 10,
        completedTasks: 10,
      };

      const message: OrchestratorEventMessage = {
        type: 'orchestrator_event',
        id: 'event-id',
        timestamp: new Date().toISOString(),
        event,
      };

      expect(message.event.type).toBe('orchestration:completed');
      if (message.event.type === 'orchestration:completed') {
        expect(message.event.totalTasks).toBe(10);
        expect(message.event.completedTasks).toBe(10);
      }
    });
  });
});

// ============================================================================
// Remote State Display Tests
// ============================================================================

describe('Remote Orchestrator State Display', () => {
  describe('RemoteOrchestratorState', () => {
    test('all status values are valid', () => {
      const validStatuses = ['idle', 'running', 'paused', 'completed', 'failed'];

      validStatuses.forEach((status) => {
        const state: RemoteOrchestratorState = {
          status: status as RemoteOrchestratorState['status'],
          workers: [],
          completedTasks: 0,
          totalTasks: 0,
        };
        expect(validStatuses).toContain(state.status);
      });
    });

    test('workers array contains proper WorkerState objects', () => {
      const workers: WorkerState[] = [
        {
          id: 'worker-1',
          range: { from: 'US-001', to: 'US-003' },
          status: 'running',
          progress: 33,
          currentTaskId: 'US-002',
        },
        {
          id: 'worker-2',
          range: { from: 'US-004', to: 'US-006' },
          status: 'completed',
          progress: 100,
        },
        {
          id: 'worker-3',
          range: { from: 'US-007', to: 'US-009' },
          status: 'failed',
          progress: 50,
          error: 'Task failed',
        },
      ];

      const state: RemoteOrchestratorState = {
        status: 'running',
        workers,
        completedTasks: 3,
        totalTasks: 9,
      };

      expect(state.workers).toHaveLength(3);
      expect(state.workers[0]?.status).toBe('running');
      expect(state.workers[1]?.status).toBe('completed');
      expect(state.workers[2]?.status).toBe('failed');
      expect(state.workers[2]?.error).toBe('Task failed');
    });

    test('calculates correct completion percentage', () => {
      const state: RemoteOrchestratorState = {
        status: 'running',
        workers: [],
        completedTasks: 7,
        totalTasks: 10,
      };

      const percentage = state.totalTasks > 0
        ? Math.round((state.completedTasks / state.totalTasks) * 100)
        : 0;

      expect(percentage).toBe(70);
    });

    test('handles zero total tasks', () => {
      const state: RemoteOrchestratorState = {
        status: 'idle',
        workers: [],
        completedTasks: 0,
        totalTasks: 0,
      };

      const percentage = state.totalTasks > 0
        ? Math.round((state.completedTasks / state.totalTasks) * 100)
        : 0;

      expect(percentage).toBe(0);
    });
  });
});

// ============================================================================
// Remote Orchestrator Client Tests
// ============================================================================

describe('RemoteOrchestratorClient', () => {
  let mockWebSocket: {
    send: ReturnType<typeof mock>;
    close: ReturnType<typeof mock>;
    onopen: (() => void) | null;
    onmessage: ((event: { data: string }) => void) | null;
    onerror: ((error: Error) => void) | null;
    onclose: (() => void) | null;
  };

  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    mockWebSocket = {
      send: mock(() => {}),
      close: mock(() => {}),
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    };

    originalWebSocket = globalThis.WebSocket;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = mock(() => mockWebSocket);
  });

  afterEach(() => {
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
  });

  describe('connection lifecycle', () => {
    test('client connects and authenticates', async () => {
      const { RemoteOrchestratorClient } = await import(
        '../../src/commands/remote-orchestrator-client.js'
      );

      const client = new RemoteOrchestratorClient('localhost', 7890, 'test-token', true);

      const connectPromise = client.connect();

      // Simulate connection open
      mockWebSocket.onopen?.();

      // Get auth message
      const authCall = (mockWebSocket.send as ReturnType<typeof mock>).mock.calls[0];
      expect(authCall).toBeDefined();
      const authMessage = JSON.parse(authCall[0] as string) as WSMessage;
      expect(authMessage.type).toBe('auth');

      // Simulate auth success
      const authResponse = {
        type: 'auth_response',
        id: authMessage.id,
        timestamp: new Date().toISOString(),
        success: true,
        connectionToken: 'conn-token',
      };
      mockWebSocket.onmessage?.({ data: JSON.stringify(authResponse) });

      await connectPromise;
    });

    test('client disconnects cleanly', async () => {
      const { RemoteOrchestratorClient } = await import(
        '../../src/commands/remote-orchestrator-client.js'
      );

      const client = new RemoteOrchestratorClient('localhost', 7890, 'test-token', true);

      const connectPromise = client.connect();
      mockWebSocket.onopen?.();

      const authCall = (mockWebSocket.send as ReturnType<typeof mock>).mock.calls[0];
      const authMessage = JSON.parse(authCall[0] as string) as WSMessage;

      mockWebSocket.onmessage?.({
        data: JSON.stringify({
          type: 'auth_response',
          id: authMessage.id,
          timestamp: new Date().toISOString(),
          success: true,
        }),
      });

      await connectPromise;

      client.disconnect();
      expect(mockWebSocket.close).toHaveBeenCalled();
    });
  });

  describe('orchestration handling', () => {
    test('handles orchestrate:start_response success', async () => {
      const { RemoteOrchestratorClient } = await import(
        '../../src/commands/remote-orchestrator-client.js'
      );

      const client = new RemoteOrchestratorClient('localhost', 7890, 'test-token', true);

      const connectPromise = client.connect();
      mockWebSocket.onopen?.();

      const authCall = (mockWebSocket.send as ReturnType<typeof mock>).mock.calls[0];
      const authMessage = JSON.parse(authCall[0] as string) as WSMessage;

      mockWebSocket.onmessage?.({
        data: JSON.stringify({
          type: 'auth_response',
          id: authMessage.id,
          timestamp: new Date().toISOString(),
          success: true,
        }),
      });

      await connectPromise;

      // Start orchestration (don't await, we'll handle events manually)
      const orchestrationPromise = client.runOrchestration('/path/to/prd.json', 3);

      // Wait a tick for the subscribe to be sent
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate subscribe response
      const subscribeCall = (mockWebSocket.send as ReturnType<typeof mock>).mock.calls[1];
      if (subscribeCall) {
        const subscribeMessage = JSON.parse(subscribeCall[0] as string) as WSMessage;
        mockWebSocket.onmessage?.({
          data: JSON.stringify({
            type: 'operation_result',
            id: subscribeMessage.id,
            timestamp: new Date().toISOString(),
            operation: 'subscribe',
            success: true,
          }),
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate start response
      mockWebSocket.onmessage?.({
        data: JSON.stringify({
          type: 'orchestrate:start_response',
          id: 'start-id',
          timestamp: new Date().toISOString(),
          success: true,
        }),
      });

      // Simulate orchestration completed
      mockWebSocket.onmessage?.({
        data: JSON.stringify({
          type: 'orchestrator_event',
          id: 'event-id',
          timestamp: new Date().toISOString(),
          event: {
            type: 'orchestration:completed',
            totalTasks: 5,
            completedTasks: 5,
          },
        }),
      });

      const result = await orchestrationPromise;
      expect(result.success).toBe(true);
      expect(result.completedTasks).toBe(5);
      expect(result.totalTasks).toBe(5);
    });

    test('handles orchestrate:start_response failure', async () => {
      const { RemoteOrchestratorClient } = await import(
        '../../src/commands/remote-orchestrator-client.js'
      );

      const client = new RemoteOrchestratorClient('localhost', 7890, 'test-token', true);

      const connectPromise = client.connect();
      mockWebSocket.onopen?.();

      const authCall = (mockWebSocket.send as ReturnType<typeof mock>).mock.calls[0];
      const authMessage = JSON.parse(authCall[0] as string) as WSMessage;

      mockWebSocket.onmessage?.({
        data: JSON.stringify({
          type: 'auth_response',
          id: authMessage.id,
          timestamp: new Date().toISOString(),
          success: true,
        }),
      });

      await connectPromise;

      const orchestrationPromise = client.runOrchestration('/path/to/prd.json', 3);

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate subscribe response
      const subscribeCall = (mockWebSocket.send as ReturnType<typeof mock>).mock.calls[1];
      if (subscribeCall) {
        const subscribeMessage = JSON.parse(subscribeCall[0] as string) as WSMessage;
        mockWebSocket.onmessage?.({
          data: JSON.stringify({
            type: 'operation_result',
            id: subscribeMessage.id,
            timestamp: new Date().toISOString(),
            operation: 'subscribe',
            success: true,
          }),
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate start failure
      mockWebSocket.onmessage?.({
        data: JSON.stringify({
          type: 'orchestrate:start_response',
          id: 'start-id',
          timestamp: new Date().toISOString(),
          success: false,
          error: 'PRD file not found',
        }),
      });

      const result = await orchestrationPromise;
      expect(result.success).toBe(false);
      expect(result.error).toBe('PRD file not found');
    });
  });
});

// ============================================================================
// Reconnection Tests
// ============================================================================

describe('Reconnection after Disconnect', () => {
  let mockWebSocket: {
    send: ReturnType<typeof mock>;
    close: ReturnType<typeof mock>;
    onopen: (() => void) | null;
    onmessage: ((event: { data: string }) => void) | null;
    onerror: ((error: Error) => void) | null;
    onclose: (() => void) | null;
  };

  let originalWebSocket: typeof WebSocket;
  let wsConstructorCalls: number;

  beforeEach(() => {
    wsConstructorCalls = 0;

    mockWebSocket = {
      send: mock(() => {}),
      close: mock(() => {}),
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    };

    originalWebSocket = globalThis.WebSocket;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = mock(() => {
      wsConstructorCalls++;
      return mockWebSocket;
    });
  });

  afterEach(() => {
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
  });

  describe('reconnection events', () => {
    test('emits reconnecting event on connection loss', async () => {
      const { RemoteClient } = await import('../../src/remote/client.js');

      const events: unknown[] = [];
      const client = new RemoteClient(
        'localhost',
        7890,
        'test-token',
        (event) => events.push(event),
        { maxRetries: 3, initialDelayMs: 10 }
      );

      const connectPromise = client.connect();
      mockWebSocket.onopen?.();

      const authCall = (mockWebSocket.send as ReturnType<typeof mock>).mock.calls[0];
      const authMessage = JSON.parse(authCall[0] as string) as WSMessage;

      mockWebSocket.onmessage?.({
        data: JSON.stringify({
          type: 'auth_response',
          id: authMessage.id,
          timestamp: new Date().toISOString(),
          success: true,
        }),
      });

      await connectPromise;
      expect(client.status).toBe('connected');

      // Simulate unexpected disconnect
      mockWebSocket.onclose?.();

      // Should transition to reconnecting
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(client.status).toBe('reconnecting');

      const reconnectingEvent = events.find(
        (e) => typeof e === 'object' && e !== null && 'type' in e && e.type === 'reconnecting'
      );
      expect(reconnectingEvent).toBeDefined();

      // Clean up
      client.disconnect();
    });

    test('emits reconnected event on successful reconnection', async () => {
      const { RemoteClient } = await import('../../src/remote/client.js');

      const events: unknown[] = [];
      const client = new RemoteClient(
        'localhost',
        7890,
        'test-token',
        (event) => events.push(event),
        { maxRetries: 3, initialDelayMs: 10 }
      );

      const connectPromise = client.connect();
      mockWebSocket.onopen?.();

      const authCall = (mockWebSocket.send as ReturnType<typeof mock>).mock.calls[0];
      const authMessage = JSON.parse(authCall[0] as string) as WSMessage;

      mockWebSocket.onmessage?.({
        data: JSON.stringify({
          type: 'auth_response',
          id: authMessage.id,
          timestamp: new Date().toISOString(),
          success: true,
        }),
      });

      await connectPromise;

      // Simulate unexpected disconnect
      mockWebSocket.onclose?.();

      // Wait for reconnect attempt
      await new Promise((resolve) => setTimeout(resolve, 15));

      // Simulate successful reconnection
      mockWebSocket.onopen?.();

      // Get the new auth message
      const newAuthCall = (mockWebSocket.send as ReturnType<typeof mock>).mock.calls[1];
      if (newAuthCall) {
        const newAuthMessage = JSON.parse(newAuthCall[0] as string) as WSMessage;
        mockWebSocket.onmessage?.({
          data: JSON.stringify({
            type: 'auth_response',
            id: newAuthMessage.id,
            timestamp: new Date().toISOString(),
            success: true,
          }),
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 5));

      const reconnectedEvent = events.find(
        (e) => typeof e === 'object' && e !== null && 'type' in e && e.type === 'reconnected'
      );
      expect(reconnectedEvent).toBeDefined();

      client.disconnect();
    });

    test('emits reconnect_failed after max retries', async () => {
      const { RemoteClient } = await import('../../src/remote/client.js');

      const events: unknown[] = [];
      const client = new RemoteClient(
        'localhost',
        7890,
        'test-token',
        (event) => events.push(event),
        { maxRetries: 2, initialDelayMs: 5, backoffMultiplier: 1 }
      );

      const connectPromise = client.connect();
      mockWebSocket.onopen?.();

      const authCall = (mockWebSocket.send as ReturnType<typeof mock>).mock.calls[0];
      const authMessage = JSON.parse(authCall[0] as string) as WSMessage;

      mockWebSocket.onmessage?.({
        data: JSON.stringify({
          type: 'auth_response',
          id: authMessage.id,
          timestamp: new Date().toISOString(),
          success: true,
        }),
      });

      await connectPromise;

      // Simulate unexpected disconnect
      mockWebSocket.onclose?.();

      // Simulate failed reconnect attempts
      for (let i = 0; i < 3; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        mockWebSocket.onclose?.();
      }

      await new Promise((resolve) => setTimeout(resolve, 10));

      const failedEvent = events.find(
        (e) => typeof e === 'object' && e !== null && 'type' in e && e.type === 'reconnect_failed'
      );
      expect(failedEvent).toBeDefined();
    });
  });

  describe('reconnection metrics', () => {
    test('tracks reconnection attempts', async () => {
      const { RemoteClient } = await import('../../src/remote/client.js');

      const client = new RemoteClient(
        'localhost',
        7890,
        'test-token',
        () => {},
        { maxRetries: 5, initialDelayMs: 5 }
      );

      const connectPromise = client.connect();
      mockWebSocket.onopen?.();

      const authCall = (mockWebSocket.send as ReturnType<typeof mock>).mock.calls[0];
      const authMessage = JSON.parse(authCall[0] as string) as WSMessage;

      mockWebSocket.onmessage?.({
        data: JSON.stringify({
          type: 'auth_response',
          id: authMessage.id,
          timestamp: new Date().toISOString(),
          success: true,
        }),
      });

      await connectPromise;

      // Initial metrics
      expect(client.metrics.reconnectAttempts).toBe(0);
      expect(client.metrics.isReconnecting).toBe(false);

      // Simulate disconnect
      mockWebSocket.onclose?.();

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(client.metrics.isReconnecting).toBe(true);
      expect(client.metrics.reconnectAttempts).toBeGreaterThan(0);

      client.disconnect();
    });

    test('resets reconnect attempts on successful reconnection', async () => {
      const { RemoteClient } = await import('../../src/remote/client.js');

      const client = new RemoteClient(
        'localhost',
        7890,
        'test-token',
        () => {},
        { maxRetries: 5, initialDelayMs: 5 }
      );

      const connectPromise = client.connect();
      mockWebSocket.onopen?.();

      const authCall = (mockWebSocket.send as ReturnType<typeof mock>).mock.calls[0];
      const authMessage = JSON.parse(authCall[0] as string) as WSMessage;

      mockWebSocket.onmessage?.({
        data: JSON.stringify({
          type: 'auth_response',
          id: authMessage.id,
          timestamp: new Date().toISOString(),
          success: true,
        }),
      });

      await connectPromise;

      // Simulate disconnect
      mockWebSocket.onclose?.();

      await new Promise((resolve) => setTimeout(resolve, 10));

      // Simulate successful reconnect
      mockWebSocket.onopen?.();

      const newAuthCall = (mockWebSocket.send as ReturnType<typeof mock>).mock.calls[1];
      if (newAuthCall) {
        const newAuthMessage = JSON.parse(newAuthCall[0] as string) as WSMessage;
        mockWebSocket.onmessage?.({
          data: JSON.stringify({
            type: 'auth_response',
            id: newAuthMessage.id,
            timestamp: new Date().toISOString(),
            success: true,
          }),
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 5));

      expect(client.metrics.reconnectAttempts).toBe(0);
      expect(client.status).toBe('connected');

      client.disconnect();
    });
  });

  describe('intentional vs accidental disconnect', () => {
    test('intentional disconnect does not trigger reconnection', async () => {
      const { RemoteClient } = await import('../../src/remote/client.js');

      const events: unknown[] = [];
      const client = new RemoteClient(
        'localhost',
        7890,
        'test-token',
        (event) => events.push(event),
        { maxRetries: 3, initialDelayMs: 5 }
      );

      const connectPromise = client.connect();
      mockWebSocket.onopen?.();

      const authCall = (mockWebSocket.send as ReturnType<typeof mock>).mock.calls[0];
      const authMessage = JSON.parse(authCall[0] as string) as WSMessage;

      mockWebSocket.onmessage?.({
        data: JSON.stringify({
          type: 'auth_response',
          id: authMessage.id,
          timestamp: new Date().toISOString(),
          success: true,
        }),
      });

      await connectPromise;

      // Intentional disconnect
      client.disconnect();

      await new Promise((resolve) => setTimeout(resolve, 20));

      const reconnectingEvent = events.find(
        (e) => typeof e === 'object' && e !== null && 'type' in e && e.type === 'reconnecting'
      );
      expect(reconnectingEvent).toBeUndefined();
      expect(client.status).toBe('disconnected');
    });
  });
});
