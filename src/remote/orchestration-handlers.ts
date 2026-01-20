/**
 * ABOUTME: Handlers for orchestration commands over remote WebSocket protocol.
 * Implements orchestrate:start, orchestrate:status, orchestrate:pause, orchestrate:resume.
 */

import type { ServerWebSocket } from 'bun';
import type {
  OrchestrateStartMessage,
  OrchestrateStartResponseMessage,
  OrchestrateStatusMessage,
  OrchestrateStatusResponseMessage,
  OrchestratePauseMessage,
  OrchestrateResumeMessage,
  OrchestratorEventMessage,
  RemoteOrchestratorState,
  OrchestratorStatus,
  OperationResultMessage,
  WSMessage,
} from './types.js';
import { Orchestrator, type OrchestratorEvent, type WorkerState } from '../orchestrator/index.js';

interface WebSocketData {
  ip: string;
}

type SendFn = (ws: ServerWebSocket<WebSocketData>, message: WSMessage) => void;
type CreateMessageFn = <T extends WSMessage>(
  type: T['type'],
  data: Omit<T, 'type' | 'id' | 'timestamp'>
) => T;

interface OrchestratorState {
  orchestrator: Orchestrator | null;
  status: OrchestratorStatus;
  currentPhase?: string;
  currentPhaseIndex?: number;
  totalPhases?: number;
  workers: WorkerState[];
  completedTasks: number;
  totalTasks: number;
  startedAt?: string;
  unsubscribe?: () => void;
}

/** In-memory orchestrator state for the server */
let orchestratorState: OrchestratorState = {
  orchestrator: null,
  status: 'idle',
  workers: [],
  completedTasks: 0,
  totalTasks: 0,
};

/** Subscribers for orchestrator events */
const orchestratorSubscribers = new Set<ServerWebSocket<WebSocketData>>();

function buildRemoteState(): RemoteOrchestratorState {
  return {
    status: orchestratorState.status,
    currentPhase: orchestratorState.currentPhase,
    currentPhaseIndex: orchestratorState.currentPhaseIndex,
    totalPhases: orchestratorState.totalPhases,
    workers: orchestratorState.workers,
    completedTasks: orchestratorState.completedTasks,
    totalTasks: orchestratorState.totalTasks,
    startedAt: orchestratorState.startedAt,
  };
}

function broadcastOrchestratorEvent(
  event: OrchestratorEvent,
  send: SendFn,
  createMessage: CreateMessageFn
): void {
  const message = createMessage<OrchestratorEventMessage>('orchestrator_event', { event });
  for (const ws of orchestratorSubscribers) {
    send(ws, message);
  }
}

function updateStateFromEvent(event: OrchestratorEvent): void {
  switch (event.type) {
    case 'phase:started':
      orchestratorState.currentPhase = event.phaseName;
      orchestratorState.currentPhaseIndex = event.phaseIndex;
      orchestratorState.totalPhases = event.totalPhases;
      break;
    case 'phase:completed':
      // Phase done
      break;
    case 'worker:started': {
      const existingIdx = orchestratorState.workers.findIndex((w) => w.id === event.workerId);
      const newWorker: WorkerState = {
        id: event.workerId,
        range: event.range,
        status: 'running',
        progress: 0,
      };
      if (existingIdx >= 0) {
        orchestratorState.workers[existingIdx] = newWorker;
      } else {
        orchestratorState.workers.push(newWorker);
      }
      break;
    }
    case 'worker:progress': {
      const worker = orchestratorState.workers.find((w) => w.id === event.workerId);
      if (worker) {
        worker.progress = event.progress;
        worker.currentTaskId = event.currentTaskId;
      }
      break;
    }
    case 'worker:completed': {
      const worker = orchestratorState.workers.find((w) => w.id === event.workerId);
      if (worker) {
        worker.status = 'completed';
        worker.progress = 100;
      }
      break;
    }
    case 'worker:failed': {
      const worker = orchestratorState.workers.find((w) => w.id === event.workerId);
      if (worker) {
        worker.status = 'failed';
        worker.error = event.error;
      }
      break;
    }
    case 'orchestration:completed':
      orchestratorState.status = 'completed';
      orchestratorState.completedTasks = event.completedTasks;
      orchestratorState.totalTasks = event.totalTasks;
      break;
  }
}

export function handleOrchestrateStart(
  ws: ServerWebSocket<WebSocketData>,
  message: OrchestrateStartMessage,
  send: SendFn,
  createMessage: CreateMessageFn,
  cwd: string
): void {
  if (orchestratorState.status === 'running' || orchestratorState.status === 'paused') {
    const response = createMessage<OrchestrateStartResponseMessage>('orchestrate:start_response', {
      success: false,
      error: 'Orchestration already in progress',
    });
    response.id = message.id;
    send(ws, response);
    return;
  }

  // Reset state
  orchestratorState = {
    orchestrator: null,
    status: 'running',
    workers: [],
    completedTasks: 0,
    totalTasks: 0,
    startedAt: new Date().toISOString(),
  };

  const orchestrator = new Orchestrator({
    prdPath: message.prdPath,
    maxWorkers: message.maxWorkers ?? 3,
    headless: message.headless ?? true,
    cwd,
  });
  orchestratorState.orchestrator = orchestrator;

  // Subscribe to events
  const eventTypes = [
    'worker:started',
    'worker:progress',
    'worker:completed',
    'worker:failed',
    'phase:started',
    'phase:completed',
    'orchestration:completed',
  ];
  const handlers: Array<() => void> = [];
  for (const eventType of eventTypes) {
    const handler = (event: OrchestratorEvent): void => {
      updateStateFromEvent(event);
      broadcastOrchestratorEvent(event, send, createMessage);
    };
    orchestrator.on(eventType, handler);
    handlers.push(() => orchestrator.off(eventType, handler));
  }
  orchestratorState.unsubscribe = () => handlers.forEach((h) => h());

  // Add this client as a subscriber
  orchestratorSubscribers.add(ws);

  // Start orchestration in background
  orchestrator.run().then(() => {
    if (orchestratorState.status !== 'completed') {
      orchestratorState.status = 'completed';
    }
  }).catch(() => {
    orchestratorState.status = 'failed';
    // Send completion event indicating failure
    const errorEvent: OrchestratorEvent = {
      type: 'orchestration:completed',
      totalTasks: orchestratorState.totalTasks,
      completedTasks: orchestratorState.completedTasks,
    };
    broadcastOrchestratorEvent(errorEvent, send, createMessage);
  });

  const response = createMessage<OrchestrateStartResponseMessage>('orchestrate:start_response', {
    success: true,
  });
  response.id = message.id;
  send(ws, response);
}

export function handleOrchestrateStatus(
  ws: ServerWebSocket<WebSocketData>,
  message: OrchestrateStatusMessage,
  send: SendFn,
  createMessage: CreateMessageFn
): void {
  const response = createMessage<OrchestrateStatusResponseMessage>('orchestrate:status_response', {
    state: buildRemoteState(),
  });
  response.id = message.id;
  send(ws, response);
}

export function handleOrchestratePause(
  ws: ServerWebSocket<WebSocketData>,
  message: OrchestratePauseMessage,
  send: SendFn,
  createMessage: CreateMessageFn
): void {
  if (orchestratorState.status !== 'running') {
    const response = createMessage<OperationResultMessage>('operation_result', {
      operation: 'orchestrate:pause',
      success: false,
      error: 'No orchestration running',
    });
    response.id = message.id;
    send(ws, response);
    return;
  }

  // Note: The Orchestrator class doesn't have pause/resume yet.
  // For now, we just update the status. A full implementation would
  // require extending Orchestrator with pause/resume methods.
  orchestratorState.status = 'paused';

  const response = createMessage<OperationResultMessage>('operation_result', {
    operation: 'orchestrate:pause',
    success: true,
  });
  response.id = message.id;
  send(ws, response);
}

export function handleOrchestrateResume(
  ws: ServerWebSocket<WebSocketData>,
  message: OrchestrateResumeMessage,
  send: SendFn,
  createMessage: CreateMessageFn
): void {
  if (orchestratorState.status !== 'paused') {
    const response = createMessage<OperationResultMessage>('operation_result', {
      operation: 'orchestrate:resume',
      success: false,
      error: 'Orchestration not paused',
    });
    response.id = message.id;
    send(ws, response);
    return;
  }

  orchestratorState.status = 'running';

  const response = createMessage<OperationResultMessage>('operation_result', {
    operation: 'orchestrate:resume',
    success: true,
  });
  response.id = message.id;
  send(ws, response);
}

/** Subscribe a client to orchestrator events */
export function subscribeToOrchestrator(ws: ServerWebSocket<WebSocketData>): void {
  orchestratorSubscribers.add(ws);
}

/** Unsubscribe a client from orchestrator events */
export function unsubscribeFromOrchestrator(ws: ServerWebSocket<WebSocketData>): void {
  orchestratorSubscribers.delete(ws);
}

/** Clean up when server stops */
export function cleanupOrchestrator(): void {
  if (orchestratorState.unsubscribe) {
    orchestratorState.unsubscribe();
  }
  if (orchestratorState.orchestrator) {
    orchestratorState.orchestrator.shutdown();
  }
  orchestratorState = {
    orchestrator: null,
    status: 'idle',
    workers: [],
    completedTasks: 0,
    totalTasks: 0,
  };
  orchestratorSubscribers.clear();
}
