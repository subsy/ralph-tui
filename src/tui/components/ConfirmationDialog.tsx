/**
 * ABOUTME: Confirmation dialog component for interrupt handling.
 * Displays a modal dialog asking user to confirm or cancel an action.
 */

import type { ReactNode } from 'react';
import { colors } from '../theme.js';

/**
 * Props for the ConfirmationDialog component
 */
export interface ConfirmationDialogProps {
  /** Whether the dialog is visible */
  visible: boolean;

  /** Dialog title */
  title: string;

  /** Dialog message */
  message: string;

  /** Hint text showing available keys */
  hint?: string;
}

/**
 * Modal confirmation dialog that overlays the TUI.
 * User responds via keyboard (y/n/Esc) - handling is done by parent component.
 */
export function ConfirmationDialog({
  visible,
  title,
  message,
  hint = '[y] Yes  [n/Esc] No',
}: ConfirmationDialogProps): ReactNode {
  if (!visible) {
    return null;
  }

  // Wrap in a full-screen overlay to center the dialog
  return (
    <box
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <box
        style={{
          width: 50,
          height: 9,
          backgroundColor: colors.bg.secondary,
          border: true,
          borderColor: colors.status.warning,
          flexDirection: 'column',
          padding: 1,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {/* Title */}
        <text fg={colors.status.warning}>{title}</text>

        {/* Spacer */}
        <box style={{ height: 1 }} />

        {/* Message */}
        <text fg={colors.fg.primary}>{message}</text>

        {/* Spacer */}
        <box style={{ height: 1 }} />

        {/* Hint */}
        <text fg={colors.fg.muted}>{hint}</text>
      </box>
    </box>
  );
}
