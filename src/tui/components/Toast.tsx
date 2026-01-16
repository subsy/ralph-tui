/**
 * ABOUTME: Toast notification component for the Ralph TUI.
 * Displays transient, non-blocking notifications with icon and message.
 * Supports success, error, info, and warning variants.
 */

import type { ReactNode } from 'react';
import { colors } from '../theme.js';
import type { Toast as ToastType, ToastVariant } from '../hooks/useToast.js';

/**
 * Icon and color mapping for toast variants.
 */
const VARIANT_CONFIG: Record<ToastVariant, { icon: string; color: string }> = {
  success: { icon: '✓', color: colors.status.success },
  error: { icon: '✗', color: colors.status.error },
  info: { icon: 'ℹ', color: colors.status.info },
  warning: { icon: '⚠', color: colors.status.warning },
};

/**
 * Props for a single Toast notification.
 */
export interface ToastProps {
  /** The toast data to display */
  toast: ToastType;
}

/**
 * Single Toast notification component.
 */
export function Toast({ toast }: ToastProps): ReactNode {
  const config = VARIANT_CONFIG[toast.variant];

  return (
    <box
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 1,
        backgroundColor: colors.bg.tertiary,
        paddingLeft: 1,
        paddingRight: 1,
        height: 1,
      }}
    >
      <text fg={config.color}>{config.icon}</text>
      <text fg={colors.fg.primary}>{toast.message}</text>
    </box>
  );
}

/**
 * Props for the ToastContainer component.
 */
export interface ToastContainerProps {
  /** Array of toasts to display */
  toasts: ToastType[];
  /** Maximum width of the toast container (default: 50) */
  maxWidth?: number;
}

/**
 * Container for displaying multiple toast notifications.
 * Toasts are displayed in a stack, with newer toasts at the bottom.
 */
export function ToastContainer({ toasts, maxWidth = 50 }: ToastContainerProps): ReactNode {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <box
      style={{
        position: 'absolute',
        top: 1,
        right: 1,
        width: maxWidth,
        flexDirection: 'column',
        gap: 0,
        zIndex: 100,
      }}
    >
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} />
      ))}
    </box>
  );
}
