/**
 * ABOUTME: Model escalation strategy for cost-effective task execution.
 * Starts with a cheaper model and escalates to a more capable one on failure.
 */

import type { ModelEscalationConfig } from '../config/types.js';

export interface ModelEscalationState {
  taskAttempts: Map<string, number>;
}

export function createEscalationState(): ModelEscalationState {
  return { taskAttempts: new Map() };
}

export function getModelForTask(
  taskId: string,
  config: Required<ModelEscalationConfig>,
  state: ModelEscalationState,
): string {
  const attempts = state.taskAttempts.get(taskId) ?? 0;
  return attempts >= config.escalateAfter ? config.escalateModel : config.startModel;
}

export function recordTaskAttempt(
  taskId: string,
  state: ModelEscalationState,
): void {
  const current = state.taskAttempts.get(taskId) ?? 0;
  state.taskAttempts.set(taskId, current + 1);
}

export function clearTaskAttempts(
  taskId: string,
  state: ModelEscalationState,
): void {
  state.taskAttempts.delete(taskId);
}
