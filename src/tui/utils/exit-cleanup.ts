/**
 * ABOUTME: Exit cleanup handler for ralph-tui.
 * Handles cleaning up stored images on exit based on configuration settings.
 * By default, images are automatically cleaned up on exit.
 * Users can set cleanup_policy to 'manual' or 'never' to keep images.
 */

import { listStoredImages, deleteAllStoredImages } from './image-storage.js';
import {
  loadStoredConfig,
  type ImageCleanupPolicy,
} from '../../config/index.js';

/**
 * Options for the cleanup handler.
 */
export interface CleanupHandlerOptions {
  /** Working directory (defaults to cwd) */
  cwd?: string;
  /** Whether running in headless mode (auto-cleanup without prompt) */
  headless?: boolean;
}

/**
 * Result of the cleanup operation.
 */
export interface CleanupResult {
  /** Number of images deleted */
  deletedCount: number;
  /** Whether cleanup was skipped (policy is manual/never, or user chose no) */
  skipped: boolean;
  /** Reason for skipping if skipped */
  skipReason?: string;
  /** Whether the config was updated (user chose "always") */
  configUpdated: boolean;
}

/**
 * Perform cleanup of stored images based on configuration.
 * This is the main entry point for exit cleanup.
 *
 * @param options - Cleanup options
 * @returns Result of the cleanup operation
 */
export async function performExitCleanup(
  options: CleanupHandlerOptions = {},
): Promise<CleanupResult> {
  const cwd = options.cwd ?? process.cwd();

  // Load configuration
  const config = await loadStoredConfig(cwd);
  const imageConfig = config.images ?? {};
  const cleanupPolicy: ImageCleanupPolicy =
    imageConfig.cleanup_policy ?? 'on_exit';

  // Check cleanup policy - 'manual' or 'never' means don't auto-cleanup
  if (cleanupPolicy === 'manual' || cleanupPolicy === 'never') {
    return {
      deletedCount: 0,
      skipped: true,
      skipReason: `Cleanup policy is '${cleanupPolicy}'`,
      configUpdated: false,
    };
  }

  // List stored images
  const images = await listStoredImages(cwd);

  // No images to clean up
  if (images.length === 0) {
    return {
      deletedCount: 0,
      skipped: true,
      skipReason: 'No images to clean up',
      configUpdated: false,
    };
  }

  // Default behavior: auto-cleanup without prompting
  // Users who want to keep images can set cleanup_policy to 'manual' or 'never'
  const deletedCount = await deleteAllStoredImages(cwd);

  return {
    deletedCount,
    skipped: false,
    configUpdated: false,
  };
}

/**
 * State for tracking whether cleanup handlers have been registered.
 */
let cleanupHandlersRegistered = false;
let cleanupInProgress = false;

/**
 * Register exit cleanup handlers for SIGINT, SIGTERM, and process exit.
 * These handlers will run image cleanup when the process exits.
 *
 * IMPORTANT: This should be called early in the entry point, and the
 * actual cleanup should be performed in the graceful shutdown flow,
 * NOT in the signal handlers (which must be sync in Node.js).
 *
 * @param options - Cleanup options
 * @returns A cleanup function to manually trigger cleanup
 */
export function registerExitCleanupHandlers(
  options: CleanupHandlerOptions = {},
): () => Promise<CleanupResult> {
  // Return a function that performs cleanup - let the entry point
  // call this at the appropriate time in their shutdown sequence
  const runCleanup = async (): Promise<CleanupResult> => {
    if (cleanupInProgress) {
      return {
        deletedCount: 0,
        skipped: true,
        skipReason: 'Cleanup already in progress',
        configUpdated: false,
      };
    }

    cleanupInProgress = true;
    try {
      return await performExitCleanup(options);
    } finally {
      cleanupInProgress = false;
    }
  };

  // Mark as registered (though we don't actually register signal handlers here
  // since the entry points already have their own handlers)
  cleanupHandlersRegistered = true;

  return runCleanup;
}

/**
 * Check if cleanup handlers have been registered.
 */
export function areCleanupHandlersRegistered(): boolean {
  return cleanupHandlersRegistered;
}

/**
 * Reset cleanup handler state (for testing).
 */
export function resetCleanupHandlerState(): void {
  cleanupHandlersRegistered = false;
  cleanupInProgress = false;
}
