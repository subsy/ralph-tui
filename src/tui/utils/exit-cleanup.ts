/**
 * ABOUTME: Exit cleanup handler for ralph-tui.
 * Handles cleaning up stored images on exit based on configuration settings.
 * Supports user confirmation with Yes/No/Always options.
 */

import { createInterface, Interface } from 'node:readline';
import {
  listStoredImages,
  deleteAllStoredImages,
  type StoredImageInfo,
} from './image-storage.js';
import {
  loadStoredConfig,
  saveProjectConfig,
  type StoredConfig,
  type ImageCleanupPolicy,
} from '../../config/index.js';

/**
 * Result of a cleanup confirmation prompt.
 */
export type CleanupChoice = 'yes' | 'no' | 'always';

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
 * Prompt the user for cleanup confirmation using raw readline.
 * This works even after Ink's renderer has been destroyed.
 *
 * @param images - List of images to display in the prompt
 * @returns User's choice
 */
async function promptCleanupConfirmation(images: StoredImageInfo[]): Promise<CleanupChoice> {
  // Create readline interface for raw terminal input
  const rl: Interface = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    // Display the prompt
    console.log('');
    console.log(`Clean up ${images.length} session image${images.length === 1 ? '' : 's'}?`);

    // Show image filenames (limit to first 5 to avoid flooding terminal)
    const displayImages = images.slice(0, 5);
    for (const img of displayImages) {
      console.log(`  \u2022 ${img.filename}`);
    }
    if (images.length > 5) {
      console.log(`  ... and ${images.length - 5} more`);
    }

    console.log('');
    console.log('[Y] Yes  [N] No  [A] Always (don\'t ask again)');
    process.stdout.write('> ');

    // Enable raw mode for single keypress detection
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const cleanup = () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      rl.close();
    };

    const handleInput = (chunk: Buffer) => {
      const key = chunk.toString().toLowerCase();

      if (key === 'y' || key === '\r' || key === '\n') {
        console.log('Yes');
        cleanup();
        resolve('yes');
      } else if (key === 'n') {
        console.log('No');
        cleanup();
        resolve('no');
      } else if (key === 'a') {
        console.log('Always');
        cleanup();
        resolve('always');
      } else if (key === '\x03') {
        // Ctrl+C - treat as "no"
        console.log('No (cancelled)');
        cleanup();
        resolve('no');
      }
      // Ignore other keys
    };

    process.stdin.once('data', handleInput);
  });
}

/**
 * Perform cleanup of stored images based on configuration.
 * This is the main entry point for exit cleanup.
 *
 * @param options - Cleanup options
 * @returns Result of the cleanup operation
 */
export async function performExitCleanup(
  options: CleanupHandlerOptions = {}
): Promise<CleanupResult> {
  const cwd = options.cwd ?? process.cwd();

  // Load configuration
  const config = await loadStoredConfig(cwd);
  const imageConfig = config.images ?? {};
  const cleanupPolicy: ImageCleanupPolicy = imageConfig.cleanup_policy ?? 'on_exit';
  const skipConfirmation = imageConfig.skip_cleanup_confirmation ?? false;

  // Check cleanup policy
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

  // Determine whether to prompt
  let shouldCleanup = false;
  let configUpdated = false;

  if (skipConfirmation || options.headless) {
    // Auto-cleanup without prompting
    shouldCleanup = true;
    if (options.headless && !skipConfirmation) {
      console.log(`Cleaning up ${images.length} session image(s)...`);
    }
  } else {
    // Prompt user for confirmation
    const choice = await promptCleanupConfirmation(images);

    if (choice === 'yes') {
      shouldCleanup = true;
    } else if (choice === 'always') {
      shouldCleanup = true;

      // Update config atomically to set skip_cleanup_confirmation = true
      const updatedConfig: StoredConfig = {
        ...config,
        images: {
          ...imageConfig,
          skip_cleanup_confirmation: true,
        },
      };

      try {
        await saveProjectConfig(updatedConfig, cwd);
        configUpdated = true;
        console.log('Updated config: skip_cleanup_confirmation = true');
      } catch (error) {
        console.warn(
          'Warning: Failed to update config:',
          error instanceof Error ? error.message : String(error)
        );
      }
    } else {
      // User chose "no"
      return {
        deletedCount: 0,
        skipped: true,
        skipReason: 'User declined cleanup',
        configUpdated: false,
      };
    }
  }

  // Perform cleanup
  if (shouldCleanup) {
    const deletedCount = await deleteAllStoredImages(cwd);
    return {
      deletedCount,
      skipped: false,
      configUpdated,
    };
  }

  return {
    deletedCount: 0,
    skipped: true,
    skipReason: 'Unknown',
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
  options: CleanupHandlerOptions = {}
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
