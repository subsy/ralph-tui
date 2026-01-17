/**
 * ABOUTME: Cross-platform sound playback utility for ralph-tui.
 * Provides audio playback across macOS, Linux, and Windows.
 * Supports system notification sounds and bundled Ralph Wiggum clips.
 */

import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { access, constants } from 'node:fs/promises';
import type { NotificationSoundMode } from './config/types.js';

/**
 * Directory containing bundled sound files.
 * Sounds are stored in assets/sounds/ relative to the dist directory.
 */
function getSoundsDir(): string {
  // Handle both development and bundled scenarios
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);

  // In dev: src/sound.ts -> ../assets/sounds
  // In dist: dist/cli.js -> assets/sounds (copied during build)
  // Check if we're in dist by looking at the path
  if (currentDir.endsWith('dist') || currentDir.includes('/dist/')) {
    return join(currentDir, 'assets', 'sounds');
  }
  // Development: src directory
  return join(currentDir, '..', 'assets', 'sounds');
}

/**
 * List of bundled Ralph Wiggum sound files.
 * These are iconic quotes that play randomly on notifications.
 */
const RALPH_SOUNDS = [
  'iwon.wav', // "I won! I won!"
  'idunno.wav', // "I dunno"
  'choc.wav', // "Chocolate"
  'funny.wav', // "That's funny"
  'feel.wav', // "I feel..."
  'icecream.wav', // "Ice cream"
  'specialr.wav', // "I'm special"
  'daddy.wav', // "Daddy"
];

/**
 * Play a sound file using the appropriate system command.
 * Runs asynchronously and does not block.
 *
 * @param filePath - Absolute path to the sound file
 * @returns Promise that resolves when playback starts (not when it finishes)
 */
async function playFile(filePath: string): Promise<void> {
  const os = platform();

  try {
    // Verify file exists before attempting playback
    await access(filePath, constants.R_OK);
  } catch {
    console.warn(`[sound] Sound file not found: ${filePath}`);
    return;
  }

  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;

    switch (os) {
      case 'darwin':
        // macOS: use afplay
        proc = spawn('afplay', [filePath], {
          stdio: 'ignore',
          detached: true,
        });
        break;

      case 'linux':
        // Linux: try paplay (PulseAudio) first, fall back to aplay (ALSA)
        proc = spawn('paplay', [filePath], {
          stdio: 'ignore',
          detached: true,
        });
        proc.on('error', () => {
          // paplay not available, try aplay
          const alsaProc = spawn('aplay', ['-q', filePath], {
            stdio: 'ignore',
            detached: true,
          });
          alsaProc.unref();
        });
        break;

      case 'win32':
        // Windows: use PowerShell to play sound
        // Pass filePath as argument to avoid command injection
        proc = spawn(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            '& { (New-Object Media.SoundPlayer $args[0]).PlaySync() }',
            filePath,
          ],
          {
            stdio: 'ignore',
            detached: true,
            windowsHide: true,
          },
        );
        break;

      default:
        console.warn(`[sound] Unsupported platform: ${os}`);
        resolve();
        return;
    }

    // Don't wait for the sound to finish
    proc.unref();

    // Resolve immediately after spawning
    proc.on('spawn', () => resolve());
    proc.on('error', (err) => {
      console.warn(`[sound] Failed to play sound: ${err.message}`);
      resolve();
    });
  });
}

/**
 * Play the system notification sound.
 * Uses platform-specific methods to trigger the default alert sound.
 */
async function playSystemSound(): Promise<void> {
  const os = platform();

  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;

    switch (os) {
      case 'darwin':
        // macOS: play the system 'Glass' sound
        proc = spawn('afplay', ['/System/Library/Sounds/Glass.aiff'], {
          stdio: 'ignore',
          detached: true,
        });
        break;

      case 'linux':
        // Linux: use paplay with freedesktop sound theme
        // Try common notification sound paths
        proc = spawn(
          'paplay',
          ['/usr/share/sounds/freedesktop/stereo/complete.oga'],
          {
            stdio: 'ignore',
            detached: true,
          },
        );
        proc.on('error', () => {
          // Try alternative path
          const altProc = spawn(
            'paplay',
            ['/usr/share/sounds/freedesktop/stereo/message.oga'],
            {
              stdio: 'ignore',
              detached: true,
            },
          );
          altProc.unref();
        });
        break;

      case 'win32':
        // Windows: play system asterisk sound
        proc = spawn(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            '[System.Media.SystemSounds]::Asterisk.Play()',
          ],
          {
            stdio: 'ignore',
            detached: true,
            windowsHide: true,
          },
        );
        break;

      default:
        console.warn(`[sound] Unsupported platform: ${os}`);
        resolve();
        return;
    }

    proc.unref();
    proc.on('spawn', () => resolve());
    proc.on('error', (err) => {
      console.warn(`[sound] Failed to play system sound: ${err.message}`);
      resolve();
    });
  });
}

/**
 * Play a random Ralph Wiggum sound clip.
 * Selects randomly from the bundled RALPH_SOUNDS list.
 */
async function playRalphSound(): Promise<void> {
  const soundsDir = getSoundsDir();
  const randomSound =
    RALPH_SOUNDS[Math.floor(Math.random() * RALPH_SOUNDS.length)];

  if (!randomSound) {
    console.warn('[sound] No Ralph sounds available');
    return;
  }

  const soundPath = join(soundsDir, randomSound);
  return playFile(soundPath);
}

/**
 * Play notification sound based on the configured mode.
 *
 * @param mode - The sound mode ('off', 'system', or 'ralph')
 */
export async function playNotificationSound(
  mode: NotificationSoundMode,
): Promise<void> {
  switch (mode) {
    case 'off':
      // No sound
      return;

    case 'system':
      return playSystemSound();

    case 'ralph':
      return playRalphSound();

    default: {
      // Exhaustive check - block scoped to prevent identifier leakage
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

/**
 * Check if sound playback is likely to work on this system.
 * Useful for providing user feedback about sound availability.
 *
 * @returns Promise resolving to true if sound playback should work
 */
export async function checkSoundAvailable(): Promise<boolean> {
  const os = platform();

  return new Promise((resolve) => {
    switch (os) {
      case 'darwin': {
        const proc = spawn('which', ['afplay'], { stdio: 'ignore' });
        proc.on('close', (code) => resolve(code === 0));
        proc.on('error', () => resolve(false));
        break;
      }

      case 'linux': {
        // Check for paplay first (PulseAudio), fall back to aplay (ALSA)
        // Matches the fallback order in playFile
        const paplayProc = spawn('which', ['paplay'], { stdio: 'ignore' });
        paplayProc.on('close', (code) => {
          if (code === 0) {
            resolve(true);
          } else {
            // paplay not found, try aplay
            const aplayProc = spawn('which', ['aplay'], { stdio: 'ignore' });
            aplayProc.on('close', (aplayCode) => resolve(aplayCode === 0));
            aplayProc.on('error', () => resolve(false));
          }
        });
        paplayProc.on('error', () => {
          // paplay check failed, try aplay
          const aplayProc = spawn('which', ['aplay'], { stdio: 'ignore' });
          aplayProc.on('close', (aplayCode) => resolve(aplayCode === 0));
          aplayProc.on('error', () => resolve(false));
        });
        break;
      }

      case 'win32':
        // PowerShell is always available on modern Windows
        resolve(true);
        return;

      default:
        resolve(false);
        return;
    }
  });
}

// Export types
export type { NotificationSoundMode };
