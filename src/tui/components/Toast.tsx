/**
 * ABOUTME: Toast notification component for the Ralph TUI.
 * Displays transient, non-blocking notifications with icon and message.
 * Supports success, error, info, and warning variants.
 * Also provides connection resilience feedback (reconnecting, reconnected, failed).
 */

import type { ReactNode } from "react";
import { colors } from "../theme.js";
import type { Toast as ToastType, ToastVariant } from "../hooks/useToast.js";

// Re-export ToastVariant for consumers
export type { ToastVariant } from "../hooks/useToast.js";

/**
 * Icon and color mapping for toast variants.
 */
const VARIANT_CONFIG: Record<ToastVariant, { icon: string; color: string }> = {
  success: { icon: "✓", color: colors.status.success },
  error: { icon: "✗", color: colors.status.error },
  info: { icon: "ℹ", color: colors.status.info },
  warning: { icon: "⚠", color: colors.status.warning },
};

/**
 * Props for a single Toast notification (standalone API for RunApp connection toasts).
 * This is used directly by RunApp for connection status toasts.
 */
export interface ToastProps {
  /** Whether the toast is visible */
  visible: boolean;
  /** Message to display */
  message: string;
  /** Icon to display (overrides variant default) */
  icon: string;
  /** Toast variant for color styling */
  variant: ToastVariant;
  /** Distance from bottom of container */
  bottom?: number;
  /** Distance from right of container */
  right?: number;
}

/**
 * Single Toast notification component (standalone API).
 * Used by RunApp for connection status toasts with positioning.
 */
export function Toast({
  visible,
  message,
  icon,
  variant,
  bottom = 2,
  right = 1,
}: ToastProps): ReactNode {
  if (!visible) {
    return null;
  }

  const config = VARIANT_CONFIG[variant];

  return (
    <box
      style={{
        position: "absolute",
        bottom,
        right,
        flexDirection: "row",
        alignItems: "center",
        gap: 1,
        backgroundColor: colors.bg.tertiary,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <text fg={config.color}>{icon}</text>
      <text fg={colors.fg.primary}>{message}</text>
    </box>
  );
}

/**
 * Props for ToastItem (used internally by ToastList/ToastContainer).
 */
export interface ToastItemProps {
  /** The toast data to display */
  toast: ToastType;
}

/**
 * Internal Toast item component for rendering toasts from useToast hook.
 * Used by ToastList/ToastContainer for the image attachment feature.
 */
function ToastItem({ toast }: ToastItemProps): ReactNode {
  const config = VARIANT_CONFIG[toast.variant];

  return (
    <box
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 1,
        backgroundColor: colors.bg.tertiary,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      <text fg={config.color}>{config.icon}</text>
      <text fg={colors.fg.primary}>{toast.message}</text>
    </box>
  );
}

/**
 * Props for a toast list container.
 */
export interface ToastListProps {
  /** Array of toasts to display */
  toasts: ToastType[];
}

/**
 * Toast list component that displays multiple toasts stacked vertically.
 * Used by ChatView via the ToastContainer alias.
 */
export function ToastList({ toasts }: ToastListProps): ReactNode {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <box
      style={{
        flexDirection: "column",
        gap: 0,
        position: "absolute",
        bottom: 2,
        right: 1,
      }}
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </box>
  );
}

/**
 * Alias for ToastList - used by ChatView for image attachment toasts.
 */
export const ToastContainer = ToastList;

/**
 * Connection-specific toast message type (used by InstanceManager).
 */
export type ConnectionToastMessage =
  | { type: "reconnecting"; alias: string; attempt: number; maxRetries: number }
  | { type: "reconnected"; alias: string; totalAttempts: number }
  | { type: "reconnect_failed"; alias: string; attempts: number; error: string }
  | { type: "connection_error"; alias: string; error: string };

/**
 * Format a connection toast message for display.
 */
export function formatConnectionToast(toast: ConnectionToastMessage): {
  message: string;
  variant: ToastVariant;
  icon: string;
} {
  switch (toast.type) {
    case "reconnecting":
      return {
        message: `${toast.alias}: Reconnecting (${toast.attempt}/${toast.maxRetries})...`,
        variant: "warning",
        icon: "⟳",
      };
    case "reconnected":
      return {
        message: `${toast.alias}: Reconnected after ${toast.totalAttempts} ${toast.totalAttempts === 1 ? "attempt" : "attempts"}`,
        variant: "success",
        icon: "●",
      };
    case "reconnect_failed":
      return {
        message: `${toast.alias}: Connection failed after ${toast.attempts} attempts`,
        variant: "error",
        icon: "○",
      };
    case "connection_error":
      return {
        message: `${toast.alias}: ${toast.error}`,
        variant: "error",
        icon: "✗",
      };
  }
}
