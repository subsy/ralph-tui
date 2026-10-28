/**
 * ABOUTME: Slash command handler for ralph-tui.
 * Provides utilities for detecting and executing slash commands in chat input.
 * Currently supports /clear-images for manual image cleanup.
 */

import { deleteAllStoredImages } from './image-storage.js';

/**
 * Result of executing a slash command.
 */
export interface SlashCommandResult {
  /** Whether the command was recognized and executed */
  handled: boolean;
  /** Message to show to the user (via toast or chat) */
  message?: string;
  /** Whether the command execution was successful */
  success?: boolean;
  /** Error message if the command failed */
  error?: string;
}

/**
 * Context for slash command execution.
 * Contains callbacks and state needed by commands.
 */
export interface SlashCommandContext {
  /** Callback to clear pending image attachments in the current input */
  clearPendingImages?: () => void;
  /** Number of pending image attachments */
  pendingImageCount?: number;
}

/**
 * Check if a string is a slash command.
 *
 * @param input - User input to check
 * @returns True if the input is a slash command (starts with /)
 */
export function isSlashCommand(input: string): boolean {
  return input.trim().startsWith('/');
}

/**
 * Parse a slash command from user input.
 *
 * @param input - User input to parse
 * @returns Parsed command name and arguments, or null if not a command
 */
export function parseSlashCommand(
  input: string,
): { command: string; args: string[] } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return null;
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const command = parts[0]?.toLowerCase() ?? '';
  const args = parts.slice(1);

  return { command, args };
}

/**
 * Execute the /clear-images command.
 * Clears all stored session images and any pending image attachments.
 * Works regardless of cleanup_policy setting.
 *
 * @param context - Command execution context
 * @returns Result of the command execution
 */
async function executeClearImages(
  context: SlashCommandContext,
): Promise<SlashCommandResult> {
  try {
    // Delete all stored images
    const deletedCount = await deleteAllStoredImages();

    // Clear pending attachments if callback provided
    const pendingCount = context.pendingImageCount ?? 0;
    if (context.clearPendingImages && pendingCount > 0) {
      context.clearPendingImages();
    }

    // Calculate total cleared (stored + pending)
    const totalCleared = deletedCount + pendingCount;

    // Build confirmation message
    let message: string;
    if (totalCleared === 0) {
      message = 'No images to clear';
    } else if (totalCleared === 1) {
      message = 'Cleared 1 image';
    } else {
      message = `Cleared ${totalCleared} images`;
    }

    return {
      handled: true,
      success: true,
      message,
    };
  } catch (error) {
    return {
      handled: true,
      success: false,
      error: error instanceof Error ? error.message : 'Failed to clear images',
      message: 'Failed to clear images',
    };
  }
}

/**
 * Execute a slash command.
 *
 * @param input - User input (must be a slash command)
 * @param context - Command execution context
 * @returns Result of the command execution
 *
 * @example
 * ```typescript
 * const result = await executeSlashCommand('/clear-images', {
 *   clearPendingImages: () => clearImages(),
 *   pendingImageCount: attachedImages.length,
 * });
 *
 * if (result.handled) {
 *   if (result.success) {
 *     toast.showSuccess(result.message);
 *   } else {
 *     toast.showError(result.message);
 *   }
 * }
 * ```
 */
export async function executeSlashCommand(
  input: string,
  context: SlashCommandContext = {},
): Promise<SlashCommandResult> {
  const parsed = parseSlashCommand(input);
  if (!parsed) {
    return { handled: false };
  }

  switch (parsed.command) {
    case 'clear-images':
      return executeClearImages(context);

    default:
      // Unknown command - not handled
      return { handled: false };
  }
}

/**
 * Get a list of available slash commands with descriptions.
 *
 * @returns Array of command info objects
 */
export function getAvailableSlashCommands(): Array<{
  command: string;
  description: string;
}> {
  return [
    {
      command: '/clear-images',
      description: 'Remove all session images and pending attachments',
    },
  ];
}
