/**
 * ABOUTME: Tests for the model escalation strategy.
 * Verifies that the escalation logic correctly selects models based on attempt counts.
 */

import { describe, it, expect } from 'bun:test';
import {
  createEscalationState,
  getModelForTask,
  recordTaskAttempt,
  clearTaskAttempts,
} from '../../src/engine/model-escalation.js';
import { DEFAULT_MODEL_ESCALATION } from '../../src/config/types.js';

describe('model-escalation', () => {
  it('first attempt uses startModel', () => {
    const state = createEscalationState();
    const model = getModelForTask('task-1', DEFAULT_MODEL_ESCALATION, state);
    expect(model).toBe(DEFAULT_MODEL_ESCALATION.startModel);
  });

  it('after escalateAfter failures, uses escalateModel', () => {
    const state = createEscalationState();
    const config = { ...DEFAULT_MODEL_ESCALATION, escalateAfter: 1 };

    // Record one failure
    recordTaskAttempt('task-1', state);

    const model = getModelForTask('task-1', config, state);
    expect(model).toBe(config.escalateModel);
  });

  it('stays on startModel before reaching escalateAfter', () => {
    const state = createEscalationState();
    const config = { ...DEFAULT_MODEL_ESCALATION, escalateAfter: 2 };

    // Record one failure (not yet at threshold of 2)
    recordTaskAttempt('task-1', state);

    const model = getModelForTask('task-1', config, state);
    expect(model).toBe(config.startModel);
  });

  it('escalates after exactly escalateAfter failures', () => {
    const state = createEscalationState();
    const config = { ...DEFAULT_MODEL_ESCALATION, escalateAfter: 2 };

    recordTaskAttempt('task-1', state);
    recordTaskAttempt('task-1', state);

    const model = getModelForTask('task-1', config, state);
    expect(model).toBe(config.escalateModel);
  });

  it('task completion clears attempt counter', () => {
    const state = createEscalationState();
    const config = { ...DEFAULT_MODEL_ESCALATION, escalateAfter: 1 };

    // Fail once — should escalate
    recordTaskAttempt('task-1', state);
    expect(getModelForTask('task-1', config, state)).toBe(config.escalateModel);

    // Clear on completion
    clearTaskAttempts('task-1', state);

    // Should be back to startModel
    expect(getModelForTask('task-1', config, state)).toBe(config.startModel);
  });

  it('disabled config still works — getModelForTask returns startModel when enabled is false', () => {
    const state = createEscalationState();
    const config = { ...DEFAULT_MODEL_ESCALATION, enabled: false };

    // Even with enabled: false, the pure function still returns based on attempts
    // The engine is responsible for checking config.enabled before calling getModelForTask
    const model = getModelForTask('task-1', config, state);
    expect(model).toBe(config.startModel);
  });

  it('independent tasks have independent attempt counts', () => {
    const state = createEscalationState();
    const config = { ...DEFAULT_MODEL_ESCALATION, escalateAfter: 1 };

    recordTaskAttempt('task-1', state);

    expect(getModelForTask('task-1', config, state)).toBe(config.escalateModel);
    expect(getModelForTask('task-2', config, state)).toBe(config.startModel);
  });

  it('clearing one task does not affect another', () => {
    const state = createEscalationState();
    const config = { ...DEFAULT_MODEL_ESCALATION, escalateAfter: 1 };

    recordTaskAttempt('task-1', state);
    recordTaskAttempt('task-2', state);

    clearTaskAttempts('task-1', state);

    expect(getModelForTask('task-1', config, state)).toBe(config.startModel);
    expect(getModelForTask('task-2', config, state)).toBe(config.escalateModel);
  });
});
