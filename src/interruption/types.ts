/**
 * ABOUTME: Type definitions for graceful interruption handling.
 * Defines types for interrupt state, confirmation dialogs, and signal handling.
 */

/**
 * State of the interruption handling system.
 * - 'idle': No interrupt in progress
 * - 'confirming': Showing confirmation dialog, waiting for user response
 * - 'interrupting': User confirmed, performing graceful shutdown
 * - 'force_quit': Double Ctrl+C detected, forcing immediate exit
 */
export type InterruptState =
  | 'idle'
  | 'confirming'
  | 'interrupting'
  | 'force_quit';

/**
 * User response to the confirmation dialog.
 */
export type ConfirmationResponse = 'confirm' | 'cancel';

/**
 * Options for the interruption handler.
 */
export interface InterruptHandlerOptions {
  /** Time window in milliseconds for double-press detection (default: 1000ms) */
  doublePressWindowMs?: number;

  /** Callback when interrupt is confirmed */
  onConfirmed: () => Promise<void>;

  /** Callback when interrupt is cancelled */
  onCancelled: () => void;

  /** Callback to show the confirmation dialog */
  onShowDialog: () => void;

  /** Callback to hide the confirmation dialog */
  onHideDialog: () => void;

  /** Callback for force quit (double Ctrl+C) */
  onForceQuit: () => void;
}

/**
 * Interface for the interrupt handler.
 */
export interface InterruptHandler {
  /** Handle a SIGINT signal */
  handleSigint(): void;

  /** Handle user response to confirmation dialog */
  handleResponse(response: ConfirmationResponse): Promise<void>;

  /** Get current interrupt state */
  getState(): InterruptState;

  /** Reset to idle state */
  reset(): void;

  /** Cleanup and remove signal handlers */
  dispose(): void;
}

/**
 * Props for the confirmation dialog component.
 */
export interface ConfirmationDialogProps {
  /** Whether the dialog is visible */
  visible: boolean;

  /** Dialog title */
  title: string;

  /** Dialog message */
  message: string;

  /** Callback when user confirms (y) */
  onConfirm: () => void;

  /** Callback when user cancels (n or Esc) */
  onCancel: () => void;
}
