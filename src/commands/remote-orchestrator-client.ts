/**
 * ABOUTME: WebSocket client for remote orchestration.
 * Connects to a remote ralph-tui instance to run and monitor orchestration.
 */

import { RemoteClient, type RemoteClientEvent } from '../remote/client.js';
import type {
  OrchestrateStartMessage,
  OrchestrateStartResponseMessage,
  OrchestrateStatusResponseMessage,
  OrchestratorEventMessage,
  WSMessage,
} from '../remote/types.js';
import type { OrchestratorEvent } from '../orchestrator/types.js';
import { createStructuredLogger } from '../logs/index.js';

interface OrchestrationResult {
  success: boolean;
  completedTasks: number;
  totalTasks: number;
  failed: number;
  error?: string;
}

/**
 * Client for running orchestration on a remote ralph-tui instance.
 */
export class RemoteOrchestratorClient {
  private client: RemoteClient;
  private headless: boolean;
  private logger: ReturnType<typeof createStructuredLogger> | null;
  private resolve: ((result: OrchestrationResult) => void) | null = null;
  private completedTasks = 0;
  private totalTasks = 0;
  private failedWorkers = 0;

  constructor(host: string, port: number, token: string, headless: boolean) {
    this.headless = headless;
    this.logger = headless ? createStructuredLogger() : null;
    this.client = new RemoteClient(host, port, token, this.handleEvent.bind(this));
  }

  /**
   * Connect to the remote instance.
   */
  async connect(): Promise<void> {
    await this.client.connect();
  }

  /**
   * Disconnect from the remote instance.
   */
  disconnect(): void {
    this.client.disconnect();
  }

  /**
   * Start orchestration on the remote and wait for completion.
   */
  async runOrchestration(prdPath: string, maxWorkers?: number): Promise<OrchestrationResult> {
    // Subscribe to events first
    await this.client.subscribe();

    // Send orchestrate:start
    const startMsg = this.createMessage<OrchestrateStartMessage>('orchestrate:start', {
      prdPath,
      maxWorkers,
      headless: true, // Remote always runs headless
    });

    return new Promise((resolve, reject) => {
      this.resolve = resolve;

      // Handle timeout
      const timeout = setTimeout(() => {
        this.resolve = null;
        reject(new Error('Orchestration timed out'));
      }, 24 * 60 * 60 * 1000); // 24 hour timeout

      this.client.send(startMsg);

      // The response and events will come through handleEvent
      // Store timeout reference for potential cleanup
      this.cleanupTimeout = (): void => clearTimeout(timeout);
    });
  }

  private cleanupTimeout: (() => void) | null = null;

  private handleEvent(event: RemoteClientEvent): void {
    switch (event.type) {
      case 'disconnected':
        this.handleDisconnect(event.error);
        break;
      case 'reconnecting':
        this.log(`Reconnecting (attempt ${event.attempt}/${event.maxRetries})...`);
        break;
      case 'reconnected':
        this.log(`Reconnected after ${event.totalAttempts} attempts`);
        break;
      case 'reconnect_failed':
        this.handleReconnectFailed(event.error);
        break;
      case 'message':
        this.handleMessage(event.message);
        break;
    }
  }

  private handleDisconnect(error?: string): void {
    if (this.resolve && error) {
      // Only resolve if we haven't completed yet and this is an error
      const resolve = this.resolve;
      this.resolve = null;
      this.cleanupTimeout?.();
      resolve({
        success: false,
        completedTasks: this.completedTasks,
        totalTasks: this.totalTasks,
        failed: this.failedWorkers,
        error: `Disconnected: ${error}`,
      });
    }
  }

  private handleReconnectFailed(error: string): void {
    if (this.resolve) {
      const resolve = this.resolve;
      this.resolve = null;
      this.cleanupTimeout?.();
      resolve({
        success: false,
        completedTasks: this.completedTasks,
        totalTasks: this.totalTasks,
        failed: this.failedWorkers,
        error: `Reconnection failed: ${error}`,
      });
    }
  }

  private handleMessage(message: WSMessage): void {
    switch (message.type) {
      case 'orchestrate:start_response':
        this.handleStartResponse(message as OrchestrateStartResponseMessage);
        break;
      case 'orchestrate:status_response':
        this.handleStatusResponse(message as OrchestrateStatusResponseMessage);
        break;
      case 'orchestrator_event':
        this.handleOrchestratorEvent((message as OrchestratorEventMessage).event);
        break;
    }
  }

  private handleStartResponse(response: OrchestrateStartResponseMessage): void {
    if (!response.success) {
      if (this.resolve) {
        const resolve = this.resolve;
        this.resolve = null;
        this.cleanupTimeout?.();
        resolve({
          success: false,
          completedTasks: 0,
          totalTasks: 0,
          failed: 0,
          error: response.error ?? 'Failed to start orchestration',
        });
      }
    }
    // If success, events will follow
  }

  private handleStatusResponse(_response: OrchestrateStatusResponseMessage): void {
    // Can be used to poll status if needed
  }

  private handleOrchestratorEvent(event: OrchestratorEvent): void {
    switch (event.type) {
      case 'worker:started':
        this.log(`Worker ${event.workerId}: ${event.taskId}`);
        break;
      case 'worker:progress':
        if (!this.headless) {
          process.stdout.write(`\rWorker ${event.workerId}: ${event.progress}%`);
        }
        break;
      case 'worker:completed':
        this.log(`Worker ${event.workerId} completed`);
        break;
      case 'worker:failed':
        this.failedWorkers++;
        this.log(`Worker ${event.workerId} failed: ${event.error}`);
        break;
      case 'orchestration:completed':
        this.completedTasks = event.completedTasks;
        this.totalTasks = event.totalTasks;
        if (this.resolve) {
          const resolve = this.resolve;
          this.resolve = null;
          this.cleanupTimeout?.();
          resolve({
            success: true,
            completedTasks: event.completedTasks,
            totalTasks: event.totalTasks,
            failed: this.failedWorkers,
          });
        }
        break;
    }
  }

  private log(msg: string): void {
    if (this.logger) {
      this.logger.info('engine', msg);
    } else {
      console.log(msg);
    }
  }

  private createMessage<T extends WSMessage>(
    type: T['type'],
    data: Omit<T, 'type' | 'id' | 'timestamp'>
  ): T {
    return {
      type,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...data,
    } as T;
  }
}
