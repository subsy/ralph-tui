/**
 * ABOUTME: React hook for managing toast notifications in the Ralph TUI.
 * Provides a simple API for showing transient, auto-dismissing notifications
 * with support for success, error, info, and warning variants.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Toast notification variant types.
 */
export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

/**
 * A single toast notification.
 */
export interface Toast {
  /** Unique identifier for this toast */
  id: string;
  /** Display message */
  message: string;
  /** Visual variant */
  variant: ToastVariant;
  /** When this toast was created (for timeout tracking) */
  createdAt: number;
}

/**
 * Options for showing a toast.
 */
export interface ShowToastOptions {
  /** How long to show the toast in milliseconds (default: 3000) */
  duration?: number;
}

/**
 * Return type for the useToast hook.
 */
export interface UseToastReturn {
  /** Currently visible toasts */
  toasts: Toast[];
  /** Show a success toast */
  showSuccess: (message: string, options?: ShowToastOptions) => void;
  /** Show an error toast */
  showError: (message: string, options?: ShowToastOptions) => void;
  /** Show an info toast */
  showInfo: (message: string, options?: ShowToastOptions) => void;
  /** Show a warning toast */
  showWarning: (message: string, options?: ShowToastOptions) => void;
  /** Dismiss a specific toast by ID */
  dismiss: (id: string) => void;
  /** Dismiss all toasts */
  dismissAll: () => void;
}

/** Default toast duration in milliseconds */
const DEFAULT_DURATION = 3000;

/** Maximum number of toasts to display at once */
const MAX_TOASTS = 5;

/** Counter for generating unique toast IDs */
let toastIdCounter = 0;

/**
 * Generate a unique toast ID.
 */
function generateToastId(): string {
  toastIdCounter += 1;
  return `toast-${toastIdCounter}`;
}

/**
 * React hook for managing toast notifications.
 *
 * @returns Object with toast state and methods for showing/dismissing toasts
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { toasts, showSuccess, showError } = useToast();
 *
 *   const handleSave = async () => {
 *     try {
 *       await saveData();
 *       showSuccess('Data saved!');
 *     } catch (err) {
 *       showError('Failed to save data');
 *     }
 *   };
 *
 *   return (
 *     <>
 *       <button onClick={handleSave}>Save</button>
 *       <ToastContainer toasts={toasts} />
 *     </>
 *   );
 * }
 * ```
 */
export function useToast(): UseToastReturn {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  // Clean up all timeouts on unmount
  useEffect(() => {
    return () => {
      for (const timeout of timeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
      timeoutsRef.current.clear();
    };
  }, []);

  /**
   * Dismiss a toast by ID.
   */
  const dismiss = useCallback((id: string) => {
    // Clear any existing timeout for this toast
    const existingTimeout = timeoutsRef.current.get(id);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
      timeoutsRef.current.delete(id);
    }

    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /**
   * Dismiss all toasts.
   */
  const dismissAll = useCallback(() => {
    // Clear all timeouts
    for (const timeout of timeoutsRef.current.values()) {
      clearTimeout(timeout);
    }
    timeoutsRef.current.clear();

    setToasts([]);
  }, []);

  /**
   * Show a toast notification.
   */
  const showToast = useCallback(
    (
      variant: ToastVariant,
      message: string,
      options: ShowToastOptions = {},
    ) => {
      const { duration = DEFAULT_DURATION } = options;
      const id = generateToastId();

      const toast: Toast = {
        id,
        message,
        variant,
        createdAt: Date.now(),
      };

      setToasts((prev) => {
        // Add new toast, limiting to MAX_TOASTS
        const updated = [...prev, toast];
        if (updated.length > MAX_TOASTS) {
          // Remove oldest toasts (keeping within limit)
          const toRemove = updated.slice(0, updated.length - MAX_TOASTS);
          for (const t of toRemove) {
            const timeout = timeoutsRef.current.get(t.id);
            if (timeout) {
              clearTimeout(timeout);
              timeoutsRef.current.delete(t.id);
            }
          }
          return updated.slice(-MAX_TOASTS);
        }
        return updated;
      });

      // Set auto-dismiss timeout
      const timeout = setTimeout(() => {
        dismiss(id);
      }, duration);
      timeoutsRef.current.set(id, timeout);
    },
    [dismiss],
  );

  const showSuccess = useCallback(
    (message: string, options?: ShowToastOptions) => {
      showToast('success', message, options);
    },
    [showToast],
  );

  const showError = useCallback(
    (message: string, options?: ShowToastOptions) => {
      showToast('error', message, options);
    },
    [showToast],
  );

  const showInfo = useCallback(
    (message: string, options?: ShowToastOptions) => {
      showToast('info', message, options);
    },
    [showToast],
  );

  const showWarning = useCallback(
    (message: string, options?: ShowToastOptions) => {
      showToast('warning', message, options);
    },
    [showToast],
  );

  return {
    toasts,
    showSuccess,
    showError,
    showInfo,
    showWarning,
    dismiss,
    dismissAll,
  };
}
