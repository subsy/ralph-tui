/**
 * ABOUTME: Interrupt handler for graceful Ctrl+C handling.
 * Implements double-press detection, confirmation dialog flow, and signal management.
 */

import type {
  InterruptHandler,
  InterruptHandlerOptions,
  InterruptState,
  ConfirmationResponse,
} from './types.js';

/**
 * Default time window for double-press detection (1 second)
 */
const DEFAULT_DOUBLE_PRESS_WINDOW_MS = 1000;

/**
 * Creates an interrupt handler with double-press detection and confirmation flow.
 *
 * Flow:
 * 1. First Ctrl+C: Show confirmation dialog
 * 2. User presses 'y': Confirm interrupt → graceful shutdown
 * 3. User presses 'n' or Esc: Cancel → return to normal operation
 * 4. Double Ctrl+C (within window): Force quit immediately
 */
export function createInterruptHandler(
  options: InterruptHandlerOptions,
): InterruptHandler {
  const doublePressWindowMs =
    options.doublePressWindowMs ?? DEFAULT_DOUBLE_PRESS_WINDOW_MS;

  let state: InterruptState = 'idle';
  let lastSigintTime = 0;
  let signalHandler: (() => void) | null = null;

  /**
   * Handle SIGINT signal (Ctrl+C)
   */
  function handleSigint(): void {
    const now = Date.now();
    const timeSinceLastSigint = now - lastSigintTime;
    lastSigintTime = now;

    // Check for double-press
    if (timeSinceLastSigint < doublePressWindowMs && state !== 'idle') {
      // Double Ctrl+C detected - force quit
      state = 'force_quit';
      options.onForceQuit();
      return;
    }

    // First press or press after window expired
    if (state === 'idle') {
      state = 'confirming';
      options.onShowDialog();
    } else if (state === 'confirming') {
      // Second press while confirming but outside double-press window
      // Treat as double-press for better UX
      state = 'force_quit';
      options.onForceQuit();
    }
  }

  /**
   * Handle user response to confirmation dialog
   */
  async function handleResponse(response: ConfirmationResponse): Promise<void> {
    if (state !== 'confirming') {
      return;
    }

    if (response === 'confirm') {
      state = 'interrupting';
      options.onHideDialog();
      await options.onConfirmed();
    } else {
      state = 'idle';
      options.onHideDialog();
      options.onCancelled();
    }
  }

  /**
   * Get current interrupt state
   */
  function getState(): InterruptState {
    return state;
  }

  /**
   * Reset to idle state
   */
  function reset(): void {
    state = 'idle';
    lastSigintTime = 0;
  }

  /**
   * Install process signal handler
   */
  function install(): void {
    if (signalHandler) {
      return; // Already installed
    }

    signalHandler = () => {
      handleSigint();
    };

    process.on('SIGINT', signalHandler);
  }

  /**
   * Cleanup and remove signal handlers
   */
  function dispose(): void {
    if (signalHandler) {
      process.removeListener('SIGINT', signalHandler);
      signalHandler = null;
    }
  }

  // Install signal handler on creation
  install();

  return {
    handleSigint,
    handleResponse,
    getState,
    reset,
    dispose,
  };
}
