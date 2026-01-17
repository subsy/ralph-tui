/**
 * ABOUTME: Desktop notification module for ralph-tui.
 * Provides cross-platform desktop notifications using node-notifier.
 * Notifications are used to alert users when long-running tasks complete.
 * Also provides configuration resolution for notification settings.
 */

import notifier from 'node-notifier';
import type {
  NotificationsConfig,
  NotificationSoundMode,
} from './config/types.js';
import { playNotificationSound } from './sound.js';

/**
 * Options for sending a desktop notification.
 */
export interface NotificationOptions {
  /** The notification title */
  title: string;
  /** The notification body/message */
  body: string;
  /** Optional path to an icon image */
  icon?: string;
  /** Sound mode for this notification (default: 'off') */
  sound?: NotificationSoundMode;
}

/**
 * Sends a desktop notification to the user.
 *
 * This function wraps node-notifier to provide cross-platform desktop
 * notifications. It handles errors gracefully by logging a warning
 * rather than crashing, since notifications are non-critical.
 *
 * @param options - The notification options
 * @param options.title - The notification title
 * @param options.body - The notification body/message
 * @param options.icon - Optional path to an icon image
 * @param options.sound - Sound mode ('off', 'system', or 'ralph')
 */
export function sendNotification(options: NotificationOptions): void {
  const { title, body, icon, sound = 'off' } = options;

  try {
    notifier.notify(
      {
        title,
        message: body,
        icon,
        // We handle sound ourselves for cross-platform consistency
        sound: false,
      },
      (err: Error | null) => {
        if (err) {
          console.warn(
            `[notifications] Failed to send notification: ${err.message}`,
          );
        }
      },
    );

    // Play sound separately for cross-platform support
    if (sound !== 'off') {
      playNotificationSound(sound).catch((err) => {
        console.warn(`[notifications] Failed to play sound: ${err}`);
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[notifications] Failed to send notification: ${message}`);
  }
}

/**
 * Resolves the final notification enabled state from config and CLI args.
 *
 * Priority (highest to lowest):
 * 1. CLI flag (--notify or --no-notify)
 * 2. Config file (notifications.enabled)
 * 3. Default (true)
 *
 * @param config - The notifications config from the config file (may be undefined)
 * @param cliNotify - The CLI flag value (undefined if not specified, true for --notify, false for --no-notify)
 * @returns Whether notifications should be enabled
 */
export function resolveNotificationsEnabled(
  config?: NotificationsConfig,
  cliNotify?: boolean,
): boolean {
  // CLI flag takes highest priority
  if (cliNotify !== undefined) {
    return cliNotify;
  }

  // Config file takes second priority
  if (config?.enabled !== undefined) {
    return config.enabled;
  }

  // Default to enabled
  return true;
}

/**
 * Formats a duration in milliseconds to "Xm Ys" format.
 *
 * Examples:
 * - 65000 → "1m 5s"
 * - 30000 → "0m 30s"
 * - 125000 → "2m 5s"
 *
 * @param durationMs - Duration in milliseconds
 * @returns Formatted duration string
 */
export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

/**
 * Options for sending a completion notification.
 */
export interface CompletionNotificationOptions {
  /** Total duration in milliseconds */
  durationMs: number;
  /** Number of tasks completed */
  taskCount: number;
  /** Sound mode for this notification */
  sound?: NotificationSoundMode;
}

/**
 * Sends a desktop notification when all tasks complete.
 *
 * The notification has:
 * - Title: "Ralph-TUI Complete"
 * - Body: Includes duration (Xm Ys format) and task count
 *
 * @param options - The completion notification options
 */
export function sendCompletionNotification(
  options: CompletionNotificationOptions,
): void {
  const { durationMs, taskCount, sound } = options;
  const durationStr = formatDuration(durationMs);

  sendNotification({
    title: 'Ralph-TUI Complete',
    body: `Completed ${taskCount} task${taskCount !== 1 ? 's' : ''} in ${durationStr}`,
    sound,
  });
}

/**
 * Options for sending a max iterations notification.
 */
export interface MaxIterationsNotificationOptions {
  /** Number of iterations run */
  iterationsRun: number;
  /** Number of tasks completed */
  tasksCompleted: number;
  /** Number of tasks remaining (open + in_progress) */
  tasksRemaining: number;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Sound mode for this notification */
  sound?: NotificationSoundMode;
}

/**
 * Sends a desktop notification when max iterations limit is reached.
 *
 * The notification has:
 * - Title: "Ralph-TUI Max Iterations"
 * - Body: Includes iterations run, tasks completed vs remaining, duration
 *
 * @param options - The max iterations notification options
 */
export function sendMaxIterationsNotification(
  options: MaxIterationsNotificationOptions,
): void {
  const { iterationsRun, tasksCompleted, tasksRemaining, durationMs, sound } =
    options;
  const durationStr = formatDuration(durationMs);

  const body =
    `Iteration limit reached after ${iterationsRun} iteration${iterationsRun !== 1 ? 's' : ''}. ` +
    `Completed ${tasksCompleted}, ${tasksRemaining} remaining. Duration: ${durationStr}`;

  sendNotification({
    title: 'Ralph-TUI Max Iterations',
    body,
    sound,
  });
}

/**
 * Options for sending an error notification.
 */
export interface ErrorNotificationOptions {
  /** Brief error summary */
  errorSummary: string;
  /** Number of tasks completed before the failure */
  tasksCompleted: number;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Sound mode for this notification */
  sound?: NotificationSoundMode;
}

/**
 * Sends a desktop notification when execution stops due to a fatal error.
 *
 * The notification has:
 * - Title: "Ralph-TUI Error"
 * - Body: Includes brief error summary, tasks completed before failure, duration
 *
 * @param options - The error notification options
 */
export function sendErrorNotification(options: ErrorNotificationOptions): void {
  const { errorSummary, tasksCompleted, durationMs, sound } = options;
  const durationStr = formatDuration(durationMs);

  // Truncate error summary if too long for notification
  const maxErrorLength = 100;
  const truncatedError =
    errorSummary.length > maxErrorLength
      ? errorSummary.substring(0, maxErrorLength) + '...'
      : errorSummary;

  const body =
    `Error: ${truncatedError}\n` +
    `Completed ${tasksCompleted} task${tasksCompleted !== 1 ? 's' : ''} before failure. Duration: ${durationStr}`;

  sendNotification({
    title: 'Ralph-TUI Error',
    body,
    sound,
  });
}
